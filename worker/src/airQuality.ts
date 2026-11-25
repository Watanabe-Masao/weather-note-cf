// 空気質（Open-Meteo の Air Quality API、もとは Copernicus の大気の予報と解析 CAMS）を、高知の1時間ごとの
// 値として D1 に残す（2026-11-21、KC-04）。
//
// 項目：PM2.5・PM10（µg/m³）、黄砂（dust、µg/m³）、エアロゾルの光学的厚さ（AOD、550nm、単位なし）。AOD は
// 月の見え方の空気の濁り β に使える（β ≈ AOD × 0.55^α、α 1.3 で約 0.46 × AOD）。
// どれもモデルの値で、観測ではない（#208 の決まり3の「観測の記録」には当たらない）。過去は 2023-01 から
// 取り直せる（KC-04）ので急ぎはしないが、手元に1時間ごとの記録として持つ。予報の履歴（発表ごとの値）は
// 持たない（使い道が決まってから）。終わった日（日本時間の昨日まで）だけを残す。
//
// 1回の取得は1か月まで。新しい側（最後に残した日の次から昨日まで）を先に、それが済んだら古い側へ
// （2023-01-01 まで）1か月ずつさかのぼる。1時間に1回まで。
// 出典：Open-Meteo.com（CC BY 4.0）、Copernicus Atmosphere Monitoring Service（CAMS）。

import { addDays } from "../../shared/dates";
import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Db } from "./accounts";
import { doneOnce } from "./once";
import { retryingFetch } from "./retry";

export const AIR_QUALITY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS air_quality_hourly (
    station TEXT NOT NULL,
    valid_at TEXT NOT NULL,
    pm2_5 REAL,
    pm10 REAL,
    dust REAL,
    aod REAL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (station, valid_at)
  )`,
  `CREATE TABLE IF NOT EXISTS air_quality_fetch_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    saved INTEGER NOT NULL,
    range TEXT,
    error TEXT
  )`,
];

/** Open-Meteo（CAMS 全球）で値がある最初の日（KC-04：2022-09 は失敗、2023-01 から値あり）。 */
export const AIR_FIRST_DAY = "2023-01-01";
const MAX_DAYS = 31;
const EVERY_MS = 3_600_000;
const LOG_DAYS = 400;
const SOURCE = "open-meteo-cams";
const FIELDS = { pm2_5: "pm2_5", pm10: "pm10", dust: "dust", aod: "aerosol_optical_depth" } as const;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetcher = retryingFetch(25_000);

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureAirSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of AIR_QUALITY_SCHEMA) await db.prepare(q).run();
  });
}

const jstDay = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

export const airUrl = (lat: number, lon: number, from: string, to: string) =>
  "https://air-quality-api.open-meteo.com/v1/air-quality?" +
  `latitude=${lat}&longitude=${lon}&hourly=${Object.values(FIELDS).join(",")}` +
  `&start_date=${from}&end_date=${to}&timezone=Asia%2FTokyo`;

/** 次に取る日の範囲：新しい側の抜けを先に、無ければ古い側へ1か月。両方済んでいれば null。 */
export function nextRange(oldest: string | null, newest: string | null, yesterday: string): { from: string; to: string } | null {
  if (!newest || !oldest) return { from: maxDay(AIR_FIRST_DAY, addDays(yesterday, -(MAX_DAYS - 1))), to: yesterday };
  if (newest < yesterday) {
    const from = addDays(newest, 1);
    const to = minDay(yesterday, addDays(from, MAX_DAYS - 1));
    return { from, to };
  }
  if (oldest > AIR_FIRST_DAY) {
    const to = addDays(oldest, -1);
    return { from: maxDay(AIR_FIRST_DAY, addDays(to, -(MAX_DAYS - 1))), to };
  }
  return null;
}
const maxDay = (a: string, b: string) => (a > b ? a : b);
const minDay = (a: string, b: string) => (a < b ? a : b);

/** 欠けた日を見る長さ（毎時の見張りの欠けの発見と同じ14日）。 */
export const REFILL_DAYS = 14;

/** 手前 REFILL_DAYS 日（保存を始めた日より前は見ない）で、PM2.5 の1時間値が24に足りない日の範囲（無ければ null）。 */
export async function shortDays(db: Db, station: string, oldest: string, yesterday: string): Promise<{ from: string; to: string } | null> {
  const start = maxDay(oldest, addDays(yesterday, -(REFILL_DAYS - 1)));
  const n = new Map(
    (
      await db
        .prepare("SELECT substr(valid_at, 1, 10) AS d, COUNT(pm2_5) AS n FROM air_quality_hourly WHERE station = ? AND valid_at >= ? AND valid_at < ? GROUP BY d")
        .bind(station, `${start}T00:00:00+09:00`, `${addDays(yesterday, 1)}T00:00:00+09:00`)
        .all<{ d: string; n: number }>()
    ).results.map((r) => [r.d, r.n]),
  );
  const short: string[] = [];
  for (let d = start; d <= yesterday; d = addDays(d, 1)) if ((n.get(d) ?? 0) < 24) short.push(d);
  return short.length ? { from: short[0], to: short[short.length - 1] } : null;
}

/** 1時間に1回まで、決まった範囲を取って残す。取れた時間の数を返す。 */
export async function saveAirQuality(db: Db, now = Date.now(), get: Fetcher = defaultFetch): Promise<{ saved: number; ok: boolean; skipped?: boolean }> {
  await ensureAirSchema(db);
  const last = await db.prepare("SELECT MAX(at) AS at FROM air_quality_fetch_log").first<{ at: string | null }>();
  if (last?.at && Date.parse(last.at) > now - EVERY_MS + 60_000) return { saved: 0, ok: true, skipped: true };
  const at = new Date(now).toISOString();
  const yesterday = addDays(jstDay(now), -1);
  let saved = 0;
  let error: string | null = null;
  let range: string | null = null;
  for (const [station, place] of Object.entries(STATION_PLACES)) {
    const have = await db
      .prepare("SELECT MIN(substr(valid_at, 1, 10)) AS oldest, MAX(substr(valid_at, 1, 10)) AS newest FROM air_quality_hourly WHERE station = ?")
      .bind(station)
      .first<{ oldest: string | null; newest: string | null }>();
    // 欠けた日の取り直し（11/25 レビュー・ルールの見直し）：手前 REFILL_DAYS 日のうち、新しい側が済んでいるのに PM2.5 の
    // 1時間値が24に足りない日があれば、先にその範囲を取り直す（1時間だけ入った日を「済んだ」として進まない）。
    // 提供元にもその時間の値が無いときに毎時取り直し続けないよう、同じ範囲は24時間に1回まで。
    const refill = have?.newest && have.newest >= yesterday ? await shortDays(db, station, have.oldest!, yesterday) : null;
    const tried = refill ? await db.prepare("SELECT COUNT(*) AS n FROM air_quality_fetch_log WHERE range = ? AND at >= ?").bind(`${refill.from}..${refill.to}`, new Date(now - 24 * 3_600_000).toISOString()).first<{ n: number }>() : null;
    const want = refill && !tried?.n ? refill : nextRange(have?.oldest ?? null, have?.newest ?? null, yesterday);
    if (!want) continue;
    range = `${want.from}..${want.to}`;
    try {
      const r = await get(airUrl(place.radar.lat, place.radar.lon, want.from, want.to));
      if (!r.ok) throw new Error(`air quality ${range}: HTTP ${r.status}`);
      const h = (JSON.parse(await r.text()) as { hourly?: Record<string, (number | string | null)[]> }).hourly;
      const times = (h?.time ?? []) as string[];
      if (!times.length) throw new Error(`air quality ${range}: no hours`);
      const stmts = [];
      for (let i = 0; i < times.length; i++) {
        const v = Object.fromEntries(Object.entries(FIELDS).map(([k, name]) => [k, (h?.[name]?.[i] as number | null) ?? null]));
        // 値の全く無い時間は残さない（その時間はまだ無い・提供されていない）。
        if (Object.values(v).every((x) => x == null)) continue;
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO air_quality_hourly (station, valid_at, pm2_5, pm10, dust, aod, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(station, `${times[i]}:00+09:00`, v.pm2_5, v.pm10, v.dust, v.aod, SOURCE, at),
        );
      }
      for (const s of stmts) await s.run();
      saved += stmts.length;
      // 値が一つも無い範囲（古い側で提供の始まりより前など）は、次に同じ範囲を取り直さないよう印を残す。
      if (!stmts.length)
        await db
          // 印は、その時刻に値があれば書かない（取り直しの範囲で値を消さない）。
          .prepare("INSERT OR IGNORE INTO air_quality_hourly (station, valid_at, pm2_5, pm10, dust, aod, source, fetched_at) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?)")
          .bind(station, `${want.from}T00:00:00+09:00`, SOURCE, at)
          .run();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  // 取るものが無かった回（昨日の分まで済んで、古い側も済んだ後）は記録しない（1時間ごとに空の記録が増えるだけ）。
  // 1日に1回は昨日の分を取るので、うまくいった記録は1日ごとに残る（見張りは2日で注意）。
  if (range === null && !error) return { saved: 0, ok: true, skipped: true };
  await db.prepare("INSERT OR REPLACE INTO air_quality_fetch_log (at, ok, saved, range, error) VALUES (?, ?, ?, ?, ?)").bind(at, error ? 0 : 1, saved, range, error).run();
  await db.prepare("DELETE FROM air_quality_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved, ok: !error };
}

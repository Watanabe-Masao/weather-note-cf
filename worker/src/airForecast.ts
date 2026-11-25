// 空気質の予測（Open-Meteo の Air Quality API、もとは Copernicus の大気の予報 CAMS 全球）を、今日から5日先まで
// 1時間ごとの値として持つ（2026-11-25 渡辺さん「大気質の UI」「今日とこれからも」）。
//
// CAMS 全球は 0.4°（約45km）の格子、日本時間の 9時・21時の計算で5日先まで、出そろうのは計算から10時間後まで
// （ECMWF の説明）。Open-Meteo は12時間ごとに取り込む。こちらは1時間ごとに取り、新しい計算が出ていれば遅くとも
// 1時間で入る（1日24回。Open-Meteo の無料の範囲は1日1万回まで）。
// 予報の履歴（発表ごとの値）は持たない：いつも最新の1回だけを上書きする。終わった日の値は airQuality.ts が別に残す。
// どれもモデルの値で、観測ではない（画面では「CAMS の予測」と書く。design-system 4.0a）。
// 出典：Open-Meteo.com（CC BY 4.0）、Copernicus Atmosphere Monitoring Service（CAMS）。

import { addDays } from "../../shared/dates";
import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Db } from "./accounts";
import { ensureAirSchema } from "./airQuality";
import { doneOnce } from "./once";
import { retryingFetch } from "./retry";
import type { AirResponse } from "../../shared/airQuality";

export const AIR_FORECAST_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS air_quality_forecast (
    station TEXT NOT NULL,
    valid_at TEXT NOT NULL,
    pm2_5 REAL,
    pm10 REAL,
    dust REAL,
    aod REAL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (station, valid_at)
  )`,
  `CREATE TABLE IF NOT EXISTS air_forecast_fetch_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    saved INTEGER NOT NULL,
    error TEXT
  )`,
];

/** 今日を含めて何日分か（CAMS 全球は5日先まで）。 */
export const AIR_FORECAST_DAYS = 5;
const EVERY_MS = 3_600_000;
const LOG_DAYS = 30;
const FIELDS = { pm2_5: "pm2_5", pm10: "pm10", dust: "dust", aod: "aerosol_optical_depth" } as const;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetcher = retryingFetch(25_000);

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureAirForecastSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of AIR_FORECAST_SCHEMA) await db.prepare(q).run();
  });
}

const jstDay = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

export const airForecastUrl = (lat: number, lon: number, from: string, to: string) =>
  "https://air-quality-api.open-meteo.com/v1/air-quality?" +
  `latitude=${lat}&longitude=${lon}&hourly=${Object.values(FIELDS).join(",")}` +
  `&start_date=${from}&end_date=${to}&timezone=Asia%2FTokyo`;

/** 1時間に1回まで、今日から5日分の予測を取り、地点ごとに丸ごと置き換える。 */
export async function saveAirForecast(db: Db, now = Date.now(), get: Fetcher = defaultFetch): Promise<{ saved: number; ok: boolean; skipped?: boolean }> {
  await ensureAirForecastSchema(db);
  const last = await db.prepare("SELECT MAX(at) AS at FROM air_forecast_fetch_log").first<{ at: string | null }>();
  if (last?.at && Date.parse(last.at) > now - EVERY_MS + 60_000) return { saved: 0, ok: true, skipped: true };
  const at = new Date(now).toISOString();
  const from = jstDay(now);
  const to = addDays(from, AIR_FORECAST_DAYS - 1);
  let saved = 0;
  let error: string | null = null;
  for (const [station, place] of Object.entries(STATION_PLACES)) {
    try {
      const r = await get(airForecastUrl(place.radar.lat, place.radar.lon, from, to));
      if (!r.ok) throw new Error(`air forecast: HTTP ${r.status}`);
      const h = (JSON.parse(await r.text()) as { hourly?: Record<string, (number | string | null)[]> }).hourly;
      const times = (h?.time ?? []) as string[];
      if (!times.length) throw new Error("air forecast: no hours");
      const rows = [];
      for (let i = 0; i < times.length; i++) {
        const v = Object.fromEntries(Object.entries(FIELDS).map(([k, name]) => [k, (h?.[name]?.[i] as number | null) ?? null]));
        if (Object.values(v).every((x) => x == null)) continue; // まだ計算に無い時間
        rows.push(
          db
            .prepare("INSERT INTO air_quality_forecast (station, valid_at, pm2_5, pm10, dust, aod, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(station, `${times[i]}:00+09:00`, v.pm2_5, v.pm10, v.dust, v.aod, at),
        );
      }
      // 値が1時間も無ければ、前に取れた分を消さずに残す（取り違えで空にしない）。
      if (!rows.length) throw new Error("air forecast: no values");
      await db.batch([db.prepare("DELETE FROM air_quality_forecast WHERE station = ?").bind(station), ...rows]);
      saved += rows.length;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  await db.prepare("INSERT OR REPLACE INTO air_forecast_fetch_log (at, ok, saved, error) VALUES (?, ?, ?, ?)").bind(at, error ? 0 : 1, saved, error).run();
  await db.prepare("DELETE FROM air_forecast_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved, ok: !error };
}

/** 画面用：その日の1時間ごとのモデルの値。今日と先の日は予測、過ぎた日は終わった日の値。 */
export async function readAir(db: Db, station: string, date: string, today: string): Promise<AirResponse> {
  const past = date < today;
  const table = past ? "air_quality_hourly" : "air_quality_forecast";
  await (past ? ensureAirSchema(db) : ensureAirForecastSchema(db));
  const rows = (
    await db
      .prepare(`SELECT valid_at, pm2_5, pm10, dust, aod, fetched_at FROM ${table} WHERE station = ? AND valid_at >= ? AND valid_at < ? ORDER BY valid_at`)
      .bind(station, `${date}T00:00:00+09:00`, `${addDays(date, 1)}T00:00:00+09:00`)
      .all<{ valid_at: string; pm2_5: number | null; pm10: number | null; dust: number | null; aod: number | null; fetched_at: string }>()
  ).results.filter((r) => r.pm2_5 != null || r.pm10 != null || r.dust != null || r.aod != null);
  return {
    v: 1,
    station,
    date,
    kind: past ? "past" : "forecast",
    hours: rows.map((r) => ({ h: Number(r.valid_at.slice(11, 13)), pm2_5: r.pm2_5, pm10: r.pm10, dust: r.dust, aod: r.aod })),
    fetchedAt: rows.length ? rows.reduce((a, r) => (r.fetched_at > a ? r.fetched_at : a), rows[0].fetched_at) : null,
    source: "Open-Meteo（CAMS）",
  };
}

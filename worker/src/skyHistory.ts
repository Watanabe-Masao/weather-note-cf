// 空の答え合わせのための予報の履歴（#532 の 2、2026-11-27 渡辺さん「前日14時の答え合わせに必要な予報の保存は、
// 照合表の実装と切り離して早めに始める」）。画面・照合はまだ作らない。保存と、前日14時の値の選び方だけ。
//
// 何を：天気コード・降水量・全雲量・視程（Open-Meteo の予報、アプリの予報と同じ地点・同じ既定のモデル）と、
// AOD（Open-Meteo の Air Quality、CAMS 全球。空気質の予測と同じ地点）。今日と明日の1時間ごと。
// いつ：1時間に1回まで（日付が変われば すぐ）。アプリが開かれていなくても定時処理で取る。
// どう残すか：最新値（airForecast.ts など）とは別の表に、追記だけ。地点・項目・対象時刻ごとに、前に残した値・状態と
// 違うときだけ1行足す（同じ値なら足さない。その回に確かめたことは取得の記録 sky_forecast_fetch_log に残る）。
// - fetched_at は、その値を実際に受け取った時刻。値が変わらない回や、取れなかった回では書き換えない（旧値の時刻のまま）。
// - 応答にその時刻の値が無ければ「missing」の行（値は null）。取れなかった回（HTTP の失敗など）は行を足さず、取得の記録に失敗を残す。
// - 時刻：valid_at は日本時間の正時（"+09:00"）。全雲量・視程・AOD・天気コードは、その正時の瞬時の値（天気コードは
//   Open-Meteo ではその時間の代表）。降水量は、その正時までの1時間の量（JMA の時間 n と同じ。0時は前の日の 24 時）。
// - 単位は行ごとに持つ（視程は m のまま。画面の 20 km 止めはしない）。
// - モデルの初期時刻：既定のモデル（best_match）は応答に初期時刻が無いので null（取れたら入れる）。
// - 要求した座標と、応答の格子の座標（latitude・longitude）は取得の記録に残す。
// 出典：Open-Meteo.com（CC BY 4.0）、Copernicus Atmosphere Monitoring Service（CAMS）。どれもモデルの値で、観測ではない。

import { addDays } from "../../shared/dates";
import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Station } from "../../shared/types";
import type { Db } from "./accounts";
import { coords } from "./open-meteo";
import { doneOnce } from "./once";
import { retryingFetch } from "./retry";

export const SKY_HISTORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sky_forecast_history (
    station TEXT NOT NULL,
    item TEXT NOT NULL,
    valid_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    source TEXT NOT NULL,
    unit TEXT NOT NULL,
    value REAL,
    status TEXT NOT NULL,
    model_run TEXT,
    PRIMARY KEY (station, item, valid_at, fetched_at)
  )`,
  `CREATE TABLE IF NOT EXISTS sky_forecast_fetch_log (
    at TEXT NOT NULL,
    station TEXT NOT NULL,
    source TEXT NOT NULL,
    ok INTEGER NOT NULL,
    from_day TEXT NOT NULL,
    to_day TEXT NOT NULL,
    req_lat REAL,
    req_lon REAL,
    grid_lat REAL,
    grid_lon REAL,
    model_run TEXT,
    appended INTEGER NOT NULL,
    error TEXT,
    PRIMARY KEY (at, station, source)
  )`,
];

/** 何日分か（今日と明日。前日14時の答え合わせには、前の日に取った明日の分があればよい）。 */
export const SKY_HISTORY_DAYS = 2;
const EVERY_MS = 3_600_000;

export type SkyHistoryItem = "weather_code" | "rain" | "cover" | "visibility" | "aod";
type SourceId = "open-meteo-forecast" | "open-meteo-cams";
/** 項目：応答の系列の名前・出典・単位。 */
export const SKY_HISTORY_ITEMS: Record<SkyHistoryItem, { name: string; source: SourceId; unit: string }> = {
  weather_code: { name: "weather_code", source: "open-meteo-forecast", unit: "WMO" },
  rain: { name: "precipitation", source: "open-meteo-forecast", unit: "mm/h" },
  cover: { name: "cloud_cover", source: "open-meteo-forecast", unit: "%" },
  visibility: { name: "visibility", source: "open-meteo-forecast", unit: "m" },
  aod: { name: "aerosol_optical_depth", source: "open-meteo-cams", unit: "1" },
};

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetcher = retryingFetch(25_000);

const done = new WeakSet<Db>();
export function ensureSkyHistorySchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of SKY_HISTORY_SCHEMA) await db.prepare(q).run();
  });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const jstDay = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
const itemsOf = (source: SourceId) => (Object.keys(SKY_HISTORY_ITEMS) as SkyHistoryItem[]).filter((k) => SKY_HISTORY_ITEMS[k].source === source);

export function skyForecastUrl(lat: string, lon: string, from: string, to: string): string {
  return (
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({ latitude: lat, longitude: lon, timezone: "Asia/Tokyo", hourly: itemsOf("open-meteo-forecast").map((k) => SKY_HISTORY_ITEMS[k].name).join(","), start_date: from, end_date: to })
  );
}
export function skyAodUrl(lat: number, lon: number, from: string, to: string): string {
  return (
    "https://air-quality-api.open-meteo.com/v1/air-quality?" +
    new URLSearchParams({ latitude: String(lat), longitude: String(lon), hourly: "aerosol_optical_depth", domains: "cams_global", timezone: "Asia/Tokyo", start_date: from, end_date: to })
  );
}

type Latest = { item: string; valid_at: string; value: number | null; status: string };

/**
 * 1時間に1回まで（日付が変われば すぐ）、今日と明日の1時間ごとの値を取り、前に残した値・状態と違う所だけ追記する。
 * stations は blockNo → 地点（座標）。STATION_PLACES にある地点だけ（AOD はその radar の位置）。
 */
export async function saveSkyHistory(db: Db, stations: Station[], now = Date.now(), get: Fetcher = defaultFetch): Promise<{ appended: number; ok: boolean; skipped?: boolean }> {
  await ensureSkyHistorySchema(db);
  const last = await db.prepare("SELECT MAX(at) AS at FROM sky_forecast_fetch_log").first<{ at: string | null }>();
  if (last?.at && Date.parse(last.at) > now - EVERY_MS + 60_000 && jstDay(Date.parse(last.at)) === jstDay(now)) return { appended: 0, ok: true, skipped: true };
  const at = new Date(now).toISOString();
  const from = jstDay(now);
  const to = addDays(from, SKY_HISTORY_DAYS - 1);
  let appended = 0;
  let allOk = true;
  for (const [blockNo, place] of Object.entries(STATION_PLACES)) {
    const station = stations.find((s) => s.blockNo === blockNo);
    const c = station ? coords(station) : null;
    const asks: { source: SourceId; url: string; lat: number; lon: number }[] = [
      ...(c ? [{ source: "open-meteo-forecast" as const, url: skyForecastUrl(c.latitude, c.longitude, from, to), lat: +c.latitude, lon: +c.longitude }] : []),
      { source: "open-meteo-cams", url: skyAodUrl(place.radar.lat, place.radar.lon, from, to), lat: place.radar.lat, lon: place.radar.lon },
    ];
    for (const ask of asks) {
      let error: string | null = null;
      let grid: { lat: number | null; lon: number | null } = { lat: null, lon: null };
      let added = 0;
      try {
        const r = await get(ask.url);
        if (!r.ok) throw new Error(`${ask.source}: HTTP ${r.status}`);
        const j = JSON.parse(await r.text()) as { latitude?: unknown; longitude?: unknown; hourly?: Record<string, unknown[]> };
        grid = { lat: num(j.latitude), lon: num(j.longitude) };
        const times = (j.hourly?.time ?? []) as string[];
        if (!times.length) throw new Error(`${ask.source}: no hours`);
        const items = itemsOf(ask.source);
        const latest = new Map(
          (
            await db
              .prepare(
                `SELECT h.item, h.valid_at, h.value, h.status FROM sky_forecast_history h
                 JOIN (SELECT item, valid_at, MAX(fetched_at) AS f FROM sky_forecast_history WHERE station = ? AND source = ? AND valid_at >= ? AND valid_at < ? GROUP BY item, valid_at) m
                   ON h.item = m.item AND h.valid_at = m.valid_at AND h.fetched_at = m.f
                 WHERE h.station = ?`,
              )
              .bind(blockNo, ask.source, `${from}T00:00:00+09:00`, `${addDays(to, 1)}T00:00:00+09:00`, blockNo)
              .all<Latest>()
          ).results.map((x) => [`${x.item}|${x.valid_at}`, x]),
        );
        const rows = [];
        for (let i = 0; i < times.length; i++) {
          const validAt = `${times[i]}:00+09:00`;
          for (const k of items) {
            const v = num(j.hourly?.[SKY_HISTORY_ITEMS[k].name]?.[i]);
            const status = v == null ? "missing" : "ok";
            const prev = latest.get(`${k}|${validAt}`);
            if (prev && prev.status === status && prev.value === v) continue; // 前と同じ（この回に確かめたことは取得の記録に）
            rows.push(
              db
                .prepare("INSERT OR IGNORE INTO sky_forecast_history (station, item, valid_at, fetched_at, source, unit, value, status, model_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(blockNo, k, validAt, at, ask.source, SKY_HISTORY_ITEMS[k].unit, v, status, null),
            );
          }
        }
        if (rows.length) await db.batch(rows);
        added = rows.length;
      } catch (e) {
        error = String(e instanceof Error ? e.message : e).slice(0, 300);
        allOk = false;
      }
      appended += added;
      await db
        .prepare(
          "INSERT OR REPLACE INTO sky_forecast_fetch_log (at, station, source, ok, from_day, to_day, req_lat, req_lon, grid_lat, grid_lon, model_run, appended, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(at, blockNo, ask.source, error ? 0 : 1, from, to, ask.lat, ask.lon, grid.lat, grid.lon, null, added, error)
        .run();
    }
  }
  return { appended, ok: allOk };
}

/** 前日14時（日本時間）：対象日 date の答え合わせに使う予報の締め切り（この時刻ちょうどまでに受け取った値。過ぎた値は混ぜない）。 */
export const dayBeforeCutoff = (date: string) => new Date(Date.parse(`${addDays(date, -1)}T14:00:00+09:00`)).toISOString();

export interface SkyAsOf {
  item: SkyHistoryItem;
  validAt: string;
  /** 締め切りまでに受け取った、いちばん新しい値（欠測の回のあとも、その前に受け取った値とその時刻を返す）。 */
  value: number | null;
  unit: string | null;
  fetchedAt: string | null;
  /** 締め切りまでのいちばん新しい記録の状態：ok／missing（その回の応答に値が無かった）／none（締め切りまでに記録が無い＝再現不可）。 */
  status: "ok" | "missing" | "none";
  /** 締め切りまでに、この対象時刻を含む取得が最後に成功した時刻（値が変わらず行を足さなかった回も含む）。 */
  confirmedAt: string | null;
}

/** 締め切り（cutoff、ISO）までに受け取った値を、対象時刻・項目ごとに選ぶ（cutoff ちょうどは含み、直後は含まない）。 */
export async function skyAsOf(db: Db, station: string, item: SkyHistoryItem, validAt: string, cutoff: string): Promise<SkyAsOf> {
  await ensureSkyHistorySchema(db);
  const rows = (
    await db
      .prepare("SELECT fetched_at, value, status, unit FROM sky_forecast_history WHERE station = ? AND item = ? AND valid_at = ? AND fetched_at <= ? ORDER BY fetched_at DESC")
      .bind(station, item, validAt, cutoff)
      .all<{ fetched_at: string; value: number | null; status: "ok" | "missing"; unit: string }>()
  ).results;
  const day = validAt.slice(0, 10);
  const conf = await db
    .prepare("SELECT MAX(at) AS at FROM sky_forecast_fetch_log WHERE station = ? AND source = ? AND ok = 1 AND at <= ? AND from_day <= ? AND to_day >= ?")
    .bind(station, SKY_HISTORY_ITEMS[item].source, cutoff, day, day)
    .first<{ at: string | null }>();
  const okRow = rows.find((r) => r.status === "ok");
  return {
    item,
    validAt,
    value: okRow?.value ?? null,
    unit: okRow?.unit ?? rows[0]?.unit ?? null,
    fetchedAt: okRow?.fetched_at ?? null,
    status: rows.length ? rows[0].status : "none",
    confirmedAt: conf?.at ?? null,
  };
}

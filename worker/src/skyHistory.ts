// 空の答え合わせのための予報の履歴（#532 の 2、2026-11-27 渡辺さん「前日14時の答え合わせに必要な予報の保存は、
// 照合表の実装と切り離して早めに始める」）。画面・照合はまだ作らない。保存と、前日14時の値の選び方だけ。
//
// 何を：天気コード・降水量・全雲量・視程（Open-Meteo の予報）と AOD（Open-Meteo の Air Quality、CAMS 全球）。
// どこから：**画面と同じ取得**で受け取った値（別に問い合わせない。#540 レビュー）。
// - 予報：open-meteo.ts の fetchForecast。画面の /api/forecast が取り直したとき（端の保存は 30 分）と、アプリが開かれていない
//   時間のための定時処理（saveSkyForecast、1時間に1回まで。その間に画面の取得があれば取らない）の両方で残す。
// - AOD：airForecast.ts の saveAirForecast（空気質の予測の定時取得、1時間に1回）が受け取った値。
// 答え合わせは「その時刻までに定時取得・画面の取得で受信した予報」。端の保存から出した画面の値は、その元の取得の回として残っている。
// どう残すか：最新値とは別の表に、追記だけ。地点・項目・出典・対象時刻ごとに、前に残した値・状態と違うときだけ1行足す
// （同じ値なら足さない。その回に確かめたことは取得の記録 sky_forecast_fetch_log に残る）。
// - fetched_at は、その出典の応答を**受け取り終えた時刻**（頼んだ時刻ではない。13:59 に頼んで 14:00 過ぎに届いた値は 14 時の締め切りに入らない）。
//   値が変わらない回や、取れなかった回では書き換えない（旧値の時刻のまま）。
// - 応答にその時刻の値が無ければ「missing」の行（値は null）。取れなかった回は行を足さず、取得の記録に失敗を残す。
// - 時刻：valid_at は日本時間の正時（"+09:00"）。全雲量・視程・AOD・天気コードは、その正時の瞬時の値（天気コードは
//   Open-Meteo ではその時間の代表）。降水量は、その正時までの1時間の量（JMA の時間 n。24 時＝次の日の 0:00）。
// - 範囲：受け取った日の 1:00 から、翌々日の 0:00 まで（＝今日と明日の JMA の時間 1〜24。明日の最後の1時間の降水は翌々日 0:00 の値）。
// - 単位は行ごとに持つ（視程は km、画面の 20 km 止めをする前の値）。
// - モデルの初期時刻：既定のモデル（best_match）は応答に初期時刻が無いので null（取れたら入れる）。
// - 要求した座標と、応答の格子の座標は取得の記録に残す。
// 前日14時の再現（skyAsOf）：締め切りまでに受け取った値に絞ってから、項目ごとの出典の優先順位（SKY_HISTORY_SOURCES）で選ぶ。
// 出典：Open-Meteo.com（CC BY 4.0）、Copernicus Atmosphere Monitoring Service（CAMS）。どれもモデルの値で、観測ではない。

import { addDays } from "../../shared/dates";
import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Station, WeatherRow } from "../../shared/types";
import type { Db } from "./accounts";
import { coords, fetchForecast, type ForecastFetchOptions } from "./open-meteo";
import { doneOnce } from "./once";

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
    PRIMARY KEY (station, item, source, valid_at, fetched_at)
  )`,
  `CREATE TABLE IF NOT EXISTS sky_forecast_fetch_log (
    at TEXT NOT NULL,
    station TEXT NOT NULL,
    source TEXT NOT NULL,
    via TEXT NOT NULL,
    ok INTEGER NOT NULL,
    from_valid TEXT,
    to_valid TEXT,
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

export type SkyHistoryItem = "weather_code" | "rain" | "cover" | "visibility" | "aod";
export type SkyHistorySource = "open-meteo-forecast" | "open-meteo-cams";
export const SKY_HISTORY_UNITS: Record<SkyHistoryItem, string> = { weather_code: "WMO", rain: "mm/h", cover: "%", visibility: "km", aod: "1" };
/**
 * 項目ごとの出典の優先順位（前が優先）。画面と同じ決まりで、今は 1時間ごとの値を出す出典がそれぞれ1つ（気象庁の予報に
 * 1時間ごとの値は無い）。出典が増えたらここに足す（再現は「締め切りで絞ってから、この順」）。
 */
export const SKY_HISTORY_SOURCES: Record<SkyHistoryItem, SkyHistorySource[]> = {
  weather_code: ["open-meteo-forecast"],
  rain: ["open-meteo-forecast"],
  cover: ["open-meteo-forecast"],
  visibility: ["open-meteo-forecast"],
  aod: ["open-meteo-cams"],
};
const EVERY_MS = 3_600_000;

const done = new WeakSet<Db>();
export function ensureSkyHistorySchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of SKY_HISTORY_SCHEMA) await db.prepare(q).run();
  });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const jstDay = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
/** 残す範囲（受け取った時刻から）：今日の 1:00 〜 翌々日の 0:00（どちらも含む）。 */
export function historyRange(receivedAt: string): { from: string; to: string } {
  const today = jstDay(Date.parse(receivedAt));
  return { from: `${today}T01:00:00+09:00`, to: `${addDays(today, 2)}T00:00:00+09:00` };
}
/** JMA の行（日付・時間 n）の対象時刻（n 時ちょうど。24 時は次の日の 0:00）。 */
export const validAtOf = (date: string, n: number) => (n === 24 ? `${addDays(date, 1)}T00:00:00+09:00` : `${date}T${String(n).padStart(2, "0")}:00:00+09:00`);

export interface SkyValue {
  item: SkyHistoryItem;
  validAt: string;
  value: number | null;
}
export interface SkyReceipt {
  station: string;
  source: SkyHistorySource;
  /** どの取得か：画面の取得（api）か定時処理（cron）か。 */
  via: "api" | "cron";
  receivedAt: string;
  values: SkyValue[];
  req?: { lat: number; lon: number } | null;
  grid?: { lat: number | null; lon: number | null } | null;
}

/** 受け取った値を、範囲の中で、前と違う所だけ追記し、取得の記録を残す。 */
export async function recordSkyHistory(db: Db, r: SkyReceipt): Promise<number> {
  await ensureSkyHistorySchema(db);
  const { from, to } = historyRange(r.receivedAt);
  const values = r.values.filter((v) => v.validAt >= from && v.validAt <= to);
  const latest = new Map(
    (
      await db
        .prepare(
          `SELECT h.item, h.valid_at, h.value, h.status FROM sky_forecast_history h
           JOIN (SELECT item, valid_at, MAX(fetched_at) AS f FROM sky_forecast_history WHERE station = ? AND source = ? AND valid_at >= ? AND valid_at <= ? GROUP BY item, valid_at) m
             ON h.item = m.item AND h.valid_at = m.valid_at AND h.fetched_at = m.f
           WHERE h.station = ? AND h.source = ?`,
        )
        .bind(r.station, r.source, from, to, r.station, r.source)
        .all<{ item: string; valid_at: string; value: number | null; status: string }>()
    ).results.map((x) => [`${x.item}|${x.valid_at}`, x]),
  );
  const rows = [];
  for (const v of values) {
    const status = v.value == null ? "missing" : "ok";
    const prev = latest.get(`${v.item}|${v.validAt}`);
    if (prev && prev.status === status && prev.value === v.value) continue; // 前と同じ（この回に確かめたことは取得の記録に）
    rows.push(
      db
        .prepare("INSERT OR IGNORE INTO sky_forecast_history (station, item, valid_at, fetched_at, source, unit, value, status, model_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(r.station, v.item, v.validAt, r.receivedAt, r.source, SKY_HISTORY_UNITS[v.item], v.value, status, null),
    );
  }
  if (rows.length) await db.batch(rows);
  await logFetch(db, r.receivedAt, r.station, r.source, r.via, { ok: true, from, to, req: r.req, grid: r.grid, appended: rows.length });
  return rows.length;
}

/** 取れなかった回の記録（行は足さない。fetched_at は書き換えない）。at は失敗が分かった時刻。 */
export async function recordSkyFailure(db: Db, station: string, source: SkyHistorySource, via: "api" | "cron", at: string, error: string) {
  await ensureSkyHistorySchema(db);
  await logFetch(db, at, station, source, via, { ok: false, error: error.slice(0, 300), appended: 0 });
}

async function logFetch(
  db: Db,
  at: string,
  station: string,
  source: SkyHistorySource,
  via: string,
  o: { ok: boolean; from?: string; to?: string; req?: { lat: number; lon: number } | null; grid?: { lat: number | null; lon: number | null } | null; appended: number; error?: string },
) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO sky_forecast_fetch_log (at, station, source, via, ok, from_valid, to_valid, req_lat, req_lon, grid_lat, grid_lon, model_run, appended, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(at, station, source, via, o.ok ? 1 : 0, o.from ?? null, o.to ?? null, o.req?.lat ?? null, o.req?.lon ?? null, o.grid?.lat ?? null, o.grid?.lon ?? null, null, o.appended, o.error ?? null)
    .run();
}

/** 予報の行（fetchForecast の 1時間ごと）から、残す値（天気コード・降水量・全雲量・視程）。 */
export function forecastValues(hourlyRows: WeatherRow[]): SkyValue[] {
  const out: SkyValue[] = [];
  for (const r of hourlyRows) {
    const validAt = validAtOf(r.date, r.n);
    const x = r as Record<string, unknown>;
    out.push(
      { item: "weather_code", validAt, value: num(x.weatherCode) },
      { item: "rain", validAt, value: num(x.rain) },
      { item: "cover", validAt, value: num(x.cover) },
      { item: "visibility", validAt, value: num(x.visibilityFull) },
    );
  }
  return out;
}

/** 画面の取得（/api/forecast）で受け取った予報を残す。履歴を持つ地点（STATION_PLACES）だけ。 */
export async function recordForecastReceipt(db: Db, station: Station, f: { hourlyRows: WeatherRow[]; receivedAt: string; grid?: { lat: number | null; lon: number | null } }, via: "api" | "cron" = "api") {
  if (!STATION_PLACES[station.blockNo]) return 0;
  const c = coords(station);
  return recordSkyHistory(db, { station: station.blockNo, source: "open-meteo-forecast", via, receivedAt: f.receivedAt, values: forecastValues(f.hourlyRows), req: { lat: +c.latitude, lon: +c.longitude }, grid: f.grid ?? null });
}

/**
 * 定時処理：アプリが開かれていない時間も残す。画面の取得と同じ fetchForecast で（信頼度のアンサンブルは取らない）、
 * 1時間に1回まで（日付が変われば すぐ）。その1時間に画面の取得で残していれば取らない。
 */
export async function saveSkyForecast(db: Db, stations: Station[], now = Date.now(), opt: ForecastFetchOptions = {}): Promise<{ appended: number; ok: boolean; skipped?: boolean }> {
  await ensureSkyHistorySchema(db);
  const clock = opt.clock ?? Date.now;
  let appended = 0;
  let ok = true;
  let ran = false;
  for (const blockNo of Object.keys(STATION_PLACES)) {
    const station = stations.find((s) => s.blockNo === blockNo);
    if (!station) continue;
    const last = await db
      .prepare("SELECT MAX(at) AS at FROM sky_forecast_fetch_log WHERE station = ? AND source = 'open-meteo-forecast' AND ok = 1")
      .bind(blockNo)
      .first<{ at: string | null }>();
    if (last?.at && Date.parse(last.at) > now - EVERY_MS + 60_000 && jstDay(Date.parse(last.at)) === jstDay(now)) continue;
    ran = true;
    try {
      const f = await fetchForecast(station, { ...opt, confidence: false });
      appended += await recordForecastReceipt(db, station, f, "cron");
    } catch (e) {
      ok = false;
      await recordSkyFailure(db, blockNo, "open-meteo-forecast", "cron", new Date(clock()).toISOString(), String(e instanceof Error ? e.message : e));
    }
  }
  return ran ? { appended, ok } : { appended: 0, ok: true, skipped: true };
}

/** 前日14時（日本時間）：対象日 date の答え合わせに使う予報の締め切り（この時刻ちょうどまでに受け取った値。過ぎた値は混ぜない）。 */
export const dayBeforeCutoff = (date: string) => new Date(Date.parse(`${addDays(date, -1)}T14:00:00+09:00`)).toISOString();

export interface SkyAsOf {
  item: SkyHistoryItem;
  validAt: string;
  /** 選んだ出典（優先順位で、締め切りまでに値を受け取っていた最初の出典）。どれにも値が無ければ null。 */
  source: SkyHistorySource | null;
  /** その出典で、締め切りまでに受け取ったいちばん新しい値（欠測の回のあとも、その前に受け取った値とその時刻）。 */
  value: number | null;
  unit: string;
  fetchedAt: string | null;
  /** ok：値がある／missing：締め切りまでの最後の回の応答に値が無かった（前の値を返す）／none：締め切りまでに記録が無い＝再現不可。 */
  status: "ok" | "missing" | "none";
  /** 締め切りまでに、その出典でこの対象時刻を含む取得が最後に成功した時刻（値が変わらず行を足さなかった回も含む）。 */
  confirmedAt: string | null;
}

/** 締め切り（cutoff、ISO）までに受け取った値に絞り、項目の出典の優先順位で選ぶ（cutoff ちょうどは含み、直後は含まない）。 */
export async function skyAsOf(db: Db, station: string, item: SkyHistoryItem, validAt: string, cutoff: string): Promise<SkyAsOf> {
  await ensureSkyHistorySchema(db);
  let first: SkyAsOf | null = null;
  for (const source of SKY_HISTORY_SOURCES[item]) {
    const rows = (
      await db
        .prepare("SELECT fetched_at, value, status FROM sky_forecast_history WHERE station = ? AND item = ? AND source = ? AND valid_at = ? AND fetched_at <= ? ORDER BY fetched_at DESC")
        .bind(station, item, source, validAt, cutoff)
        .all<{ fetched_at: string; value: number | null; status: "ok" | "missing" }>()
    ).results;
    const conf = await db
      .prepare("SELECT MAX(at) AS at FROM sky_forecast_fetch_log WHERE station = ? AND source = ? AND ok = 1 AND at <= ? AND from_valid <= ? AND to_valid >= ?")
      .bind(station, source, cutoff, validAt, validAt)
      .first<{ at: string | null }>();
    const okRow = rows.find((r) => r.status === "ok");
    const got: SkyAsOf = {
      item,
      validAt,
      source: okRow ? source : null,
      value: okRow?.value ?? null,
      unit: SKY_HISTORY_UNITS[item],
      fetchedAt: okRow?.fetched_at ?? null,
      status: rows.length ? rows[0].status : "none",
      confirmedAt: conf?.at ?? null,
    };
    if (got.status === "ok") return got;
    first ??= got;
  }
  return first!;
}

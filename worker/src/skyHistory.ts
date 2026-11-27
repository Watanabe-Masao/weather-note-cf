// 空の答え合わせのための予報の履歴（#532 の 2、2026-11-27 渡辺さん「前日14時の答え合わせに必要な予報の保存は、
// 照合表の実装と切り離して早めに始める」）。画面・照合はまだ作らない。保存と、前日14時の値の選び方だけ。
//
// 何を：天気コード・降水量・全雲量・視程（Open-Meteo の予報）と AOD（Open-Meteo の Air Quality、CAMS 全球）。
// どこから：**画面と同じ取得**で受け取った値（別に問い合わせない。#540 レビュー）。
// - 予報：open-meteo.ts の fetchForecast。画面の /api/forecast が取り直したとき（端の保存は 30 分）と、アプリが開かれていない
//   時間のための定時処理（saveSkyForecast、1時間に1回まで。その間に画面の取得があれば取らない）の両方で残す。
// - AOD：airForecast.ts の saveAirForecast（空気質の予測の定時取得、1時間に1回）が受け取った値。
// 答え合わせは「その時刻までに定時取得・画面の取得で受信した予報」。端の保存から出した画面の値は、その元の取得の回として残っている。
// どう残すか：最新値とは別の表に、追記だけ。**受け取った回ごとに、値が前と同じでも全部1行ずつ**（受信時刻つき）。
// 前と同じ値を省くと、保存の順が受信の順と入れ替わったとき（画面の取得と定時処理が重なるなど）に、あとから保存した
// 早い回が「同じ値」として捨てられ、締め切りでの再現を誤る（11/27 渡辺さんのテスト：13:58 に 20%、13:59 に 80%、14:01 に 80%。
// 14:01 の分が先に保存されると、14 時の再現が 80% でなく 20% になった）。保存する項目・出典・範囲は絞ったまま。
// - 受け取った回ごとに受信の ID（receipt_id）を振る（値と受信の記録で共有。同じミリ秒の回も両方残り、その2つの順は ID で決まる。11/27 レビュー）。
// - fetched_at は、その出典の応答を**受け取り終えた時刻**（頼んだ時刻ではない。13:59 に頼んで 14:00 過ぎに届いた値は 14 時の締め切りに入らない）。
//   本文を受け取り終えてすぐ（読み解く前）の時刻。取れなかった回は行を足さない。
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

/**
 * 表（11/27 レビュー：同じミリ秒に受け取った2回が、主キー (…, fetched_at) でぶつかり、後の回が黙って捨てられていた）：
 * 受け取った回ごとに **受信の ID**（receipt_id）を振り、値と取得の記録で共有する。主キーは receipt_id を含むので、
 * 同じミリ秒の回も両方残る。前の2つの表（sky_forecast_history・sky_forecast_fetch_log）は消さずに残し（足すだけの変更）、
 * 中身は一度だけ新しい表へ写す（ID は "legacy:" から始まる）。
 */
export const SKY_HISTORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sky_forecast_receipts (
    receipt_id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    station TEXT NOT NULL,
    source TEXT NOT NULL,
    via TEXT NOT NULL,
    ok INTEGER NOT NULL,
    kind TEXT NOT NULL,
    from_valid TEXT,
    to_valid TEXT,
    range_from TEXT,
    range_to TEXT,
    req_lat REAL,
    req_lon REAL,
    grid_lat REAL,
    grid_lon REAL,
    model TEXT,
    variant TEXT,
    model_run TEXT,
    appended INTEGER NOT NULL,
    error TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS sky_forecast_receipts_at ON sky_forecast_receipts (station, source, at)",
  `CREATE TABLE IF NOT EXISTS sky_forecast_values (
    receipt_id TEXT NOT NULL,
    station TEXT NOT NULL,
    item TEXT NOT NULL,
    source TEXT NOT NULL,
    valid_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    unit TEXT NOT NULL,
    value REAL,
    status TEXT NOT NULL,
    PRIMARY KEY (receipt_id, item, valid_at)
  )`,
  "CREATE INDEX IF NOT EXISTS sky_forecast_values_asof ON sky_forecast_values (station, item, source, valid_at, fetched_at)",
];
/** 前の表（#540〜。新しい表へ写すためだけに作る。もう書かない）。 */
const LEGACY_SCHEMA = [
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
const LEGACY_ID = "'legacy:' || at || ':' || station || ':' || source";
const MIGRATE = [
  `INSERT OR IGNORE INTO sky_forecast_receipts (receipt_id, at, station, source, via, ok, kind, from_valid, to_valid, range_from, range_to, req_lat, req_lon, grid_lat, grid_lon, model, variant, model_run, appended, error)
   SELECT ${LEGACY_ID}, at, station, source, via, ok, CASE WHEN ok = 1 THEN 'ok' ELSE 'fetch' END, NULL, NULL, from_valid, to_valid, req_lat, req_lon, grid_lat, grid_lon, NULL, NULL, model_run, appended, error FROM sky_forecast_fetch_log`,
  `INSERT OR IGNORE INTO sky_forecast_values (receipt_id, station, item, source, valid_at, fetched_at, unit, value, status)
   SELECT 'legacy:' || fetched_at || ':' || station || ':' || source, station, item, source, valid_at, fetched_at, unit, value, status FROM sky_forecast_history`,
  // 写した回の、実際に返ってきた範囲（値の行から）
  `UPDATE sky_forecast_receipts SET from_valid = (SELECT MIN(valid_at) FROM sky_forecast_values v WHERE v.receipt_id = sky_forecast_receipts.receipt_id),
     to_valid = (SELECT MAX(valid_at) FROM sky_forecast_values v WHERE v.receipt_id = sky_forecast_receipts.receipt_id)
   WHERE receipt_id LIKE 'legacy:%' AND from_valid IS NULL`,
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
    for (const q of [...SKY_HISTORY_SCHEMA, ...LEGACY_SCHEMA]) await db.prepare(q).run();
    // 前の表の中身を一度だけ写す（前の表に行があり、まだ写していないとき）。
    const old = await db.prepare("SELECT 1 AS x FROM sky_forecast_fetch_log LIMIT 1").first<{ x: number }>();
    const moved = await db.prepare("SELECT 1 AS x FROM sky_forecast_receipts WHERE receipt_id LIKE 'legacy:%' LIMIT 1").first<{ x: number }>();
    if (old && !moved) await db.batch(MIGRATE.map((q) => db.prepare(q)));
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
  /** どのモデルか（Open-Meteo の既定は best_match、AOD は cams_global）。 */
  model?: string | null;
  /** 頼んだ形：full（全部の項目）／without-optional（400 のため、省ける項目を外して取り直した）。 */
  variant?: string | null;
  /** テスト用：受信の ID を決める（ふだんは受信時刻＋乱数）。 */
  receiptId?: string;
}

/** 受信の ID：受信時刻（並べると受信の順）＋乱数（同じミリ秒の回を分ける）。同じミリ秒の回どうしの順は ID で決まり、保存の順によらない。 */
export const newReceiptId = (receivedAt: string) => `${receivedAt}~${crypto.randomUUID().slice(0, 8)}`;

/**
 * 受け取った値を、範囲の中で、値が前と同じでも全部（受信時刻つきで）追記し、取得の記録を残す。保存の順によらない。
 * 値と取得の記録は1つのまとまり（batch）で書く（片方だけ残らない）。from_valid・to_valid は実際に返ってきた時間の幅。
 */
export async function recordSkyHistory(db: Db, r: SkyReceipt): Promise<number> {
  await ensureSkyHistorySchema(db);
  const { from, to } = historyRange(r.receivedAt);
  const values = r.values.filter((v) => v.validAt >= from && v.validAt <= to);
  const id = r.receiptId ?? newReceiptId(r.receivedAt);
  const got = values.map((v) => v.validAt).sort();
  const stmts = values.map((v) =>
    db
      .prepare("INSERT INTO sky_forecast_values (receipt_id, station, item, source, valid_at, fetched_at, unit, value, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, r.station, v.item, r.source, v.validAt, r.receivedAt, SKY_HISTORY_UNITS[v.item], v.value, v.value == null ? "missing" : "ok"),
  );
  stmts.push(
    receiptStmt(db, id, r.receivedAt, r.station, r.source, r.via, {
      kind: "ok",
      fromValid: got[0] ?? null,
      toValid: got[got.length - 1] ?? null,
      range: { from, to },
      req: r.req,
      grid: r.grid,
      model: r.model,
      variant: r.variant,
      appended: values.length,
    }),
  );
  await db.batch(stmts);
  return values.length;
}

/**
 * 取れなかった回の記録（行は足さない）。at は失敗が分かった時刻。kind：fetch＝取得の失敗（応答が無い・HTTP の失敗・中身が無い）／
 * db＝受け取れたが保存に失敗（11/27 レビュー：取れなかった回と分ける）。
 */
export async function recordSkyFailure(db: Db, station: string, source: SkyHistorySource, via: "api" | "cron", at: string, error: string, kind: "fetch" | "db" = "fetch") {
  await ensureSkyHistorySchema(db);
  await receiptStmt(db, newReceiptId(at), at, station, source, via, { kind, error: error.slice(0, 300), appended: 0 }).run();
}

function receiptStmt(
  db: Db,
  id: string,
  at: string,
  station: string,
  source: SkyHistorySource,
  via: string,
  o: {
    kind: "ok" | "fetch" | "db";
    fromValid?: string | null;
    toValid?: string | null;
    range?: { from: string; to: string };
    req?: { lat: number; lon: number } | null;
    grid?: { lat: number | null; lon: number | null } | null;
    model?: string | null;
    variant?: string | null;
    appended: number;
    error?: string;
  },
) {
  return db
    .prepare(
      "INSERT INTO sky_forecast_receipts (receipt_id, at, station, source, via, ok, kind, from_valid, to_valid, range_from, range_to, req_lat, req_lon, grid_lat, grid_lon, model, variant, model_run, appended, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      at,
      station,
      source,
      via,
      o.kind === "ok" ? 1 : 0,
      o.kind,
      o.fromValid ?? null,
      o.toValid ?? null,
      o.range?.from ?? null,
      o.range?.to ?? null,
      o.req?.lat ?? null,
      o.req?.lon ?? null,
      o.grid?.lat ?? null,
      o.grid?.lon ?? null,
      o.model ?? null,
      o.variant ?? null,
      null,
      o.appended,
      o.error ?? null,
    );
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
export async function recordForecastReceipt(
  db: Db,
  station: Station,
  f: { hourlyRows: WeatherRow[]; receivedAt: string; grid?: { lat: number | null; lon: number | null }; variant?: string; model?: string },
  via: "api" | "cron" = "api",
) {
  if (!STATION_PLACES[station.blockNo]) return 0;
  const c = coords(station);
  return recordSkyHistory(db, {
    station: station.blockNo,
    source: "open-meteo-forecast",
    via,
    receivedAt: f.receivedAt,
    values: forecastValues(f.hourlyRows),
    req: { lat: +c.latitude, lon: +c.longitude },
    grid: f.grid ?? null,
    model: f.model ?? null,
    variant: f.variant ?? null,
  });
}

const RETRY_MS = 10 * 60_000;
/** 締め切りの前に必ず取る時間（日本時間 13:45〜13:59）の始まり。その時間でなければ null。 */
export function preCutoffStart(now: number): number | null {
  const start = Date.parse(`${jstDay(now)}T13:45:00+09:00`);
  return now >= start && now < start + 15 * 60_000 ? start : null;
}
/**
 * 定時の取得が要るか（予報・AOD で同じ決まり）：1時間に1回（日付が変われば すぐ）。14時の締め切りの直前（13:45〜13:59）に
 * まだ取れていなければ必ず取る（11/27 レビュー：締め切りの値が1〜2時間古くなることがあった）。間隔は**取れた回**で数え、
 * 取れなかった回のあとは 10 分あけて取り直す。lastOk：最後に取れた時刻、lastTry：最後に試した時刻（取れなかった回も）。
 */
export function fetchDue(lastOk: string | null, lastTry: string | null, now: number): boolean {
  if (lastTry && lastTry !== lastOk && Date.parse(lastTry) > now - RETRY_MS) return false;
  if (!lastOk) return true;
  const t = Date.parse(lastOk);
  if (jstDay(t) !== jstDay(now)) return true;
  const w = preCutoffStart(now);
  if (w !== null && t < w) return true;
  return t <= now - EVERY_MS + 60_000;
}

/**
 * 定時処理：アプリが開かれていない時間も残す。画面の取得と同じ fetchForecast で（信頼度のアンサンブルは取らない）、
 * fetchDue の決まりで（その1時間に画面の取得で残していれば取らない）。取得の失敗と保存の失敗は分けて記録する。
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
      .prepare("SELECT MAX(CASE WHEN ok = 1 THEN at END) AS ok_at, MAX(at) AS try_at FROM sky_forecast_receipts WHERE station = ? AND source = 'open-meteo-forecast'")
      .bind(blockNo)
      .first<{ ok_at: string | null; try_at: string | null }>();
    if (!fetchDue(last?.ok_at ?? null, last?.try_at ?? null, now)) continue;
    ran = true;
    let f: Awaited<ReturnType<typeof fetchForecast>>;
    try {
      f = await fetchForecast(station, { ...opt, confidence: false });
    } catch (e) {
      ok = false;
      await recordSkyFailure(db, blockNo, "open-meteo-forecast", "cron", new Date(clock()).toISOString(), String(e instanceof Error ? e.message : e));
      continue;
    }
    try {
      appended += await recordForecastReceipt(db, station, f, "cron");
    } catch (e) {
      ok = false;
      await recordSkyFailure(db, blockNo, "open-meteo-forecast", "cron", new Date(clock()).toISOString(), String(e instanceof Error ? e.message : e), "db").catch(() => undefined);
    }
  }
  return ran ? { appended, ok } : { appended: 0, ok: true, skipped: true };
}

/** 前日14時（日本時間）：対象日 date の答え合わせに使う予報の締め切り（この時刻ちょうどまでに受け取った値。過ぎた値は混ぜない）。 */
export const dayBeforeCutoff = (date: string) => new Date(Date.parse(`${addDays(date, -1)}T14:00:00+09:00`)).toISOString();

export interface SkyAsOf {
  item: SkyHistoryItem;
  validAt: string;
  /**
   * 選んだ出典：優先順位の前から、締め切りまでに ok の値を受け取っていた最初の出典。どの出典にも ok の値が無ければ、
   * 締め切りまでに行（missing）のある最初の出典。行がどこにも無ければ null。
   */
  source: SkyHistorySource | null;
  /** その出典で、締め切りまでに受け取ったいちばん新しい ok の値（欠測の回のあとも、その前に受け取った値とその時刻）。 */
  value: number | null;
  unit: string;
  /** その値を受け取った回の受信時刻。 */
  fetchedAt: string | null;
  /** ok：値がある／missing：締め切りまでの最後の回の応答に値が無かった（前の値があれば返す）／none：締め切りまでに記録が無い＝再現不可。 */
  status: "ok" | "missing" | "none";
  /** 締め切りまでに、その出典でこの対象時刻を含む応答を最後に受け取った時刻（値の行から。頼んだ範囲ではなく、返ってきた時間で）。 */
  confirmedAt: string | null;
}

/**
 * 締め切り（cutoff、ISO）までに受け取った値に絞り、項目の出典の優先順位で選ぶ（cutoff ちょうどは含み、直後は含まない）。
 * 同じ受信時刻の回どうしは受信の ID の順（保存の順によらない）。sources はテスト用（ふだんは SKY_HISTORY_SOURCES）。
 */
export async function skyAsOf(db: Db, station: string, item: SkyHistoryItem, validAt: string, cutoff: string, sources: readonly string[] = SKY_HISTORY_SOURCES[item]): Promise<SkyAsOf> {
  await ensureSkyHistorySchema(db);
  const per: SkyAsOf[] = [];
  for (const source of sources) {
    const rows = (
      await db
        .prepare(
          "SELECT fetched_at, value, status FROM sky_forecast_values WHERE station = ? AND item = ? AND source = ? AND valid_at = ? AND fetched_at <= ? ORDER BY fetched_at DESC, receipt_id DESC",
        )
        .bind(station, item, source, validAt, cutoff)
        .all<{ fetched_at: string; value: number | null; status: "ok" | "missing" }>()
    ).results;
    const okRow = rows.find((r) => r.status === "ok");
    per.push({
      item,
      validAt,
      source: rows.length ? (source as SkyHistorySource) : null,
      value: okRow?.value ?? null,
      unit: SKY_HISTORY_UNITS[item],
      fetchedAt: okRow?.fetched_at ?? null,
      status: rows.length ? rows[0].status : "none",
      confirmedAt: rows[0]?.fetched_at ?? null,
    });
  }
  const none: SkyAsOf = { item, validAt, source: null, value: null, unit: SKY_HISTORY_UNITS[item], fetchedAt: null, status: "none", confirmedAt: null };
  return per.find((p) => p.fetchedAt != null) ?? per.find((p) => p.status !== "none") ?? none;
}

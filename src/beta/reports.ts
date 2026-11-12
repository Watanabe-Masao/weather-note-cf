// β②: how it felt, reported by the person, with the weather at that moment attached.
//
// Reports are the person's own records and cannot be fetched again, so they live in their own
// database (not the weather cache): 保存データを消去 never touches them, and the weather data's
// version bumps never rebuild them. Each report carries a snapshot of the station's hour (with
// where each value came from: AMeDAS, JMA or forecast), the 最近の基準 and the differences, so a
// later analysis (M0–M3 of the proposal) needs nothing else. `updatedAt` / `deleted` are kept for
// syncing (β③).

import { type IDBPDatabase, openDB } from "idb";
import { inputQuality } from "./quality";
import { FEEL_TRANSFORM, feelOf, type FeelSettings, radiationOf } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import { hourOrigin, type Origin } from "../data/authority";
import { type Baseline, type Departures, halfLifeDays, updateRate } from "./adaptation";
import type { ComfortPrediction } from "./comfort";

/**
 * The 7-point thermal sensation scale (−3 … +3, after ASHRAE 55), in short words that fit a
 * phone's width and match the 肌感 levels one to one. The numbers are what is analysed.
 */
/**
 * Version of the words of the scale (the numbers −3…+3 never change, but the same number was asked
 * in other words, so analysis can tell them apart; reports without it are 1):
 *   1: 寒い・涼しい・やや涼しい・どちらでもない／適温・やや暖かい・暖かい・暑い
 *   2: 極寒・寒い・涼しい・快適・暖かい・暑い・猛暑
 *   3: 極寒・寒い・涼しい・ちょうどよい・暖かい・暑い・猛暑 — 0 is thermal neutral (neither warm nor
 *      cold), not comfort: "暖かいけれど快適" is possible, and comfort would be a question of its own.
 */
export const SCALE_VERSION = 3;

export const SENSATIONS = [
  { value: -3, label: "極寒" },
  { value: -2, label: "寒い" },
  { value: -1, label: "涼しい" },
  { value: 0, label: "ちょうどよい" },
  { value: 1, label: "暖かい" },
  { value: 2, label: "暑い" },
  { value: 3, label: "猛暑" },
] as const;
export const EXPOSURES = [
  { id: "sun", label: "日なた" },
  { id: "shade", label: "日かげ" },
  { id: "mixed", label: "半々" },
] as const;
export const WINDS = [
  { id: "strong", label: "強い" },
  { id: "weak", label: "弱い" },
  { id: "none", label: "なし" },
] as const;

/**
 * Two optional questions after the feeling (#63 P1): which way the person would like to feel, and
 * which drink temperature they would choose now. Separate from the 7-step feeling (what is felt):
 * these ask what is wanted. Skipping is allowed and is not "either": an unanswered question stays
 * undefined. Only the temperature of the drink is asked — not whether they want to drink.
 */
export const THERMAL_PREFERENCES = [
  { id: "warmer", label: "もう少し暖かく" },
  { id: "same", label: "このままでよい" },
  { id: "cooler", label: "もう少し涼しく" },
] as const;
export type ThermalPreference = (typeof THERMAL_PREFERENCES)[number]["id"];
export const DRINK_PREFERENCES = [
  { id: "warm", label: "温かい飲み物" },
  { id: "either", label: "どちらでもよい" },
  { id: "cold", label: "冷たい飲み物" },
] as const;
export type DrinkPreference = (typeof DRINK_PREFERENCES)[number]["id"];
/** The version of these two questions' wording; set on every report they were shown on. */
export const PREFERENCE_VERSION = 1;

/** What the sky looks like where the person is (JMA's observation words), to set beside the forecast. */
export const SKIES = [
  { id: "clear", label: "快晴" },
  { id: "sunny", label: "晴れ" },
  { id: "thin", label: "薄曇り" },
  { id: "cloudy", label: "曇り" },
  { id: "rain", label: "雨" },
  { id: "snow", label: "雪" },
] as const;
export type Sky = (typeof SKIES)[number]["id"];

export type Sensation = (typeof SENSATIONS)[number]["value"];
export type Exposure = (typeof EXPOSURES)[number]["id"];
export type WindFelt = (typeof WINDS)[number]["id"];

/** The station's values for the hour, each with its source. */
export interface Snapshot {
  /** The hour used (JMA hour n = the value at n:00) and its date. */
  date: string;
  hour: number;
  /** Minutes past `hour` of the observation taken for temperature, humidity and wind: the latest
   *  10-minute AMeDAS value when it is newer than the hour (12:15 → 12:10, not 12:00). Absent
   *  when the hour's own value was used (reports before this, too). */
  minute?: number;
  /** Sunrise and sunset of the station that day ("HH:MM" JST), when known at sending: what is day and
   *  night for this report, by the sun and not by the clock (comfort-5 candidate, #86). */
  sunrise?: string;
  sunset?: string;
  temp: number | null;
  humidity: number | null;
  wind: number | null;
  /** W/m². */
  solar: number | null;
  from: Partial<Record<"temp" | "humidity" | "wind" | "solar", Origin>>;
  /** 日なた温度 / 日かげ温度 for that hour (with the 肌感 settings of the moment). */
  sunTemp: number | null;
  shadeTemp: number | null;
  /** The forecast's weather for that hour (Open-Meteo), to compare with what was seen. */
  forecastSky: string | null;
  forecastSkyCode: number | null;
  /** Global radiation summed over the day's hours up to this one (MJ/m²), and how many of those
   *  hours were measured (the rest lent by the forecast: AMeDAS has no radiation). */
  radDay?: number | null;
  radDayMeasuredHours?: number;
  /** Wind as an amount, not an instant: the mean of the last 6 hours, of the last 12 hours, and of
   *  last night (18時 the day before to 6時), m/s. The day before's hours come from the store. */
  wind6h?: number | null;
  wind12h?: number | null;
  windLastNight?: number | null;
  /** How 日なた温度・日かげ温度 were computed (shared/feel.ts: FEEL_TRANSFORM), and when the hours
   *  were fetched (ISO). Kept as they were: a later correction of the weather never rewrites them. */
  transform?: string;
  retrievedAt?: string;
}

/**
 * Wind over time from the hourly rows of the day before and of the day (JMA hour n = n:00),
 * placed on one line: the day before's hour n at n − 24.
 */
export function windMemory(today: WeatherRow[], before: WeatherRow[] | null, hour: number): Pick<Snapshot, "wind6h" | "wind12h" | "windLastNight"> {
  const line = [...(before ?? []).map((r) => ({ t: r.n - 24, w: num(r.wind) })), ...today.map((r) => ({ t: r.n, w: num(r.wind) }))];
  const meanOf = (from: number, to: number) => {
    const ws = line.filter((p) => p.t > from && p.t <= to && p.w != null).map((p) => p.w as number);
    return ws.length >= Math.min(3, to - from) ? Math.round((ws.reduce((a, b) => a + b, 0) / ws.length) * 10) / 10 : null;
  };
  return { wind6h: meanOf(hour - 6, hour), wind12h: meanOf(hour - 12, hour), windLastNight: meanOf(-7, 6) };
}

/** One of the days before, as the daily table has it, with its source. */
export interface RecentDay {
  date: string;
  mean: number | null;
  max: number | null;
  min: number | null;
  humidity: number | null;
  /** 日照時間 (h). */
  sun: number | null;
  /** 全天日射量 (MJ/m²). */
  radiation: number | null;
  rain: number | null;
  /** Mean wind (m/s). */
  wind?: number | null;
  weather: string | null;
  from: Origin | null;
}

export const RECENT_DAYS = 7;

export interface Report {
  id: string;
  /** When it was reported (ISO, UTC). */
  at: string;
  station: string;
  sensation: Sensation;
  exposure: Exposure;
  windFelt: WindFelt;
  /** The sky the person saw (reports before it was asked have none). */
  sky?: Sky;
  /** The two optional preference questions (#63 P1). Undefined = not answered; reports without
   *  `preferenceVersion` were made before the questions existed. */
  thermalPreference?: ThermalPreference;
  drinkPreference?: DrinkPreference;
  preferenceVersion?: number;
  /** When the report screen was opened (a notification's time can differ from `at`, the sending). */
  openedAt?: string;
  /** When the notification that led here was due (ISO), if the report came from one: how long
   *  people take to answer is part of the analysis. */
  notifiedAt?: string;
  /** The comfort model's prediction made at sending, before the answer was known (comfort.ts):
   *  the centre and range of that moment and the chance of each answer. Its misses are the record. */
  comfort?: ComfortPrediction;
  snapshot: Snapshot | null;
  baseline: (Baseline & { alpha: number }) | null;
  departures: Pick<Departures, "air" | "sun" | "shade"> | null;
  /** The 60 daily mean temperatures before the day, newest first (null where missing): lets the
   *  最近の基準 be recomputed for any α when 慣れの速さ is chosen by the comfort fit (comfort.ts). */
  history?: (number | null)[];
  /** The 7 days before, newest first: how the previous day and week (humidity, sunshine, rain,
   *  weather) carry into the feeling, for the analysis in research/. */
  recent?: RecentDay[];
  /** For syncing: last change (ms) and a soft delete. */
  updatedAt: number;
  deleted?: boolean;
  /** The words the answer was given in (SCALE_VERSION; missing: 1). */
  scaleVersion?: number;
  /** Whose report it is (the account's id); none until the first sync after a login (sync.ts). */
  owner?: string;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * The station's hour closest before `hour` that has a measured or forecast temperature, and its
 * values with their sources. Today's hours mix AMeDAS and forecast; each row says which it is.
 */
export function snapshotOf(
  rows: WeatherRow[] | null,
  hour: number,
  feel: FeelSettings,
  before: WeatherRow[] | null = null,
  retrievedAt?: number,
  live?: { latest: WeatherRow | null; now: number; sun?: { sunrise: string | null; sunset: string | null } | null },
): Snapshot | null {
  if (!rows?.length) return null;
  const usable = [...rows].filter((r) => r.n <= hour && num(r.temp) != null).sort((a, b) => b.n - a.n);
  let row = usable[0];
  if (!row) return null;
  // The hour whose observation has not arrived yet (AMeDAS comes 10–20 minutes late) holds the
  // forecast: the observed hour just before it is closer to the moment (and teaches the model).
  const lastObserved = usable.find((r) => r.type !== "forecast");
  if (row.type === "forecast" && lastObserved && lastObserved.n >= row.n - 1) row = lastObserved;
  // The moment of the answer, not the top of the hour: the latest 10-minute observation, when it is
  // newer than the hourly value (or the hourly value is a forecast and the observation is recent),
  // and not after the answer. The snapshot then sits at the observation's own clock in JMA's terms
  // (0:50 is 24時 of the day before, minute 50; 12:10 is 12時, minute 10). Radiation, the forecast's
  // sky and the day's sums come from that hour's row when there is one (AMeDAS has no radiation).
  const ten = tenMinute(row, live);
  if (ten && (ten.date !== row.date || ten.hour !== row.n)) {
    const same = rows.find((r) => r.date === ten.date && r.n === ten.hour);
    row = same ? { ...same, temp: row.temp } : { ...row, date: ten.date, n: ten.hour };
  }
  // Each saved hour carries its own source (正本管理); today's observed hours are AMeDAS otherwise.
  const own = hourOrigin(row, { kind: "variable", source: row.type === "forecast" ? "forecast" : "current" });
  const fieldFrom = (k: string): Origin => ((row.origin as Record<string, Origin> | undefined)?.[k] ?? own);
  const solar = radiationOf(row);
  const temp = ten ? num(ten.row.temp) : num(row.temp);
  const humidity = ten ? (num(ten.row.humidity) ?? num(row.humidity)) : num(row.humidity);
  const wind = ten ? (num(ten.row.wind) ?? num(row.wind)) : num(row.wind);
  const forecast = !ten && row.type === "forecast";
  return {
    date: row.date,
    hour: row.n,
    ...(ten ? { minute: ten.minute } : {}),
    temp,
    humidity,
    wind,
    solar: solar == null ? null : Math.round(solar),
    from: {
      temp: ten ? "amedas" : fieldFrom("temp"),
      humidity: ten && num(ten.row.humidity) != null ? "amedas" : fieldFrom("humidity"),
      wind: ten && num(ten.row.wind) != null ? "amedas" : fieldFrom("wind"),
      ...(solar != null ? { solar: fieldFrom(num(row.solar) != null ? "solar" : "radiation") } : {}),
    },
    sunTemp: round1(feelOf(temp, humidity, wind, forecast, { ...feel, sun: true }, solar)),
    shadeTemp: round1(feelOf(temp, humidity, wind, forecast, { ...feel, sun: false }, solar)),
    ...forecastSkyOf(rows, row),
    ...radDayOf(rows, row.n),
    ...windMemory(rows, before, row.n),
    ...sunOf(live?.sun),
    transform: FEEL_TRANSFORM,
    ...(retrievedAt ? { retrievedAt: new Date(retrievedAt).toISOString() } : {}),
  };
}

/** The latest 10-minute observation to use instead of the hour's value, with its minutes past the hour. */
/** "2026-11-12T06:33" → "06:33"; both or nothing. */
function sunOf(sun: { sunrise: string | null; sunset: string | null } | null | undefined): Pick<Snapshot, "sunrise" | "sunset"> {
  const hm = (v: string | null) => /T(\d{2}:\d{2})/.exec(v ?? "")?.[1] ?? null;
  const rise = hm(sun?.sunrise ?? null);
  const set = hm(sun?.sunset ?? null);
  return rise && set ? { sunrise: rise, sunset: set } : {};
}

function tenMinute(row: WeatherRow, live: { latest: WeatherRow | null; now: number } | undefined): { row: WeatherRow; date: string; hour: number; minute: number } | null {
  const l = live?.latest;
  if (!l || typeof l.observedAt !== "string" || typeof l.date !== "string" || num(l.temp) == null) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(l.observedAt);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  // Compared as moments, so 0:20 of the next day follows 24時 of the day before.
  const at = Date.parse(`${l.date}T${m[1]}:${m[2]}:00+09:00`);
  const hourAt = Date.parse(`${row.date}T00:00:00+09:00`) + row.n * 3_600_000;
  const now = live!.now;
  if (!Number.isFinite(at) || at > now + 60_000) return null;
  // Newer than the hourly value; or, when that value is a forecast, observed within the last hour.
  const newer = at > hourAt && at - hourAt < 3 * 3_600_000;
  const recent = row.type === "forecast" && now - at <= 3_600_000;
  if (!newer && !recent) return null;
  // The observation's own clock in JMA's terms: hour 0 belongs to the day before as 24時.
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh === 0) {
    const d = new Date(Date.parse(`${l.date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return { row: l, date: d, hour: 24, minute: mm };
  }
  return { row: l, date: l.date, hour: hh, minute: mm };
}

/** The day's radiation so far: W/m² per hour → MJ/m² (× 0.0036), hours 1…n with a value. */
function radDayOf(rows: WeatherRow[], n: number): Pick<Snapshot, "radDay" | "radDayMeasuredHours"> {
  let sum = 0;
  let any = false;
  let measured = 0;
  for (const r of rows) {
    if (r.n > n) continue;
    const w = radiationOf(r);
    if (w == null) continue;
    any = true;
    sum += w * 0.0036;
    const lent = (r.origin as Record<string, Origin> | undefined)?.solar === "forecast" || r.type === "forecast";
    if (!lent) measured++;
  }
  return { radDay: any ? Math.round(sum * 100) / 100 : null, radDayMeasuredHours: measured };
}

/** The forecast's weather for the hour: its own row, or the weather it lent to the observed row. */
function forecastSkyOf(rows: WeatherRow[], row: WeatherRow): Pick<Snapshot, "forecastSky" | "forecastSkyCode"> {
  const lent = (row.origin as Record<string, Origin> | undefined)?.weather === "forecast" || row.type === "forecast";
  const source = lent ? row : rows.find((r) => r.n === row.n && r.type === "forecast");
  return {
    forecastSky: typeof source?.weather === "string" ? source.weather : null,
    forecastSkyCode: num(source?.weatherCode),
  };
}

/** A past day from its daily row and how the store holds it. */
export function recentDay(date: string, row: WeatherRow | null | undefined, kind: "fixed" | "variable" | null): RecentDay {
  return {
    date,
    mean: num(row?.temp),
    max: num(row?.max),
    min: num(row?.min),
    humidity: num(row?.humidity),
    sun: num(row?.sun),
    radiation: num(row?.radiation),
    rain: num(row?.rain),
    wind: num(row?.wind),
    weather: typeof row?.dayWeather === "string" ? row.dayWeather : null,
    from: !row ? null : row.type === "forecast" ? "forecast" : kind === "fixed" ? "jma-fixed" : "jma",
  };
}

/** The hour (1–24) in Japan for a moment. */
export function jstHourOf(ms: number): number {
  const h = new Date(ms + 9 * 3_600_000).getUTCHours();
  return h === 0 ? 24 : h;
}

/**
 * The station's day and hour for a report made at `now`, from `now` itself (not from the day the
 * sheet was opened on): JMA counts 0:00–0:59 as 24時 of the day before. `before` is the day
 * whose hours come before (for the wind memory).
 */
export function reportMoment(now: number): { day: string; hour: number; before: string } {
  const jst = new Date(now + 9 * 3_600_000);
  const today = jst.toISOString().slice(0, 10);
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const hour = jstHourOf(now);
  const day = hour === 24 ? shift(today, -1) : today;
  return { day, hour, before: shift(day, -1) };
}

// ---- CSV ---------------------------------------------------------------------------------------

const COLUMNS: readonly string[] = [
  "at_jst",
  "opened_at_jst",
  "notified_at_jst",
  "station",
  "sensation",
  "sensation_label",
  "exposure",
  "wind_felt",
  "comfort_mu",
  "comfort_half_range",
  "comfort_step",
  "comfort_blur",
  "comfort_offset",
  "comfort_beyond",
  "pred_mode",
  "pred_expected",
  "p_m3",
  "p_m2",
  "p_m1",
  "p_0",
  "p_p1",
  "p_p2",
  "p_p3",
  "pred_n",
  "pred_alpha",
  "pred_models",
  "pred_error",
  "sky_reported",
  "sky_forecast",
  "sky_forecast_code",
  "obs_date",
  "obs_hour",
  "temp",
  "humidity",
  "wind",
  "solar_w_m2",
  "temp_from",
  "humidity_from",
  "wind_from",
  "solar_from",
  "sun_temp",
  "shade_temp",
  "rad_day_mj",
  "rad_day_measured_h",
  "wind_6h",
  "wind_12h",
  "wind_last_night",
  "baseline",
  "baseline_alpha",
  "update_rate",
  "half_life_days",
  "baseline_forecast_mixed",
  "dep_air",
  "dep_sun",
  "dep_shade",
  "history_60d",
  ...Array.from({ length: RECENT_DAYS }, (_, i) =>
    ["mean", "max", "min", "humidity", "sun_h", "radiation_mj", "rain_mm", "wind", "weather", "from"].map((f) => `d${i + 1}_${f}`),
  ).flat(),
  "id",
  // Added later, at the end so earlier columns keep their places.
  "scale_version",
  "model_version",
  "learning_state",
  "p_cold",
  "p_neutral",
  "p_warm",
  "pred_z",
  "pred_z_lo",
  "pred_z_hi",
  "pred_mu_lo",
  "pred_mu_hi",
  "sd_answer",
  "sd_param",
  "input_status",
  "input_lag_min",
  "input_flags",
  "train_excluded_reason",
  "pred_models_excluded",
  "pred_inputs_missing",
  "feel_transform",
  "retrieved_at",
  "obs_minute",
  "thermal_preference",
  "drink_preference",
  "preference_version",
  "sunrise",
  "sunset",
] as const;

const cell = (v: unknown) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** ISO time in Japan without the zone letter ("2026-11-11T20:31:05+09:00"). */
export function jstIso(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 19);
  return `${d}+09:00`;
}

/** One row per report (deleted ones left out), oldest first, with a BOM so Excel reads Japanese. */
export function toCsv(reports: Report[]): string {
  const live = reports.filter((r) => !r.deleted).sort((a, b) => (a.at < b.at ? -1 : 1));
  const lines = live.map((r) =>
    [
      jstIso(r.at),
      r.openedAt ? jstIso(r.openedAt) : null,
      r.notifiedAt ? jstIso(r.notifiedAt) : null,
      r.station,
      r.sensation,
      SENSATIONS.find((s) => s.value === r.sensation)?.label,
      r.exposure,
      r.windFelt,
      r.comfort?.state.mu,
      r.comfort?.state.h,
      r.comfort?.state.g,
      r.comfort?.state.s,
      r.comfort?.offset,
      r.comfort?.beyond,
      r.comfort?.mode,
      r.comfort?.expected,
      ...(r.comfort?.probs ?? Array(7).fill(null)),
      r.comfort?.n,
      r.comfort?.alpha,
      r.comfort?.models?.map((m) => `${m.id}:${m.weight}:${m.mode}:${m.mu}:${m.h}`).join(";"),
      r.comfort ? Math.round((r.sensation - r.comfort.expected) * 10) / 10 : null,
      r.sky,
      r.snapshot?.forecastSky,
      r.snapshot?.forecastSkyCode,
      r.snapshot?.date,
      r.snapshot?.hour,
      r.snapshot?.temp,
      r.snapshot?.humidity,
      r.snapshot?.wind,
      r.snapshot?.solar,
      r.snapshot?.from.temp,
      r.snapshot?.from.humidity,
      r.snapshot?.from.wind,
      r.snapshot?.from.solar,
      r.snapshot?.sunTemp,
      r.snapshot?.shadeTemp,
      r.snapshot?.radDay,
      r.snapshot?.radDayMeasuredHours,
      r.snapshot?.wind6h,
      r.snapshot?.wind12h,
      r.snapshot?.windLastNight,
      r.baseline?.value,
      r.baseline?.alpha,
      r.baseline ? updateRate(r.baseline.alpha) : null,
      r.baseline ? halfLifeDays(r.baseline.alpha) : null,
      r.baseline ? (r.baseline.forecastMixed ? 1 : 0) : null,
      r.departures?.air,
      r.departures?.sun,
      r.departures?.shade,
      r.history?.map((v) => (v == null ? "" : v)).join(";"),
      ...Array.from({ length: RECENT_DAYS }, (_, i) => {
        const d = r.recent?.[i];
        return [d?.mean, d?.max, d?.min, d?.humidity, d?.sun, d?.radiation, d?.rain, d?.wind, d?.weather, d?.from];
      }).flat(),
      r.id,
      r.scaleVersion ?? 1,
      r.comfort?.version ?? (r.comfort ? "comfort-1" : null),
      r.comfort?.learning,
      r.comfort?.sides?.cold,
      r.comfort?.sides?.neutral,
      r.comfort?.sides?.warm,
      r.comfort?.z,
      r.comfort?.zInterval?.[0],
      r.comfort?.zInterval?.[1],
      r.comfort?.muInterval?.[0],
      r.comfort?.muInterval?.[1],
      r.comfort?.spread?.answer,
      r.comfort?.spread?.param,
      ...(() => {
        const q = inputQuality(r);
        return [q.status, q.lagMin, q.flags.join(";"), q.reason];
      })(),
      r.comfort?.excluded?.join(";"),
      r.comfort?.missing?.join(";"),
      r.snapshot?.transform,
      r.snapshot?.retrievedAt ? jstIso(r.snapshot.retrievedAt) : null,
      r.snapshot?.minute ?? null,
      r.thermalPreference ?? null,
      r.drinkPreference ?? null,
      r.preferenceVersion ?? null,
      r.snapshot?.sunrise ?? null,
      r.snapshot?.sunset ?? null,
    ]
      .map(cell)
      .join(","),
  );
  return "﻿" + [COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}

// ---- storage -----------------------------------------------------------------------------------

const DB = "weather-note-reports";
const STORE = "reports";

export interface ReportStore {
  all(): Promise<Report[]>;
  put(r: Report): Promise<void>;
  /** Soft delete (kept for syncing). */
  remove(id: string): Promise<void>;
  /** Remove every report from this device. */
  wipe(): Promise<void>;
  /** Remove these reports from this device only (at logout; the server keeps them). */
  drop(ids: string[]): Promise<void>;
}

let opened: Promise<IDBPDatabase> | null = null;
const db = () =>
  (opened ??= openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: "id" });
    },
  }));

/** Reports in IndexedDB; in memory when IndexedDB is not available (private browsing). */
export function reportStore(): ReportStore {
  const memory = new Map<string, Report>();
  const safe = async <T>(fn: (d: IDBPDatabase) => Promise<T>, fallback: () => T): Promise<T> => {
    try {
      return await fn(await db());
    } catch {
      return fallback();
    }
  };
  return {
    all: () => safe((d) => d.getAll(STORE) as Promise<Report[]>, () => [...memory.values()]),
    put: (r) => safe(async (d) => void (await d.put(STORE, r)), () => void memory.set(r.id, r)),
    remove: (id) =>
      safe(
        async (d) => {
          const r = (await d.get(STORE, id)) as Report | undefined;
          if (r) await d.put(STORE, { ...r, deleted: true, updatedAt: Date.now() });
        },
        () => {
          const r = memory.get(id);
          if (r) memory.set(id, { ...r, deleted: true, updatedAt: Date.now() });
        },
      ),
    wipe: () => safe((d) => d.clear(STORE), () => memory.clear()),
    drop: (ids) =>
      safe(
        async (d) => {
          const tx = d.transaction(STORE, "readwrite");
          await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
        },
        () => ids.forEach((id) => memory.delete(id)),
      ),
  };
}

/** A new report id (random, no personal information in it). */
export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

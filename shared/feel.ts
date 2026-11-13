// How the day feels (spec chapter 4). Shared by the table's feel row and the temperature-band map.
//
// 1. Apparent temperature: improved Missenard formula with temperature, humidity and wind.
// 2. Wind is converted from the anemometer height to a person's height (power law).
// 3. In the sun, the Australian Bureau of Meteorology's radiation term is added on top.
// 4. The day is split into five bands, each the average of three hours.
// 5. Each band gets one of five levels; a phrase describes the day.

import { dayParts, hoursIn, PARTS, type PartWindow } from "./dayParts";
import { sunshineRadiation } from "./mrt";
import type { WeatherRow } from "./types";

// ---- settings --------------------------------------------------------------------------------

export interface FeelSettings {
  /** The six boundaries of the seven steps 寒い … 暑い (℃ of apparent temperature), ascending. */
  thresholds: Thresholds;
  /** Surroundings exponent: 0.14 open, 0.20 residential, 0.30 urban, 0.40 dense urban. */
  alpha: number;
  /** Anemometer height for observed values (m). Forecast wind is always at 10 m. */
  stationHeight: number;
  /** Share of global radiation the body absorbs (Q = k × radiation). */
  absorb: number;
  /** In the sun (radiation counted) or in the shade. */
  sun: boolean;
  /** How many steps to show (the levels are always computed on seven). */
  scale?: Scale;
}

export const SURROUNDINGS = [
  { label: "開けた場所", alpha: 0.14 },
  { label: "住宅地", alpha: 0.2 },
  { label: "市街地", alpha: 0.3 },
  { label: "建物が密集", alpha: 0.4 },
] as const;

// Default: dense urban (wind × 0.47 at 10 m), chosen after the first look at real data felt too cold.
export const DEFAULT_FEEL: FeelSettings = {
  thresholds: [5, 10, 15, 21, 25, 29],
  alpha: 0.4,
  stationHeight: 10,
  absorb: 0.2, // raised from 0.12 after the first look: sunny spots felt warmer than shown
  sun: true,
};

export const PERSON_HEIGHT = 1.5;
export const FORECAST_WIND_HEIGHT = 10;

// ---- formulas --------------------------------------------------------------------------------

/** Wind at a person's height from wind measured at `height` metres. */
export function windAtPerson(v: number, height: number, alpha: number): number {
  return v * (PERSON_HEIGHT / height) ** alpha;
}

/** Improved Missenard apparent temperature. t ℃, h %, v m/s at a person's height. */
export function apparentTemperature(t: number, h: number, v: number): number {
  const a = 1.76 + 1.4 * Math.max(0, v) ** 0.75;
  return 37 - (37 - t) / (0.68 - 0.0014 * h + 1 / a) - 0.29 * t * (1 - h / 100);
}

/**
 * Warming from sunshine: the radiation term of the Bureau of Meteorology's apparent temperature,
 * 0.70·Q/(v₁₀ + 10), with Q = k × global radiation (W/m²) and v₁₀ the wind at 10 m.
 */
export function sunWarming(radiation: number, wind10: number, absorb: number): number {
  return (0.7 * absorb * Math.max(0, radiation)) / (Math.max(0, wind10) + 10);
}

/** JMA hourly 日射量 is MJ/m² over the hour; as a mean flux that is × 1e6 / 3600 W/m². */
export const MJ_PER_HOUR_TO_W = 1e6 / 3600;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Global radiation of a row in W/m² (forecast `solar`, or JMA `radiation` in MJ/m²); null when not measured. */
export function radiationOf(row: Record<string, unknown>): number | null {
  const solar = num(row.solar);
  if (solar != null) return solar;
  const mj = num(row.radiation);
  return mj == null ? null : mj * MJ_PER_HOUR_TO_W;
}

/**
 * Apparent temperature for one reading, or null when temperature, humidity or wind is missing.
 * `radiation` (W/m²) adds the sunshine term when the settings say "in the sun"; null means none.
 */
/**
 * Version of how 肌感（日なた・日かげ） are computed from the weather (MATH-03). Stored with each
 * report, so that a report can be read with the method it was made with.
 * feel-1s (#103): 日なた's radiation is estimated from the hour's sunshine and rain (shared/mrt.ts
 * sunshineRadiation) at every station and for records and forecasts alike; feel-1 used the measured
 * radiation where a station had it, and the forecast's elsewhere only on forecast days.
 */
export const FEEL_TRANSFORM = "feel-1s";

export function feelOf(
  temp: unknown,
  humidity: unknown,
  wind: unknown,
  forecast: boolean,
  s: FeelSettings,
  radiation: number | null = null,
): number | null {
  const t = num(temp);
  const h = num(humidity);
  const v = num(wind);
  if (t == null || h == null || v == null) return null;
  const height = forecast ? FORECAST_WIND_HEIGHT : s.stationHeight;
  const base = apparentTemperature(t, h, windAtPerson(v, height, s.alpha));
  if (!s.sun || radiation == null) return base;
  return base + sunWarming(radiation, wind10Of(v, forecast, s), s.absorb);
}

/** The wind at 10 m (what the Bureau of Meteorology's radiation term takes) from a row's wind. */
export function wind10Of(v: number, forecast: boolean, s: Pick<FeelSettings, "stationHeight" | "alpha">): number {
  const height = forecast ? FORECAST_WIND_HEIGHT : s.stationHeight;
  return forecast ? v : v * (FORECAST_WIND_HEIGHT / height) ** s.alpha;
}

// ---- levels ----------------------------------------------------------------------------------

// Seven steps, the same words and order as the 感じ方 reports (ASHRAE 55's 7-point scale), so the
// 肌感 levels and what people report can be set side by side. Five and three are groupings of the
// seven for compact displays; the calculation is always on the seven.

export type Thresholds = [number, number, number, number, number, number];

export const LEVELS = ["寒い", "肌寒い", "涼しい", "暑くも寒くもない", "暖かい", "少し暑い", "暑い"] as const;
/** The comfortable levels (ちょうどよい範囲): 涼しい〜暖かい. 肌寒い and 少し暑い are not (2026-11-13). */
export const COMFORT_LEVELS: readonly Level[] = [2, 3, 4];
export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function levelOf(apparent: number, s: FeelSettings = DEFAULT_FEEL): Level {
  const i = s.thresholds.findIndex((upTo) => apparent < upTo);
  return (i < 0 ? 6 : i) as Level;
}

export type Scale = 7 | 5 | 3;
export const SCALES: Scale[] = [7, 5, 3];

/** The steps of each scale: their names and which of the seven each one gathers. */
export const SCALE_STEPS: Record<Scale, { label: string; of: Level[] }[]> = {
  7: LEVELS.map((label, i) => ({ label, of: [i as Level] })),
  5: [
    { label: "寒い", of: [0, 1] },
    { label: "涼しい", of: [2] },
    { label: "暑くも寒くもない", of: [3] },
    { label: "暖かい", of: [4] },
    { label: "暑い", of: [5, 6] },
  ],
  // Three: the uncomfortable sides and the comfortable middle (涼しい〜暖かい).
  3: [
    { label: "寒い側", of: [0, 1] },
    { label: "ちょうどよい", of: [2, 3, 4] },
    { label: "暑い側", of: [5, 6] },
  ],
};

/** The step (0-based, within the scale) that a seven-step level falls in. */
export function stepOf(level: Level, scale: Scale): number {
  return SCALE_STEPS[scale].findIndex((st) => st.of.includes(level));
}

/** The boundaries between a scale's steps (a subset of the six). */
export function scaleThresholds(t: Thresholds, scale: Scale): number[] {
  return scale === 7 ? [...t] : scale === 5 ? [t[1], t[2], t[3], t[4]] : [t[1], t[4]];
}

/** Old settings had four boundaries (5 steps): they become the inner four; the outer two are spaced alike. */
export function thresholdsFrom(saved: number[]): Thresholds | null {
  if (saved.length === 6) return saved as Thresholds;
  if (saved.length === 4) {
    const [t0, t1, t2, t3] = saved;
    return [t0 - (t1 - t0), t0, t1, t2, t3, t3 + (t3 - t2)];
  }
  return null;
}

// ---- five bands ------------------------------------------------------------------------------

/** The five 時間区分, by the sun (shared/dayParts.ts): which hours each holds depends on the day and the station. */
export const BANDS = PARTS;

export interface Band {
  label: string;
  /** The part's window that day (minutes JST) and its JMA hours. */
  window?: PartWindow;
  hours?: number[];
  /** Average apparent temperature of the hours that had all three values; null when none did. */
  feel: number | null;
  /** Average air temperature. */
  temp: number | null;
  level: Level | null;
  /** All hours are forecast / some are forecast (today in progress). */
  source: "actual" | "forecast" | "mixed";
  /** False when no hour of the band had sunshine to go by (night, or sunshine not given). */
  sunCounted: boolean;
}

const mean = (vs: number[]) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);

/** Five bands from hourly rows of one day at a station (JMA hour n = the value at n:00). */
export function hourlyBands(rows: WeatherRow[], s: FeelSettings, station: string | null): Band[] {
  const byHour = new Map(rows.map((r) => [r.n, r]));
  const date = rows[0]?.date ?? "2026-03-20";
  return dayParts(date, station).map((w) => {
    const ns = hoursIn(w);
    const hours = ns.map((h) => byHour.get(h)).filter((r): r is WeatherRow => !!r);
    const feels = hours
      .map((r) => feelOf(r.temp, r.humidity, r.wind, r.type === "forecast", s, sunshineRadiation(r, station)))
      .filter((v): v is number => v != null);
    const temps = hours.map((r) => num(r.temp)).filter((v): v is number => v != null);
    const forecastCount = hours.filter((r) => r.type === "forecast").length;
    const feel = mean(feels);
    return {
      label: w.label,
      window: w,
      hours: ns,
      feel,
      temp: mean(temps),
      level: feel == null ? null : levelOf(feel, s),
      source: forecastCount === 0 ? "actual" : forecastCount === hours.length ? "forecast" : "mixed",
      sunCounted: hours.some((r) => sunshineRadiation(r, station) != null),
    };
  });
}

/** The bands that stand for "the day" in one number: 日中, 昼, 夕方 (the last three quarters of the daylight). */
export const DAYTIME_BANDS = ["forenoon", "noon", "evening"] as const;

/**
 * One feel value for the whole day: the mean of the 日中, 昼 and 夕方 band values.
 * Null unless all three bands have a value (never filled in from part of the day).
 */
export function daytimeFeel(rows: WeatherRow[], s: FeelSettings, station: string | null): number | null {
  if (!rows.length) return null;
  const bands = hourlyBands(rows, s, station);
  const values = DAYTIME_BANDS.map((id) => bands[BANDS.findIndex((b) => b.id === id)].feel);
  if (values.some((v) => v == null)) return null;
  return Math.round(((values as number[]).reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * The estimate used before hourly data is available: three segments from the daily row.
 * Morning and night from the minimum, midday from the maximum, both with the day's mean humidity and wind.
 * Never fills the other bands by guessing.
 */
export function estimatedBands(row: WeatherRow | null, s: FeelSettings = DEFAULT_FEEL): Band[] | null {
  if (!row) return null;
  const forecast = row.type === "forecast";
  const low = feelOf(row.min, row.humidity, row.wind, forecast, s);
  const high = feelOf(row.max, row.humidity, row.wind, forecast, s);
  if (low == null || high == null) return null;
  const band = (label: string, feel: number, temp: unknown): Band => ({
    label,
    feel,
    temp: num(temp),
    level: levelOf(feel, s),
    source: forecast ? "forecast" : "actual",
    sunCounted: false, // the daily total cannot give a midday value, so the estimate leaves sunshine out
  });
  return [band("朝晩", low, row.min), band("昼", high, row.max), band("朝晩", low, row.min)];
}

// ---- describing the day ----------------------------------------------------------------------

/** Spread between the warmest and coolest band (apparent ℃), or null with fewer than two bands. */
export function spread(bands: Band[]): number | null {
  const feels = bands.map((b) => b.feel).filter((v): v is number => v != null);
  return feels.length < 2 ? null : Math.max(...feels) - Math.min(...feels);
}

/**
 * A short phrase for the day, judged mainly on morning, midday and night.
 * Cold = 涼しい or below, hot = 暑い or above.
 */
export function describe(bands: Band[]): string | null {
  const pick = (label: string) => bands.find((b) => b.label === label)?.level ?? null;
  const morning = pick("朝") ?? pick("朝晩");
  const noon = pick("昼");
  const night = pick("夜") ?? pick("朝晩");
  if (morning == null || noon == null || night == null) return null;
  const cold = (l: Level) => l <= 2;
  const hot = (l: Level) => l >= 5;
  if (hot(morning) && hot(noon) && hot(night)) return "一日中暑い";
  if (cold(morning) && cold(noon) && cold(night)) return "一日中寒い";
  if (cold(morning) && cold(night) && hot(noon)) return "朝晩は冷えるが昼は暑い";
  if (cold(morning) && cold(night)) return "朝晩は冷える";
  if (cold(morning)) return "朝だけ冷える";
  if (cold(night)) return "夜から冷え込む";
  if (cold(noon)) return "昼も気温が上がらない";
  if (hot(noon)) return "昼は暑い";
  return "過ごしやすい一日";
}

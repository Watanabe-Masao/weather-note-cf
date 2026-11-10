// How the day feels (spec chapter 4). Shared by the table's feel row and the temperature-band map.
//
// 1. Apparent temperature: improved Missenard formula with temperature, humidity and wind.
// 2. Wind is converted from the anemometer height to a person's height (power law).
// 3. The day is split into five bands, each the average of three hours.
// 4. Each band gets one of five levels; a phrase describes the day.

import type { WeatherRow } from "./types";

// ---- settings --------------------------------------------------------------------------------

export interface FeelSettings {
  /** Upper bounds of 寒い, 肌寒い, 過ごしやすい, 暖かい (℃ of apparent temperature). */
  thresholds: [number, number, number, number];
  /** Surroundings exponent: 0.14 open, 0.20 residential, 0.30 urban, 0.40 dense urban. */
  alpha: number;
  /** Anemometer height for observed values (m). Forecast wind is always at 10 m. */
  stationHeight: number;
}

export const SURROUNDINGS = [
  { label: "開けた場所", alpha: 0.14 },
  { label: "住宅地", alpha: 0.2 },
  { label: "市街地", alpha: 0.3 },
  { label: "建物が密集", alpha: 0.4 },
] as const;

// Default: dense urban (wind × 0.47 at 10 m), chosen after the first look at real data felt too cold.
export const DEFAULT_FEEL: FeelSettings = { thresholds: [10, 15, 21, 25], alpha: 0.4, stationHeight: 10 };

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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Apparent temperature for one row, or null when temperature, humidity or wind is missing. */
export function feelOf(temp: unknown, humidity: unknown, wind: unknown, forecast: boolean, s: FeelSettings): number | null {
  const t = num(temp);
  const h = num(humidity);
  const v = num(wind);
  if (t == null || h == null || v == null) return null;
  const height = forecast ? FORECAST_WIND_HEIGHT : s.stationHeight;
  return apparentTemperature(t, h, windAtPerson(v, height, s.alpha));
}

// ---- levels ----------------------------------------------------------------------------------

export const LEVELS = ["寒い", "肌寒い", "過ごしやすい", "暖かい", "暑い"] as const;
export type Level = 0 | 1 | 2 | 3 | 4;

export function levelOf(apparent: number, s: FeelSettings = DEFAULT_FEEL): Level {
  const i = s.thresholds.findIndex((upTo) => apparent < upTo);
  return (i < 0 ? 4 : i) as Level;
}

// ---- five bands ------------------------------------------------------------------------------

export const BANDS = [
  { id: "morning", label: "朝", hours: [6, 7, 8] },
  { id: "forenoon", label: "日中", hours: [9, 10, 11] },
  { id: "noon", label: "昼", hours: [12, 13, 14] },
  { id: "evening", label: "夕方", hours: [15, 16, 17] },
  { id: "night", label: "夜", hours: [18, 19, 20] },
] as const;

export interface Band {
  label: string;
  /** Average apparent temperature of the hours that had all three values; null when none did. */
  feel: number | null;
  /** Average air temperature. */
  temp: number | null;
  level: Level | null;
  /** All hours are forecast / some are forecast (today in progress). */
  source: "actual" | "forecast" | "mixed";
}

const mean = (vs: number[]) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);

/** Five bands from hourly rows (JMA hour n = the value at n:00). */
export function hourlyBands(rows: WeatherRow[], s: FeelSettings = DEFAULT_FEEL): Band[] {
  const byHour = new Map(rows.map((r) => [r.n, r]));
  return BANDS.map((b) => {
    const hours = b.hours.map((h) => byHour.get(h)).filter((r): r is WeatherRow => !!r);
    const feels = hours
      .map((r) => feelOf(r.temp, r.humidity, r.wind, r.type === "forecast", s))
      .filter((v): v is number => v != null);
    const temps = hours.map((r) => num(r.temp)).filter((v): v is number => v != null);
    const forecastCount = hours.filter((r) => r.type === "forecast").length;
    const feel = mean(feels);
    return {
      label: b.label,
      feel,
      temp: mean(temps),
      level: feel == null ? null : levelOf(feel, s),
      source: forecastCount === 0 ? "actual" : forecastCount === hours.length ? "forecast" : "mixed",
    };
  });
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
 * Cold = 肌寒い or below, hot = 暑い.
 */
export function describe(bands: Band[]): string | null {
  const pick = (label: string) => bands.find((b) => b.label === label)?.level ?? null;
  const morning = pick("朝") ?? pick("朝晩");
  const noon = pick("昼");
  const night = pick("夜") ?? pick("朝晩");
  if (morning == null || noon == null || night == null) return null;
  const cold = (l: Level) => l <= 1;
  const hot = (l: Level) => l >= 4;
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

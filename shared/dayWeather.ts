// The day's weather to show while JMA's 天気概況 is not out yet.
//
// JMA writes the day's weather summary (天気概況) a while after the day: for the latest day or two
// the table has every measured value but no weather, so the day showed "—". Until it arrives,
// the weather is estimated from what was measured — precipitation, and sunshine against the
// length of the day — and shown as an estimate. It is never stored as the day's weather: JMA's
// summary replaces it as soon as it comes, and nothing that decides whether a day is fixed reads it.

import type { WeatherRow } from "./types";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Hours between sunrise and sunset (standard formula with refraction; within a few minutes). */
export function dayLengthHours(date: string, latDeg: number): number {
  const d = new Date(`${date}T12:00:00Z`);
  const n = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
  const decl = (23.44 * Math.PI) / 180 * Math.sin(((2 * Math.PI) / 365) * (n - 81));
  const lat = (latDeg * Math.PI) / 180;
  const h0 = (-0.833 * Math.PI) / 180;
  const cosH = (Math.sin(h0) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH)));
  return (2 * H * 180) / Math.PI / 15;
}

/** Sunshine share at or above this: 晴. Between: 曇時々晴. Below the lower one: 曇. */
export const SUNNY_SHARE = 0.6;
export const CLOUDY_SHARE = 0.25;
/** Precipitation (mm) from which the day counts as rainy. */
export const RAINY_MM = 1;

/** The weather estimated from a measured day's values, or null when they are not enough. */
export function estimateDayWeather(row: WeatherRow, latDeg = 35): string | null {
  if (row.type !== "actual") return null;
  const rain = num(row.rain);
  const snow = num(row.snow);
  const sun = num(row.sun);
  const share = sun == null ? null : sun / dayLengthHours(row.date, latDeg);
  if (snow != null && snow > 0) return "雪";
  if (rain != null && rain >= RAINY_MM) return share != null && share >= SUNNY_SHARE ? "晴時々雨" : share != null && share >= CLOUDY_SHARE ? "曇時々雨" : "雨";
  if (share == null) return null;
  return share >= SUNNY_SHARE ? "晴" : share >= CLOUDY_SHARE ? "曇時々晴" : "曇";
}

/** What to show for a day's weather: JMA's summary, or else the estimate (marked). */
export function dayWeatherOf(row: WeatherRow | null | undefined, latDeg?: number): { text: string | null; estimated: boolean } {
  if (!row) return { text: null, estimated: false };
  const jma = typeof row.dayWeather === "string" && row.dayWeather ? row.dayWeather : null;
  if (jma) return { text: jma, estimated: false };
  const guess = estimateDayWeather(row, latDeg);
  return { text: guess, estimated: guess != null };
}

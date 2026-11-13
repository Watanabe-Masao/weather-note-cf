// The day's weather to show while JMA's 天気概況 is not out yet.
//
// JMA writes the day's weather summary (天気概況) a while after the day: for the latest day or two
// the table has every measured value but no weather, so the day showed "—". Until it arrives,
// the weather is estimated from what was measured — precipitation, and sunshine against the
// length of the day — and shown as an estimate. It is never stored as the day's weather: JMA's
// summary replaces it as soon as it comes, and nothing that decides whether a day is fixed reads it.

import { sunshineDayHours } from "./brightness";
import { dayEdges, type Where } from "./dayParts";
import type { WeatherRow } from "./types";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Hours between sunrise and sunset (standard formula with refraction; within a few minutes). */
export function dayLengthHours(date: string, station: Where): number {
  const e = dayEdges(date, station);
  return (e.set - e.rise) / 60;
}

/** Sunshine share at or above this: 晴. Between: 曇時々晴. Below the lower one: 曇. */
export const SUNNY_SHARE = 0.6;
export const CLOUDY_SHARE = 0.25;
/** Precipitation (mm) from which the day counts as rainy. */
export const RAINY_MM = 1;

/** The weather estimated from a measured day's values, or null when they are not enough. */
export function estimateDayWeather(row: WeatherRow, station: Where): string | null {
  if (row.type !== "actual") return null;
  const rain = num(row.rain);
  const snow = num(row.snow);
  const sun = num(row.sun);
  const share = sun == null ? null : sun / sunshineDayHours(row.date, station); // against the sunshine it could have had (#132)
  if (snow != null && snow > 0) return "雪";
  if (rain != null && rain >= RAINY_MM) return share != null && share >= SUNNY_SHARE ? "晴時々雨" : share != null && share >= CLOUDY_SHARE ? "曇時々雨" : "雨";
  if (share == null) return null;
  return share >= SUNNY_SHARE ? "晴" : share >= CLOUDY_SHARE ? "曇時々晴" : "曇";
}

/** What to show for a day's weather: JMA's summary, or else the estimate (marked). */
export function dayWeatherOf(row: WeatherRow | null | undefined, station: Where): { text: string | null; estimated: boolean } {
  if (!row) return { text: null, estimated: false };
  const jma = typeof row.dayWeather === "string" && row.dayWeather ? row.dayWeather : null;
  if (jma) return { text: jma, estimated: false };
  const guess = estimateDayWeather(row, station);
  return { text: guess, estimated: guess != null };
}

/**
 * The weather of a few hours (a band of the day) from the hourly rows: the weather text the rows
 * carry (JMA's hourly 天気, or the forecast's), else an estimate from precipitation and sunshine
 * in daylight. Null when neither is there (e.g. a night band without weather text).
 */
export function hoursWeather(rows: WeatherRow[], hours: readonly number[], station: Where, minSun = 2): { text: string | null; estimated: boolean } {
  const all = rows.filter((r) => hours.includes(r.n));
  if (!all.length) return { text: null, estimated: false };
  // Hours already observed speak for the band: a forecast's text for the rest would be shown as if seen.
  const observed = all.filter((r) => r.type !== "forecast");
  const inBand = observed.length ? observed : all;
  // A forecast's weather lent to an observed hour (正本管理) is not what was seen: left out.
  const lent = (r: WeatherRow) => r.type !== "forecast" && (r.origin as Record<string, string> | undefined)?.weather === "forecast";
  const texts = inBand.map((r) => (typeof r.weather === "string" && r.weather && !lent(r) ? r.weather : null)).filter((t): t is string => t != null);
  if (texts.length) {
    // Rain or snow in any hour of the band shows; otherwise the most frequent text.
    const wet = texts.find((t) => /雪/.test(t)) ?? texts.find((t) => /雨|雷/.test(t));
    if (wet) return { text: wet, estimated: false };
    const count = new Map<string, number>();
    for (const t of texts) count.set(t, (count.get(t) ?? 0) + 1);
    return { text: [...count.entries()].sort((a, b) => b[1] - a[1])[0][0], estimated: false };
  }
  if (inBand.some((r) => r.type === "forecast")) return { text: null, estimated: false };
  const rain = inBand.map((r) => num(r.rain)).filter((v): v is number => v != null);
  const snow = inBand.some((r) => (num(r.snow) ?? 0) > 0);
  if (snow) return { text: "雪", estimated: true };
  if (rain.length && rain.reduce((a, b) => a + b, 0) >= 0.5) return { text: "雨", estimated: true };
  // Sunshine only means something in daylight (JMA hour n covers n−1 to n o'clock).
  // An hour counts as daylight when its middle is at least half an hour after sunrise and before
  // sunset at the station (shared/dayParts.ts; not a noon fixed at 12時).
  const e = dayEdges(inBand[0].date, station);
  const day = inBand.filter((r) => (r.n - 0.5) * 60 > e.rise + 30 && (r.n - 0.5) * 60 < e.set - 30);
  const sun = day.map((r) => num(r.sun)).filter((v): v is number => v != null);
  if (sun.length < minSun) return { text: null, estimated: false };
  const share = sun.reduce((a, b) => a + b, 0) / sun.length;
  return { text: share >= SUNNY_SHARE ? "晴" : share >= CLOUDY_SHARE ? "曇時々晴" : "曇", estimated: true };
}

/** 晴れ系 / 曇り系 / 雨系 from the JMA daytime summary or the forecast label (the first part decides). */
export function weatherGroup(text: unknown): "sun" | "cloud" | "rain" | null {
  if (typeof text !== "string" || !text) return null;
  const first = text.split(/後|時々|一時|、/)[0];
  if (/雨|雪|雷/.test(first)) return "rain";
  if (/晴/.test(first)) return "sun";
  if (/曇|霧/.test(first)) return "cloud";
  return /雨|雪/.test(text) ? "rain" : null;
}

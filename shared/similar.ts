// Similar-day search (spec chapter 6): past days whose weather was close to the origin day,
// looked for in the same season of the past three years.

import { addDays, daysBetween } from "./dates";
import { dayTone } from "./holidays";
import type { WeatherRow } from "./types";

export const YEARS_BACK = 3;
export const SEASON_RADIUS = 15;
export const RESULT_COUNT = 10;

export const WEIGHTS = { max: 1, min: 1, rainClass: 2, weather: 2, spread: 0.5 } as const;

export type WeekdayFilter = "any" | "sameWeekday" | "holidays" | "weekdays";

export const WEEKDAY_FILTERS: { id: WeekdayFilter; label: string }[] = [
  { id: "any", label: "曜日指定なし" },
  { id: "sameWeekday", label: "同じ曜日" },
  { id: "holidays", label: "土日祝" },
  { id: "weekdays", label: "平日" },
];

/** Rain classes: 0 / under 1 / 1–10 / 10–30 / 30+ mm. */
export function rainClass(mm: number): number {
  if (mm <= 0) return 0;
  if (mm < 1) return 1;
  if (mm < 10) return 2;
  if (mm < 30) return 3;
  return 4;
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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface Comparable {
  max: number;
  min: number;
  rain: number;
  weather: "sun" | "cloud" | "rain" | null;
}

/** The values the search compares, or null when the row lacks the essentials. */
export function comparable(row: WeatherRow | null | undefined): Comparable | null {
  if (!row) return null;
  const max = num(row.max);
  const min = num(row.min);
  if (max == null || min == null) return null;
  return { max, min, rain: num(row.rain) ?? 0, weather: weatherGroup(row.dayWeather) };
}

/** Weighted distance; smaller is closer. An unknown weather group counts as half a mismatch. */
export function distance(a: Comparable, b: Comparable): number {
  const weather = a.weather == null || b.weather == null ? 0.5 : a.weather === b.weather ? 0 : 1;
  return (
    WEIGHTS.max * Math.abs(a.max - b.max) +
    WEIGHTS.min * Math.abs(a.min - b.min) +
    WEIGHTS.rainClass * Math.abs(rainClass(a.rain) - rainClass(b.rain)) +
    WEIGHTS.weather * weather +
    WEIGHTS.spread * Math.abs(a.max - a.min - (b.max - b.min))
  );
}

/** Closeness shown to people: 100 is identical, about 54 at distance 5, about 29 at 10. */
export const closeness = (d: number) => Math.round(100 * Math.exp(-d / 8));

/** The same month and day `years` earlier; 29 February falls back to the 28th. */
export function sameDateBack(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y - years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/** Candidate days: ±15 days around the same date in each of the past three years. */
export function candidateDays(origin: string): string[] {
  const out: string[] = [];
  for (let y = 1; y <= YEARS_BACK; y++) {
    const center = sameDateBack(origin, y);
    out.push(...daysBetween(addDays(center, -SEASON_RADIUS), addDays(center, SEASON_RADIUS)));
  }
  return out;
}

function passes(day: string, origin: string, filter: WeekdayFilter): boolean {
  if (filter === "any") return true;
  const weekday = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
  if (filter === "sameWeekday") return weekday(day) === weekday(origin);
  const restDay = dayTone(day) !== "weekday";
  return filter === "holidays" ? restDay : !restDay;
}

export interface Match {
  date: string;
  distance: number;
  closeness: number;
  values: Comparable;
}

/** The closest candidates, nearest first. Days without data are skipped. */
export function findSimilar(
  origin: Comparable,
  originDate: string,
  rows: Map<string, WeatherRow | null>,
  filter: WeekdayFilter = "any",
  count = RESULT_COUNT,
): Match[] {
  const matches: Match[] = [];
  for (const date of candidateDays(originDate)) {
    if (date === originDate || !passes(date, originDate, filter)) continue;
    const values = comparable(rows.get(date));
    if (!values) continue;
    const d = distance(origin, values);
    matches.push({ date, distance: d, closeness: closeness(d), values });
  }
  return matches.sort((a, b) => a.distance - b.distance || (a.date < b.date ? 1 : -1)).slice(0, count);
}

// 条件から選ぶ: past days that meet conditions set from the target day's values — the high and
// the low (以上 / 以下 / 範囲 / 問わない), rain by part of the day, and the period and weekdays to
// look in. Among the days that meet them, those whose high and low are nearest the target's come first.
//
// Inputs are only what both records and forecasts have at every station (temperatures and hourly
// precipitation); the weather text is not used.

import { RAIN_MM } from "./brightness";
import { addDays, daysBetween } from "./dates";
import { dayTone } from "./holidays";
import type { WeatherRow } from "./types";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- conditions -------------------------------------------------------------------------------

export type TempMode = "any" | "ge" | "le" | "range";
/** 以上 reads `lo`, 以下 reads `hi`, 範囲 both. */
export interface TempCondition {
  mode: TempMode;
  lo: number;
  hi: number;
}

export type RainMode = "any" | "dry" | "wet";
export type Part = "morning" | "day" | "evening" | "night";

/** Parts of the day, by the hours they cover (JMA's hour n is the hour ending at n:00). */
export const PARTS: { id: Part; label: string; from: number; to: number }[] = [
  { id: "morning", label: "朝", from: 6, to: 9 },
  { id: "day", label: "昼", from: 9, to: 15 },
  { id: "evening", label: "夕", from: 15, to: 18 },
  { id: "night", label: "夜", from: 18, to: 24 },
];

/** dry: no rain in any chosen part · wet: rain in at least one chosen part. */
export interface RainCondition {
  mode: RainMode;
  parts: readonly Part[];
}

export type WeekdayFilter = "any" | "sameWeekday" | "holidays" | "weekdays";
export const WEEKDAY_FILTERS: { id: WeekdayFilter; label: string }[] = [
  { id: "any", label: "曜日なし" },
  { id: "sameWeekday", label: "同じ曜日" },
  { id: "holidays", label: "土日祝" },
  { id: "weekdays", label: "平日" },
];

export const YEAR_CHOICES = [1, 3, 5] as const;
export type Years = (typeof YEAR_CHOICES)[number];
/** Days either side of the same date; "all" is the whole year around it. */
export const SPAN_CHOICES = [7, 15, 30, "all"] as const;
export type Span = (typeof SPAN_CHOICES)[number];
export const SPAN_LABEL: Record<string, string> = { 7: "前後1週", 15: "前後2週", 30: "前後1か月", all: "通年" };

export interface Conditions {
  max: TempCondition;
  min: TempCondition;
  rain: RainCondition;
  years: Years;
  span: Span;
  weekday: WeekdayFilter;
}

export const TEMP_STEP = 0.5;
/** Slider ends (℃): the target's value ±10 ℃ out to the next 5 ℃, wide enough for the range set. */
export function tempScale(origin: number | null, c: TempCondition): { lo: number; hi: number } {
  const v = origin ?? (c.lo + c.hi) / 2;
  return { lo: Math.floor(Math.min(v - 10, c.lo) / 5) * 5, hi: Math.ceil(Math.max(v + 10, c.hi) / 5) * 5 };
}
/** Half-width of the starting range around the target's value (℃). */
export const START_WIDTH = 1.5;

const roundStep = (v: number) => Math.round(v / TEMP_STEP) * TEMP_STEP;

function startTemp(v: number | null): TempCondition {
  if (v == null) return { mode: "any", lo: 10, hi: 20 };
  return { mode: "range", lo: roundStep(v - START_WIDTH), hi: roundStep(v + START_WIDTH) };
}

/** Conditions to start from: the target's high and low ±1.5 ℃, dry all day when it has no rain. */
export function startConditions(origin: WeatherRow | null | undefined): Conditions {
  const rain = num(origin?.rain);
  return {
    max: startTemp(num(origin?.max)),
    min: startTemp(num(origin?.min)),
    rain: { mode: rain != null && rain < RAIN_MM ? "dry" : "any", parts: PARTS.map((p) => p.id) },
    years: 3,
    span: 15,
    weekday: "any",
  };
}

// ---- where to look ----------------------------------------------------------------------------

/** The same month and day `years` earlier; 29 February falls back to the 28th. */
export function sameDateBack(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y - years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

const weekday = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();

function weekdayPasses(day: string, origin: string, filter: WeekdayFilter): boolean {
  if (filter === "any") return true;
  if (filter === "sameWeekday") return weekday(day) === weekday(origin);
  const rest = dayTone(day) !== "weekday";
  return filter === "holidays" ? rest : !rest;
}

/** Past days to look in, before `today` and not the target, by period and weekday. Newest first. */
export function candidateDays(origin: string, c: Pick<Conditions, "years" | "span" | "weekday">, today: string): string[] {
  const radius = c.span === "all" ? 182 : c.span;
  const out = new Set<string>();
  for (let y = 1; y <= c.years; y++) {
    const center = sameDateBack(origin, y);
    for (const d of daysBetween(addDays(center, -radius), addDays(center, radius)))
      if (d < today && d !== origin && weekdayPasses(d, origin, c.weekday)) out.add(d);
  }
  return [...out].sort().reverse();
}

// ---- tests ------------------------------------------------------------------------------------

export function tempPasses(c: TempCondition, v: number): boolean {
  if (c.mode === "ge") return v >= c.lo;
  if (c.mode === "le") return v <= c.hi;
  if (c.mode === "range") return v >= c.lo && v <= c.hi;
  return true;
}

/** The parts of the day that had rain (an hour of 0.5 mm or more), from the day's hourly rows. */
export function wetParts(hours: WeatherRow[]): Set<Part> {
  const out = new Set<Part>();
  for (const h of hours) {
    const mm = num(h.rain);
    if (mm == null || mm < RAIN_MM) continue;
    for (const p of PARTS) if (h.n > p.from && h.n <= p.to) out.add(p.id);
  }
  return out;
}

/** Whether the rain test needs the day's hours: a day with no rain at all passes or fails on its own. */
export function needsHours(c: RainCondition, row: WeatherRow): boolean {
  return c.mode !== "any" && (num(row.rain) ?? 0) >= RAIN_MM;
}

/** The day's hours decide when they are at hand; else a day with no rain decides on its own. null: the hours are needed. */
export function rainPasses(c: RainCondition, row: WeatherRow, hours: WeatherRow[] | null): boolean | null {
  if (c.mode === "any") return true;
  if (!hours?.length) {
    if (!needsHours(c, row)) return c.mode === "dry";
    return null;
  }
  const wet = wetParts(hours);
  return c.mode === "dry" ? c.parts.every((p) => !wet.has(p)) : c.parts.some((p) => wet.has(p));
}

// ---- search -----------------------------------------------------------------------------------

export type ConditionKey = "max" | "min" | "rain";
export const CONDITION_NAME: Record<ConditionKey, string> = { max: "最高", min: "最低", rain: "雨" };

export interface ConditionMatch {
  date: string;
  max: number;
  min: number;
  /** The day's precipitation (mm). */
  rain: number;
  /** The parts that had rain, or null when the day's hours are not loaded. */
  wet: Set<Part> | null;
  /** |Δ high| + |Δ low| from the target (℃); smaller is nearer. */
  distance: number;
}

export interface ConditionResult {
  matches: ConditionMatch[];
  /** Candidates with daily values loaded / all candidates. */
  loaded: number;
  total: number;
  /** Days whose hours are still needed for the rain test. */
  hoursWanted: string[];
  /** With no match: the condition that, left out, lets the most days through, and how many. */
  loosen: { key: ConditionKey; count: number } | null;
}

export interface Lookup {
  day: (date: string) => WeatherRow | null | undefined;
  /** The day's hourly rows, or null when not loaded. */
  hours: (date: string) => WeatherRow[] | null;
}

export function searchConditions(
  c: Conditions,
  origin: { date: string; max: number | null; min: number | null },
  candidates: string[],
  look: Lookup,
): ConditionResult {
  const matches: ConditionMatch[] = [];
  const hoursWanted: string[] = [];
  const without: Record<ConditionKey, number> = { max: 0, min: 0, rain: 0 };
  let loaded = 0;
  for (const date of candidates) {
    const row = look.day(date);
    if (row === undefined) continue;
    loaded++;
    const max = num(row?.max);
    const min = num(row?.min);
    if (!row || max == null || min == null) continue;
    const okMax = tempPasses(c.max, max);
    const okMin = tempPasses(c.min, min);
    // The hours are fetched only for days the temperatures already let through.
    let okRain: boolean | null = true;
    if (c.rain.mode !== "any") {
      okRain = needsHours(c.rain, row) && !(okMax && okMin) ? false : rainPasses(c.rain, row, look.hours(date));
      if (okRain === null) {
        hoursWanted.push(date);
        continue;
      }
    }
    if (okMax && okMin && okRain) {
      const hours = look.hours(date);
      matches.push({
        date,
        max,
        min,
        rain: num(row.rain) ?? 0,
        wet: hours ? wetParts(hours) : null,
        // Rounded to 0.1 ℃ so equal distances tie (and the newer day comes first).
        distance: Math.round((Math.abs(max - (origin.max ?? max)) + Math.abs(min - (origin.min ?? min))) * 10) / 10,
      });
    }
    if (okMin && okRain) without.max++;
    if (okMax && okRain) without.min++;
    if (okMax && okMin) without.rain++;
  }
  matches.sort((a, b) => a.distance - b.distance || (a.date < b.date ? 1 : -1));
  let loosen: ConditionResult["loosen"] = null;
  if (!matches.length) {
    const keys = (["max", "min", "rain"] as const).filter((k) => k === "rain" ? c.rain.mode !== "any" : c[k].mode !== "any");
    const best = keys.map((key) => ({ key, count: without[key] })).sort((a, b) => b.count - a.count)[0];
    if (best?.count) loosen = best;
  }
  return { matches, loaded, total: candidates.length, hoursWanted, loosen };
}

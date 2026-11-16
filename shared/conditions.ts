// 条件から選ぶ: past days that meet conditions set from the target day's values — the high and
// the low (以上 / 以下 / 範囲 / 問わない), rain by part of the day and by its strength (the strongest
// hour, in JMA's words: 強い雨・激しい雨・非常に激しい雨), 台風 (the days inside a typhoon's 強風域,
// shared/typhoon.ts), and the period and weekdays to look in. Among the days that meet them, those
// whose high and low are nearest the target's come first.
//
// Inputs are only what both records and forecasts have at every station (temperatures and hourly
// precipitation; the typhoon's track and its 強風域); the weather text is not used.

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
  /** With wet: the strongest hour (mm) reaches this, in the chosen parts. 0 or absent: any. */
  strength?: number;
}

/**
 * 雨の強さ, JMA's terms for an hour's rain (気象庁「雨の強さと降り方」): 強い雨 20 mm〜, 激しい雨
 * 30 mm〜, 非常に激しい雨 50 mm〜 (猛烈な雨, 80 mm〜, is in 非常に激しい雨 here: too rare to choose).
 */
export const RAIN_STRENGTHS: { mm: number; label: string; short: string }[] = [
  { mm: 0, label: "強さは問わない", short: "" },
  { mm: 20, label: "強い雨", short: "20mm〜" },
  { mm: 30, label: "激しい雨", short: "30mm〜" },
  { mm: 50, label: "非常に激しい雨", short: "50mm〜" },
];

/** 台風: any day, only the days inside a typhoon's 強風域, or all but them. */
export type TyphoonFilter = "any" | "only" | "exclude";
export const TYPHOON_FILTERS: { id: TyphoonFilter; label: string }[] = [
  { id: "any", label: "問わない" },
  { id: "only", label: "台風の日" },
  { id: "exclude", label: "台風の日を除く" },
];

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
  /** Absent: any. */
  typhoon?: TyphoonFilter;
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
    rain: { mode: rain != null && rain < RAIN_MM ? "dry" : "any", parts: PARTS.map((p) => p.id), strength: 0 },
    typhoon: "any",
    years: 3,
    span: 15,
    weekday: "any",
  };
}

// ---- where to look ----------------------------------------------------------------------------

/** 通年: half a year and a day either side, so the years join without a gap (a leap year's day too). */
const ALL_YEAR = 183;

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
  const radius = c.span === "all" ? ALL_YEAR : c.span;
  const out = new Set<string>();
  for (let y = 1; y <= c.years; y++) {
    const center = sameDateBack(origin, y);
    for (const d of daysBetween(addDays(center, -radius), addDays(center, radius)))
      if (d < today && d !== origin && weekdayPasses(d, origin, c.weekday)) out.add(d);
  }
  return [...out].sort().reverse();
}

/**
 * The stretches of days the period covers (before today), oldest first: one per year back, or —
 * when they touch, as 通年 does — one stretch. For saying in dates what 「過去3年・前後2週」 means.
 */
export function periodStretches(origin: string, c: Pick<Conditions, "years" | "span">, today: string): { from: string; to: string }[] {
  const radius = c.span === "all" ? ALL_YEAR : c.span;
  const out: { from: string; to: string }[] = [];
  for (let y = c.years; y >= 1; y--) {
    const center = sameDateBack(origin, y);
    const from = addDays(center, -radius);
    let to = addDays(center, radius);
    if (to >= today) to = addDays(today, -1);
    if (from > to) continue;
    const last = out[out.length - 1];
    if (last && from <= addDays(last.to, 1)) last.to = to > last.to ? to : last.to;
    else out.push({ from, to });
  }
  return out;
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

/** The strongest hour (mm) in the chosen parts, from the day's hourly rows. */
export function strongestHour(hours: WeatherRow[], parts: readonly Part[]): number {
  let top = 0;
  for (const h of hours) {
    const mm = num(h.rain);
    if (mm != null && mm > top && PARTS.some((p) => parts.includes(p.id) && h.n > p.from && h.n <= p.to)) top = mm;
  }
  return top;
}

const allParts = (parts: readonly Part[]) => PARTS.every((p) => parts.includes(p.id));

/** Whether the rain test needs the day's hours: a day with no rain at all passes or fails on its own. */
export function needsHours(c: RainCondition, row: WeatherRow): boolean {
  return c.mode !== "any" && (num(row.rain) ?? 0) >= RAIN_MM;
}

/**
 * The day's hours decide when they are at hand; else a day with no rain decides on its own. A strength
 * over the whole day can be read from the day's own strongest hour (the table's 最大1時間降水量)
 * when the record has it. null: the hours are needed.
 */
export function rainPasses(c: RainCondition, row: WeatherRow, hours: WeatherRow[] | null): boolean | null {
  if (c.mode === "any") return true;
  const strength = c.mode === "wet" ? (c.strength ?? 0) : 0;
  if (strength > 0) {
    // A day whose total is under the strength cannot have an hour that reaches it.
    const total = num(row.rain);
    if (total != null && total < strength) return false;
    const top = allParts(c.parts) ? num(row.rainHour) : null;
    if (top != null) return top >= strength;
  }
  if (!hours?.length) {
    if (!needsHours(c, row)) return c.mode === "dry";
    return null;
  }
  const wet = wetParts(hours);
  if (c.mode === "dry") return c.parts.every((p) => !wet.has(p));
  return c.parts.some((p) => wet.has(p)) && (strength === 0 || strongestHour(hours, c.parts) >= strength);
}

/** The 台風 test: whether the day was inside a typhoon's 強風域 (null: not known yet). */
export function typhoonPasses(f: TyphoonFilter | undefined, isTyphoon: boolean | null): boolean | null {
  if (!f || f === "any") return true;
  if (isTyphoon == null) return null;
  return f === "only" ? isTyphoon : !isTyphoon;
}

// ---- search -----------------------------------------------------------------------------------

export type ConditionKey = "max" | "min" | "rain" | "typhoon";
export const CONDITION_NAME: Record<ConditionKey, string> = { max: "最高", min: "最低", rain: "雨", typhoon: "台風" };

export interface ConditionMatch {
  date: string;
  max: number;
  min: number;
  /** The day's precipitation (mm). */
  rain: number;
  /** The parts that had rain, or null when the day's hours are not loaded. */
  wet: Set<Part> | null;
  /** The day's strongest hour (mm), when known. */
  top: number | null;
  /** Inside a typhoon's 強風域 (台風◯号), when the day was. */
  typhoon: number | null;
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
  /** The typhoon whose 強風域 held the station that day (its number), 0 for none, null while not known. */
  typhoon?: (date: string) => number | null;
}

export function searchConditions(
  c: Conditions,
  origin: { date: string; max: number | null; min: number | null },
  candidates: string[],
  look: Lookup,
): ConditionResult {
  const matches: ConditionMatch[] = [];
  const hoursWanted: string[] = [];
  const without: Record<ConditionKey, number> = { max: 0, min: 0, rain: 0, typhoon: 0 };
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
    const ty = look.typhoon ? look.typhoon(date) : 0;
    const okTy = typhoonPasses(c.typhoon, ty == null ? null : ty > 0);
    // Not known yet (the typhoon tracks still coming): the day waits, as one not loaded.
    if (okTy === null) {
      loaded--;
      continue;
    }
    // The hours are fetched only for days the temperatures already let through.
    let okRain: boolean | null = true;
    if (c.rain.mode !== "any") {
      okRain = needsHours(c.rain, row) && !(okMax && okMin && okTy) ? false : rainPasses(c.rain, row, look.hours(date));
      if (okRain === null) {
        hoursWanted.push(date);
        continue;
      }
    }
    if (okMax && okMin && okRain && okTy) {
      const hours = look.hours(date);
      matches.push({
        date,
        max,
        min,
        rain: num(row.rain) ?? 0,
        wet: hours ? wetParts(hours) : null,
        top: num(row.rainHour) ?? (hours ? strongestHour(hours, PARTS.map((p) => p.id)) : null),
        typhoon: ty ? ty : null,
        // Rounded to 0.1 ℃ so equal distances tie (and the newer day comes first).
        distance: Math.round((Math.abs(max - (origin.max ?? max)) + Math.abs(min - (origin.min ?? min))) * 10) / 10,
      });
    }
    if (okMin && okRain && okTy) without.max++;
    if (okMax && okRain && okTy) without.min++;
    if (okMax && okMin && okTy) without.rain++;
    if (okMax && okMin && okRain) without.typhoon++;
  }
  matches.sort((a, b) => a.distance - b.distance || (a.date < b.date ? 1 : -1));
  let loosen: ConditionResult["loosen"] = null;
  if (!matches.length) {
    const keys = (["max", "min", "rain", "typhoon"] as const).filter((k) =>
      k === "rain" ? c.rain.mode !== "any" : k === "typhoon" ? (c.typhoon ?? "any") !== "any" : c[k].mode !== "any",
    );
    const best = keys.map((key) => ({ key, count: without[key] })).sort((a, b) => b.count - a.count)[0];
    if (best?.count) loosen = best;
  }
  return { matches, loaded, total: candidates.length, hoursWanted, loosen };
}

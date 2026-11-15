// H-02 (#132): the parts of the check that decide what counts — kept apart from the run (h02.ts) so
// they are tested (test/data/research-h02.test.ts). The rules, from the review of 2026-11-15:
//  - A value not recorded is not a value: a missing rain is not "no rain", a missing hour is not a
//    dark hour. It is left out of what it would decide, and counted in the report.
//  - Which hours a day needs is set by the sun (the clear sky's light that hour), not by a fixed
//    clock: winter and summer days are not the same length. 日照 is needed only in the hours it
//    could be measured (an empty cell at the day's ends is no sunshine, as in the core).
//  - Where the clear sky (the ratio's denominator) is small, the ratio is unstable: those hours are
//    kept, in a table of their own, never mixed into the others.
//  - 日照 0 is not one kind of sky (diffuse light still comes through thin or thick cloud): it is
//    split by how the day and the neighbouring hours went.

import { RAIN_MM, sunshineFraction } from "../../shared/brightness";
import { hourRadiation } from "../../shared/mrt";
import { radiationOf } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Below this clear-sky light (W/m², the hour's mean), or this share of the hour with the sun up for sunshine, the ratio is unstable. */
export const LOW_SUN = { clearW: 80, up: 0.25 } as const;

export type RainState = "dry" | "wet" | "unknown";
/** Rain as recorded: under RAIN_MM dry, at or above it wet, not recorded unknown (never dry). */
export function rainState(rain: number | null): RainState {
  return rain == null ? "unknown" : rain >= RAIN_MM ? "wet" : "dry";
}

/** The clear sky's light in an hour (W/m², the hour's mean): every minute that could, sunny, no rain. */
export function clearSkyW(date: string, n: number, station: string): number {
  return hourRadiation(date, n, station, 1, 0)?.ghi ?? 0;
}

/**
 * The record's smallest step: JMA writes the hour's radiation in 0.01 MJ/m² (≈ 2.8 W/m² over the
 * hour). An hour whose clear sky gives less than that could not show light even on a clear day.
 */
export const RECORD_STEP_W = 0.01 / 0.0036;
/** An hour of the day's light: its clear sky could show on the record. */
export function daylight(date: string, n: number, station: string): boolean {
  return clearSkyW(date, n, station) >= RECORD_STEP_W;
}

export type Missing = "radiation" | "sun" | "rain";
export interface DayCheck {
  /** Hours of the day's light (`daylight`): the hours a day total needs. */
  needed: number[];
  /** Needed hours with a value not recorded (an hour not in the table misses all three). */
  missing: { n: number; what: Missing[] }[];
  /** Every needed hour has all three: the day's total can be compared. */
  complete: boolean;
}

/** Whether a day's table has every value its daylight hours need (set by the sun, not by the clock). */
export function dayCheck(date: string, station: string, rows: WeatherRow[]): DayCheck {
  const byHour = new Map(rows.map((r) => [r.n, r]));
  const needed: number[] = [];
  const missing: DayCheck["missing"] = [];
  for (let n = 1; n <= 24; n++) {
    if (!daylight(date, n, station)) continue;
    needed.push(n);
    const r = byHour.get(n);
    const what: Missing[] = [];
    if ((r ? radiationOf(r) : null) == null) what.push("radiation");
    if (r == null || sunOf(r, date, station) == null) what.push("sun");
    if (num(r?.rain) == null) what.push("rain");
    if (what.length) missing.push({ n, what });
  }
  return { needed, missing, complete: missing.length === 0 };
}

/**
 * The hour's sunshine (h). An empty cell is no sunshine only where the sun could not give any
 * (JMA leaves 日照 empty at night and at the day's ends): there it is 0, as the core's rad.sunshine
 * needs it only when it is possible. Where sunshine was possible, an empty cell is missing (null).
 */
export function sunOf(row: WeatherRow, date: string, station: string): number | null {
  const s = num(row.sun);
  if (s != null) return s;
  return sunshineFraction(date, row.n, station) > 0 ? null : 0;
}

/** An hour whose ratio is unstable (a low sun): its own table. */
export function lowSun(date: string, n: number, station: string): boolean {
  return clearSkyW(date, n, station) < LOW_SUN.clearW || sunshineFraction(date, n, station) < LOW_SUN.up;
}

export type DaySky = "dull" | "mixed" | "bright";
/** The day's sunshine, to tell a 日照 0 hour on a dull day (thick cloud) from one on a bright day (a passing cloud). */
export const DAY_SKY = { dull: 1, bright: 5 } as const;
export function daySky(sunHours: number): DaySky {
  return sunHours < DAY_SKY.dull ? "dull" : sunHours >= DAY_SKY.bright ? "bright" : "mixed";
}

/** A 日照 0 hour's neighbours: both 日照 0 too, or sunshine in at least one (an hour between sunny ones). */
export function neighbours(rows: WeatherRow[], n: number): "dark" | "sunny" | "unknown" {
  const at = (k: number) => num(rows.find((r) => r.n === k)?.sun);
  const both = [at(n - 1), at(n + 1)];
  if (both.some((s) => s != null && s > 0)) return "sunny";
  return both.every((s) => s === 0) ? "dark" : "unknown";
}

/**
 * H-02b (#208): 日照 0・雨なしの時間の割合を、前後の時間の日照で分ける案。厚い雲が続く時間（前後も
 * 日照 0）は暗く、晴れ間の合間の雲（前後のどちらかに日照）は明るい。数は高知の1年
 * （`fittedOn`、run 43718498200）の実測 ÷ 快晴の中央で、その年の答えを見て決めた。だから成績は
 * 別の年で測る（決まり：答えを見て数を選んだら、成績はその外の答えで）。前後が分からない時間は
 * アプリの値のまま。
 */
export const H02B = { dark: 0.25, between: 0.41, fittedOn: { from: "2025-11-01", to: "2026-10-31" } } as const;

/** H-02b's share of the clear sky for a 日照 0・雨なし hour, or null to keep the app's (neighbours unknown). */
export function h02bFactor(around: "dark" | "sunny" | "unknown"): number | null {
  return around === "dark" ? H02B.dark : around === "sunny" ? H02B.between : null;
}

/** Whether [from, to] overlaps the year H-02b's numbers were chosen on (its results there are not a test). */
export function overlapsFit(from: string, to: string): boolean {
  return from <= H02B.fittedOn.to && to >= H02B.fittedOn.from;
}

/** A seeded generator (mulberry32), so a bootstrap gives the same interval every run. */
export function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The mean of `d` (one value per day) with a day-bootstrap 95% interval (days are the blocks: one
 * day's hours are not independent). Null interval with fewer than `minDays`.
 */
export function meanWithInterval(d: number[], minDays = 10, resamples = 2000, seed = 20261115): { mean: number; interval: [number, number] | null } {
  const mean = d.length ? d.reduce((a, b) => a + b, 0) / d.length : NaN;
  if (d.length < minDays) return { mean, interval: null };
  const next = seeded(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let k = 0; k < d.length; k++) s += d[Math.floor(next() * d.length)];
    means.push(s / d.length);
  }
  means.sort((a, b) => a - b);
  return { mean, interval: [means[Math.floor(0.025 * resamples)], means[Math.floor(0.975 * resamples)]] };
}

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

// Which days to have, in which order (spec 2.2 rule 2), and where each day comes from.
// Pure functions: no network, no storage.

import { addDays, daysBetween, FIRST_DAY, FORECAST_DAYS, monthOf } from "../../shared/dates";

export { FORECAST_DAYS };

export const Priority = {
  /** The seven days on screen. */
  Visible: 0,
  /** The month ahead in the direction of travel. */
  Ahead: 1,
  /** A week behind, for turning back. */
  Behind: 2,
  /** Comparison candidates fetched when the screen is idle. */
  Prefetch: 3,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/** -1 = travelling into the past, +1 = towards today, 0 = not moving (initial view). */
export type Direction = -1 | 0 | 1;

export const VISIBLE_RADIUS = 3; // 7 columns, centre ±3
export const AHEAD_DAYS = 30;
export const BEHIND_DAYS = 7;
export const IDLE_AHEAD_DAYS = 14;

export function lastDay(today: string): string {
  return addDays(today, FORECAST_DAYS);
}

function clampRange(start: string, end: string, today: string): string[] {
  const s = start < FIRST_DAY ? FIRST_DAY : start;
  const e = end > lastDay(today) ? lastDay(today) : end;
  return s > e ? [] : daysBetween(s, e);
}

/** Days wanted for the current view, each with its priority. Smaller priority wins when a day appears twice. */
export function viewPlan(centers: string[], direction: Direction, today: string): Map<string, Priority> {
  const plan = new Map<string, Priority>();
  const add = (days: string[], p: Priority) => {
    for (const d of days) if (!plan.has(d) || plan.get(d)! > p) plan.set(d, p);
  };
  for (const c of centers) {
    const lo = addDays(c, -VISIBLE_RADIUS);
    const hi = addDays(c, VISIBLE_RADIUS);
    add(clampRange(lo, hi, today), Priority.Visible);
    if (direction === 0) {
      add(clampRange(addDays(lo, -IDLE_AHEAD_DAYS), addDays(lo, -1), today), Priority.Ahead);
      add(clampRange(addDays(hi, 1), addDays(hi, IDLE_AHEAD_DAYS), today), Priority.Ahead);
    } else if (direction < 0) {
      add(clampRange(addDays(lo, -AHEAD_DAYS), addDays(lo, -1), today), Priority.Ahead);
      add(clampRange(addDays(hi, 1), addDays(hi, BEHIND_DAYS), today), Priority.Behind);
    } else {
      add(clampRange(addDays(hi, 1), addDays(hi, AHEAD_DAYS), today), Priority.Ahead);
      add(clampRange(addDays(lo, -BEHIND_DAYS), addDays(lo, -1), today), Priority.Behind);
    }
  }
  return plan;
}

export type Source =
  | { kind: "month"; month: string }
  | { kind: "forecast" };

/** Where a day's daily values come from. Today and later come from the forecast (today's observations are separate). */
export function sourceFor(day: string, today: string): Source {
  return day >= today ? { kind: "forecast" } : { kind: "month", month: monthOf(day) };
}

/** The two most recent past days may be missing from the JMA table; they fall back to AMeDAS observations. */
export function isRecent(day: string, today: string): boolean {
  return day < today && day >= addDays(today, -2);
}

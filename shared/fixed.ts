// The one rule that decides whether data is fixed (spec 2.1), shared by the Worker (cache lifetime)
// and the app (persist or refresh).
//
// "Fixed" means JMA has published every value: it is the authoritative copy. It does NOT mean the
// value can never change: JMA may still correct it. So fixed data is re-checked for a while after
// it becomes fixed (REVALIDATE_DAYS), and a known correction reaches both copies through
// shared/corrections.ts.

import { addDays, daysOfMonth } from "./dates";
import type { WeatherRow } from "./types";

/** Days at least this many days old can be fixed. */
export const FIXED_AFTER_DAYS = 3;

const TEXT_FIELDS = new Set(["dayWeather", "nightWeather", "weather", "direction"]);

/** A daily JMA row is fixed: 3+ days old, has the daytime summary, and no column is still unpublished. */
export function isFixedDay(row: WeatherRow | undefined | null, today: string): boolean {
  if (!row || row.type !== "actual" || row.provisional) return false;
  if (row.date > addDays(today, -FIXED_AFTER_DAYS)) return false;
  if (!row.dayWeather) return false;
  if (Array.isArray(row.unpublished)) return row.unpublished.length === 0;
  const values = Object.entries(row.raw ?? {}).filter(([k]) => !TEXT_FIELDS.has(k));
  return values.length > 0 && values.every(([, v]) => v !== "" && v != null);
}

/** Fixed data is still re-checked for this many days after its (last) day. */
export const REVALIDATE_DAYS = 30;

/** Whether data for `lastDay` (a day, or a month's last day) is still in its re-check period. */
export function inRevalidation(lastDay: string, today: string): boolean {
  return addDays(lastDay, REVALIDATE_DAYS) >= today;
}

/** A month is fixed when every one of its days is there exactly once, belongs to it, and is fixed. */
export function isFixedMonth(month: string, rows: WeatherRow[], today: string): boolean {
  const byDate = new Map<string, WeatherRow>();
  for (const r of rows) {
    if (r.date.slice(0, 7) !== month || byDate.has(r.date)) return false; // stray or duplicate day
    byDate.set(r.date, r);
  }
  return daysOfMonth(month).every((d) => isFixedDay(byDate.get(d), today));
}

/**
 * An hourly day is fixed: 3+ days old, hours 1–24 each present exactly once and all of that day,
 * with no unpublished column. (Counting 24 rows is not enough: a duplicate can hide a gap.)
 */
export function isFixedHourlyDay(day: string, rows: WeatherRow[], today: string): boolean {
  if (day > addDays(today, -FIXED_AFTER_DAYS)) return false;
  if (rows.length !== 24) return false;
  const hours = new Set<number>();
  for (const r of rows) {
    if (r.date !== day || !Number.isInteger(r.n) || r.n < 1 || r.n > 24 || hours.has(r.n)) return false;
    hours.add(r.n);
  }
  return rows.every((r) => r.type === "actual" && !r.provisional && (r.unpublished?.length ?? 0) === 0);
}

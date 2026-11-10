// The one rule that decides whether data can change again (spec 2.1).
// Shared by the Worker (cache lifetime) and the app (persist forever or refresh at startup).

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

/** A month is fixed when every one of its days is fixed. */
export function isFixedMonth(month: string, rows: WeatherRow[], today: string): boolean {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return daysOfMonth(month).every((d) => isFixedDay(byDate.get(d), today));
}

/** An hourly day is fixed: 3+ days old and all 24 hours present with no unpublished column. */
export function isFixedHourlyDay(day: string, rows: WeatherRow[], today: string): boolean {
  if (day > addDays(today, -FIXED_AFTER_DAYS)) return false;
  if (rows.length !== 24) return false;
  return rows.every((r) => r.type === "actual" && !r.provisional && (r.unpublished?.length ?? 0) === 0);
}

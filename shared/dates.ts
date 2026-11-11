// Calendar helpers. Dates are plain "YYYY-MM-DD" strings in Japan time.

const DAY_MS = 86_400_000;

export function jstToday(now: number = Date.now()): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function jstHour(now: number = Date.now()): number {
  return new Date(now + 9 * 3_600_000).getUTCHours();
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function daysOfMonth(month: string): string[] {
  return daysBetween(month + "-01", lastDayOfMonth(month));
}

export const isDay = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

export const isMonth = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Oldest day the JMA daily tables are used for. */
export const FIRST_DAY = "1977-01-01";
/** Forecast reach: today + 15 (Open-Meteo forecast_days 16). Shared by the app and the worker. */
export const FORECAST_DAYS = 15;

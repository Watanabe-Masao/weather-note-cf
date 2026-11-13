// 手前の平均: for each hour, the mean over the days just before a day (not the day itself) — the
// target's own recent weeks, and the comparison day's. Days from today on are left out (only what
// was measured), so a forecast comparison day averages fewer days and says how many.

import { addDays } from "../shared/dates";
import type { HourPoint } from "./dayDetail";

/** How far back: a week, two weeks, a month. Tapping the legend steps through them. */
export const AVERAGE_WINDOWS = [7, 14, 30] as const;
export type AverageWindow = (typeof AVERAGE_WINDOWS)[number];
export const WINDOW_LABEL: Record<AverageWindow, string> = { 7: "1週", 14: "2週", 30: "1か月" };

export const nextWindow = (w: AverageWindow): AverageWindow => AVERAGE_WINDOWS[(AVERAGE_WINDOWS.indexOf(w) + 1) % AVERAGE_WINDOWS.length];

/** The `count` days before `day`, nearest first, only those before `today` and from `first` on. */
export function daysBefore(day: string, count: number, today: string, first = "1977-01-01"): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = addDays(day, -i);
    if (d < today && d >= first) out.push(d);
  }
  return out;
}

/**
 * The hour-by-hour mean of the days given. An hour is left empty unless at least half the days
 * (and at least 2) have a value there, so a few days do not stand for the whole span.
 */
export function meanByHour(days: HourPoint[][], expected: number): HourPoint[] {
  const need = Math.max(2, Math.ceil(expected / 2));
  return Array.from({ length: 24 }, (_, i) => {
    const vs = days.map((d) => d[i]?.v).filter((v): v is number => v != null && Number.isFinite(v));
    return { hour: i + 1, v: vs.length >= need ? vs.reduce((a, b) => a + b, 0) / vs.length : null, forecast: false };
  });
}

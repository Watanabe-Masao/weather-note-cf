// Comparison dates and the arithmetic behind the date strips. Pure functions, tested in test/data/compare.test.ts.

import { addDays, FIRST_DAY } from "../shared/dates";

export type CompareMode = "sameDate" | "sameWeekday" | "yesterday" | "lastWeek" | "nextWeek" | "custom";

export const COMPARE_MODES: { mode: CompareMode; label: string }[] = [
  { mode: "sameDate", label: "前年同日" },
  { mode: "sameWeekday", label: "前年同曜日" },
  { mode: "yesterday", label: "前日" },
  { mode: "lastWeek", label: "前週" },
  { mode: "nextWeek", label: "翌週" },
  { mode: "custom", label: "カスタム" },
];

const DAY_MS = 86_400_000;
const toTime = (d: string) => Date.parse(d + "T00:00:00Z");
export const diffDays = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);

/** The comparison day for `target`. Null when the mode has no such day (29 February a year earlier). */
export function matchDate(target: string, mode: CompareMode, customOffset = 0): string | null {
  switch (mode) {
    case "yesterday":
      return addDays(target, -1);
    case "lastWeek":
      return addDays(target, -7);
    case "nextWeek":
      return addDays(target, 7);
    case "custom":
      return addDays(target, customOffset);
    case "sameDate":
    case "sameWeekday": {
      const t = new Date(toTime(target));
      const p = new Date(Date.UTC(t.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate()));
      if (p.getUTCMonth() !== t.getUTCMonth()) return null;
      if (mode === "sameWeekday") {
        let shift = (t.getUTCDay() - p.getUTCDay() + 7) % 7;
        if (shift > 3) shift -= 7;
        p.setUTCDate(p.getUTCDate() + shift);
      }
      return p.toISOString().slice(0, 10);
    }
  }
}

/** The preset (not カスタム) that gives `compare` for `target`, if any. */
export function presetOf(target: string, compare: string | null): CompareMode | null {
  if (!compare) return null;
  for (const { mode } of COMPARE_MODES) if (mode !== "custom" && matchDate(target, mode) === compare) return mode;
  return null;
}

/** The offset (in days) that keeps a pair fixed when switching to custom. */
export const offsetOf = (target: string, compare: string) => diffDays(target, compare);

/** Range for the target day so that its comparison day also stays between 1977 and the last forecast day. */
export function targetBounds(mode: CompareMode, customOffset: number, last: string): { min: string; max: string } {
  const offset =
    mode === "custom" ? customOffset : mode === "yesterday" ? -1 : mode === "lastWeek" ? -7 : mode === "nextWeek" ? 7 : -366;
  const min = offset < 0 ? addDays(FIRST_DAY, -offset) : FIRST_DAY;
  const max = offset > 0 ? addDays(last, -offset) : last;
  return { min, max };
}

export const clampDay = (d: string, min: string, max: string) => (d < min ? min : d > max ? max : d);

// ---- drum strip arithmetic ------------------------------------------------------------------

export const COLUMNS = 7;
/** Days rendered either side of the centre; the window moves when the centre nears an edge. */
export const WINDOW_RADIUS = 60;
const REWINDOW_MARGIN = 20;

/** The run of days the strip renders, clamped to the allowed range. */
export function stripWindow(center: string, min: string, max: string): { start: string; end: string } {
  const start = clampDay(addDays(center, -WINDOW_RADIUS), min, max);
  const end = clampDay(addDays(center, WINDOW_RADIUS), min, max);
  return { start, end };
}

/** True when the centre has drifted close enough to an edge that the window should move. */
export function needsRewindow(center: string, win: { start: string; end: string }, min: string, max: string): boolean {
  const nearStart = diffDays(win.start, center) < REWINDOW_MARGIN && win.start > min;
  const nearEnd = diffDays(center, win.end) < REWINDOW_MARGIN && win.end < max;
  return nearStart || nearEnd;
}

/** Column index under the centre for a scroll position (padding of three columns either side). */
export const centerIndex = (scrollLeft: number, columnWidth: number, count: number) =>
  Math.max(0, Math.min(count - 1, Math.round(scrollLeft / columnWidth)));

/** Scroll position that puts column `index` in the centre. */
export const scrollFor = (index: number, columnWidth: number) => index * columnWidth;

// ---- long press on ◀ ▶ ---------------------------------------------------------------------

export const WEEK_STEP_PX = 40;
export const WEEK_DEAD_ZONE_PX = 12;
export const MAX_WEEKS = 52;

/**
 * Weeks to jump while long-pressing ◀ or ▶. Slide down (away from the screen edge, the main way)
 * or sideways in the arrow's direction: every WEEK_STEP_PX adds a week. Sliding back up or the
 * other way past the dead zone gives 0, "cancel".
 */
export function weekSteps(dx: number, dy: number, direction: -1 | 1): number {
  const distance = Math.max(dy, direction * dx);
  if (distance < WEEK_DEAD_ZONE_PX) return Math.min(dy, direction * dx) < -WEEK_DEAD_ZONE_PX ? 0 : 1;
  return Math.min(MAX_WEEKS, 1 + Math.floor((distance - WEEK_DEAD_ZONE_PX) / WEEK_STEP_PX));
}

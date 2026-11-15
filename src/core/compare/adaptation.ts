// 慣れ L1・L2 の違いの影響: the same days through the same boundary shift and the same seven-step
// judge, with only the long baseline swapped (one change at a time). For each day: L1, L2, the two
// shifts and their difference Δb = g(L2) − g(L1); for each hour given: the 肌感 and its step under
// each. Days where either cannot be computed are kept with their reasons, and left out of the counts.

import { ADAPT_EMA_STANDARD } from "../estimate/adapt-ema/params";
import { adaptEma } from "../estimate/adapt-ema/formula";
import { ADAPT_MEAN_SEASON } from "../estimate/adapt-mean/params";
import { adaptMean } from "../estimate/adapt-mean/formula";
import { type Estimate, evaluate, has, type ParamSet } from "../estimate/engine";
import { level7 } from "../judge/level7/formula";
import { seasonShift } from "../judge/season-shift/formula";
import { SEASON_SHIFT_STANDARD } from "../judge/season-shift/params";
import { dayMeanSeries, type Site } from "../material/inputs";
import type { MaterialDay, MaterialHour } from "../material/material";
import { shadeFeel, type ShadeFeelSets } from "../plain/feelShade";

export interface ComparedDay {
  date: string;
  /** The day's row: its mean temperature is the history of the days after. */
  day: MaterialDay | null;
  /** The hours to judge (any, or none). */
  hours?: readonly MaterialHour[];
}

export interface ComparisonSets {
  feel: ShadeFeelSets;
  level: ParamSet<(typeof level7.params)[number]>;
  shift?: ParamSet<(typeof seasonShift.params)[number]>;
}

export interface HourOutcome {
  hour: number;
  feel: Estimate;
  level1: Estimate;
  level2: Estimate;
  /** Both steps are there and they differ. */
  differs: boolean;
}

export interface DayOutcome {
  date: string;
  l1: Estimate;
  l2: Estimate;
  shift1: Estimate;
  shift2: Estimate;
  /** Δb = g(L2) − g(L1), ℃; null unless both shifts are there. */
  delta: number | null;
  hours: HourOutcome[];
}

export interface Comparison {
  days: DayOutcome[];
  /** Days where both shifts are there. */
  comparableDays: number;
  /** Days left out, by the reason(s) of each side ("L1: tooShort"). */
  leftOut: Record<string, number>;
  hoursCompared: number;
  hoursDiffer: number;
  /** Largest |Δb| over the comparable days, ℃. */
  largestDelta: number | null;
}

const value = (e: Estimate) => (has(e) ? e.value : null);
const why = (e: Estimate) => ("absent" in e ? e.absent : null);

/**
 * `days` are consecutive, oldest first; each day's baselines read the days before it in the list.
 * The first days have little before them: they come out tooShort, as they should.
 */
export function compareAdaptation(days: readonly ComparedDay[], site: Site, sets: ComparisonSets): Comparison {
  const shiftSet = sets.shift ?? SEASON_SHIFT_STANDARD;
  const out: DayOutcome[] = [];
  const leftOut: Record<string, number> = {};
  let hoursCompared = 0;
  let hoursDiffer = 0;
  let largestDelta: number | null = null;

  days.forEach((d, i) => {
    const before = days
      .slice(0, i)
      .reverse()
      .map((b) => b.day);
    const history = { dayMeans: dayMeanSeries(before) };
    const l1 = evaluate(adaptMean, ADAPT_MEAN_SEASON, history);
    const l2 = evaluate(adaptEma, ADAPT_EMA_STANDARD, history);
    const shift1 = evaluate(seasonShift, shiftSet, { adapt: l1 });
    const shift2 = evaluate(seasonShift, shiftSet, { adapt: l2 });
    const s1 = value(shift1);
    const s2 = value(shift2);
    const delta = s1 != null && s2 != null ? s2 - s1 : null;
    if (delta == null) {
      const key = [why(l1) && `L1: ${why(l1)}`, why(l2) && `L2: ${why(l2)}`].filter(Boolean).join("・");
      leftOut[key] = (leftOut[key] ?? 0) + 1;
    } else if (largestDelta == null || Math.abs(delta) > Math.abs(largestDelta)) largestDelta = delta;

    const hours = (d.hours ?? []).map((h): HourOutcome => {
      const feel = shadeFeel(h, site, sets.feel);
      const level1 = evaluate(level7, sets.level, { feel, shift: shift1 });
      const level2 = evaluate(level7, sets.level, { feel, shift: shift2 });
      const a = value(level1);
      const b = value(level2);
      const differs = a != null && b != null && a !== b;
      if (a != null && b != null) {
        hoursCompared++;
        if (differs) hoursDiffer++;
      }
      return { hour: h.hour, feel, level1, level2, differs };
    });
    out.push({ date: d.date, l1, l2, shift1, shift2, delta, hours });
  });

  return {
    days: out,
    comparableDays: out.filter((d) => d.delta != null).length,
    leftOut,
    hoursCompared,
    hoursDiffer,
    largestDelta,
  };
}

// 学習なし版の慣れ (principles 0): the two long baselines from the days before, with their sets
// that have a written basis. The learned version keeps the same formulas and fits α.

import { ADAPT_EMA_STANDARD } from "../estimate/adapt-ema/params";
import { adaptEma } from "../estimate/adapt-ema/formula";
import { ADAPT_MEAN_SEASON } from "../estimate/adapt-mean/params";
import { adaptMean } from "../estimate/adapt-mean/formula";
import { type Estimate, evaluate } from "../estimate/engine";
import { dayMeanSeries } from "../material/inputs";
import type { MaterialDay } from "../material/material";

/** 慣れ-L1 from the days before, newest first. */
export function adaptationMean(days: readonly (MaterialDay | null)[]): Estimate {
  return evaluate(adaptMean, ADAPT_MEAN_SEASON, { dayMeans: dayMeanSeries(days) });
}

/** 慣れ-L2 from the days before, newest first. */
export function adaptationEma(days: readonly (MaterialDay | null)[]): Estimate {
  return evaluate(adaptEma, ADAPT_EMA_STANDARD, { dayMeans: dayMeanSeries(days) });
}

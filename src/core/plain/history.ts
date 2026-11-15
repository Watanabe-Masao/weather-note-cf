// 学習なし版の長期の気温履歴 (principles 0): its two summaries from the days before, with their sets
// that have a written basis. The learned version keeps the same formulas and fits α.

import { HISTORY_EMA_STANDARD } from "../estimate/history-ema/params";
import { historyEma } from "../estimate/history-ema/formula";
import { HISTORY_MEAN_SEASON } from "../estimate/history-mean/params";
import { historyMean } from "../estimate/history-mean/formula";
import { type Estimate, evaluate } from "../estimate/engine";
import { dayMeanSeries } from "../material/inputs";
import type { MaterialDay } from "../material/material";

/** 長期の気温履歴 L1 from the days before, newest first. */
export function longHistoryMean(days: readonly (MaterialDay | null)[]): Estimate {
  return evaluate(historyMean, HISTORY_MEAN_SEASON, { dayMeans: dayMeanSeries(days) });
}

/** 長期の気温履歴 L2 from the days before, newest first. */
export function longHistoryEma(days: readonly (MaterialDay | null)[]): Estimate {
  return evaluate(historyEma, HISTORY_EMA_STANDARD, { dayMeans: dayMeanSeries(days) });
}

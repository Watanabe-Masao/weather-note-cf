// 「効いた」と言える決まり (principles 7): a new part of a learned model can be said to work only when
// the model with it beats the same model without it, AND beats the answers' shares alone — learning
// from the weather at all comes first. Both by the day-block interval lying wholly below 0.

import type { Comparison } from "./prequential";

export type Verdict =
  /** Fewer than two days: no interval yet. */
  | "tooFew"
  /** The model does not beat the answers' shares alone: nothing learned from the weather yet. */
  | "noWeather"
  /** Beats the model without the part, interval below 0. */
  | "helps"
  /** Worse than without it, interval above 0. */
  | "hurts"
  /** The interval spans 0. */
  | "unclear";

const below = (c: Comparison | null) => !!(c?.interval && c.interval[1] < 0);

/** `withVsWithout`: the model without the part as A, with it as B; `withVsShares`: the shares as A. */
export function verdict(withVsWithout: Comparison, withVsShares: Comparison): Verdict {
  if (withVsWithout.interval == null) return "tooFew";
  if (!below(withVsShares)) return "noWeather";
  if (below(withVsWithout)) return "helps";
  if (withVsWithout.interval[0] > 0) return "hurts";
  return "unclear";
}

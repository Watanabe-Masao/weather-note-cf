// history.long.ema（長期の気温履歴 L2）: the days before summed up as the running mean of adaptive
// comfort standards. One summary of the long history that 慣れ is thought to come from — not 慣れ
// itself, which is a latent state no formula gives (principles 0b).
// (EN 16798-1: θrm = (1 − α)·θ(d−1) + α·θrm(d−1)). In closed form day d−k weighs (1 − α)·α^(k−1),
// so newer days count more; α is how slowly it forgets.
//   L2 = Σ w_k·θ_k / Σ w_k over the days that have a value among the last `days`
// It holds only when the day before is there and the present days carry at least `minCoverage` of
// the weight.

import { ema, emaShortage } from "../ema";
import { defineFormula } from "../engine";

export const historyEma = defineFormula({
  id: "history.long.ema",
  version: 1,
  key: "historyEma",
  label: "長期の気温履歴（重み付きの平均）",
  unit: "℃",
  needs: [],
  series: ["dayMeans"],
  params: ["alpha", "days", "minCoverage"],
  enough: (s, p) => emaShortage(s.dayMeans, p.alpha, p.days, p.minCoverage, "前日"),
  compute: (_x, p, s) => ema(s.dayMeans, p.alpha, p.days),
});

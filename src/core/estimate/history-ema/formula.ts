// history.long.ema（長期の気温履歴 L2）: the days before summed up as the running mean of adaptive
// comfort standards. One summary of the long history that 慣れ is thought to come from — not 慣れ
// itself, which is a latent state no formula gives (principles 0b).
// (EN 16798-1: θrm = (1 − α)·θ(d−1) + α·θrm(d−1)). In closed form day d−k weighs (1 − α)·α^(k−1),
// so newer days count more; α is how slowly it forgets.
//   L2 = Σ w_k·θ_k / Σ w_k over the days that have a value among the last `days`
// It holds only when the day before is there and the present days carry at least `minCoverage` of
// the weight.

import { defineFormula, type Run } from "../engine";

const weights = (run: Run, alpha: number, days: number) =>
  run.slice(0, days).map((v, k) => ({ v, w: (1 - alpha) * alpha ** k }));

export const historyEma = defineFormula({
  id: "history.long.ema",
  version: 1,
  key: "historyEma",
  label: "長期の気温履歴（重み付きの平均）",
  unit: "℃",
  needs: [],
  series: ["dayMeans"],
  params: ["alpha", "days", "minCoverage"],
  enough: (s, p) => {
    if (s.dayMeans[0] == null) return { have: 0, need: 1, of: "前日" };
    const all = weights(s.dayMeans, p.alpha, p.days);
    const total = all.reduce((a, d) => a + d.w, 0);
    const have = all.filter((d) => d.v != null).reduce((a, d) => a + d.w, 0) / total;
    return have >= p.minCoverage ? null : { have, need: p.minCoverage, of: "重みの割合" };
  },
  compute: (_x, p, s) => {
    const present = weights(s.dayMeans, p.alpha, p.days).filter((d): d is { v: number; w: number } => d.v != null);
    return present.reduce((a, d) => a + d.w * d.v, 0) / present.reduce((a, d) => a + d.w, 0);
  },
});

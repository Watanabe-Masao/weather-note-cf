// history.long.mean（長期の気温履歴 L1）: the days before summed up as the plain mean of their mean
// temperatures. One summary of the long history, not 慣れ itself (principles 0b):
// temperatures — every day in the window weighs the same.
//   L1 = mean of the days that have a value among the last `days` (needs at least `minDays`)

import { defineFormula, type Run } from "../engine";

const present = (run: Run, days: number) => run.slice(0, days).filter((v): v is number => v != null);

export const historyMean = defineFormula({
  id: "history.long.mean",
  version: 1,
  key: "historyMean",
  label: "長期の気温履歴（単純平均）",
  unit: "℃",
  needs: [],
  series: ["dayMeans"],
  params: ["days", "minDays"],
  enough: (s, p) => {
    const have = present(s.dayMeans, p.days).length;
    return have >= p.minDays ? null : { have, need: p.minDays, of: "日" };
  },
  compute: (_x, p, s) => {
    const v = present(s.dayMeans, p.days);
    return v.reduce((a, b) => a + b, 0) / v.length;
  },
});

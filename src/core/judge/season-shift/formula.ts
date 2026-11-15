// judge.shift.season: how far 従来版's seven-step boundaries move with what one is used to (#111).
//   shift = slope × (min(hi, max(lo, 長期の気温履歴)) − ref)
// Beyond lo and hi one is used to no more: the clamp is the model's shape (頭打ち), with its own
// numbers, not a fill-in for missing data. The history is either summary (L1 or L2) — the same shift for both,
// so the two can be compared with nothing else changed.

import { defineFormula } from "../../estimate/engine";

export const seasonShift = defineFormula({
  id: "judge.shift.season",
  version: 1,
  key: "seasonShift",
  label: "境目のずれ（季節）",
  unit: "℃",
  needs: ["history"],
  choices: { history: ["historyMean", "historyEma"] },
  params: ["slope", "lo", "hi", "ref"],
  compute: (x, p) => p.slope * (Math.min(p.hi, Math.max(p.lo, x.history)) - p.ref),
});

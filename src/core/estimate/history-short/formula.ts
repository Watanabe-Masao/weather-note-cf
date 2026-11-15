// history.short.ema（短期の履歴 S）: the hours before summed up as a weighted running mean of the
// 肌感 — the same shape as the long history (estimate/ema.ts), in hours. What the day so far has
// been like to be out in; a summary, not 慣れ itself (principles 0b). The hours run across midnight:
// the caller passes the day before's evening too.

import { ema, emaShortage } from "../ema";
import { defineFormula } from "../engine";

export const historyShort = defineFormula({
  id: "history.short.ema",
  version: 1,
  key: "historyShort",
  label: "短期の履歴（肌感の重み付きの平均）",
  unit: "℃",
  needs: [],
  series: ["hourFeels"],
  choices: { hourFeels: ["feelShade", "feelSun"] },
  params: ["alpha", "hours", "minCoverage"],
  enough: (s, p) => emaShortage(s.hourFeels, p.alpha, p.hours, p.minCoverage, "1時間前"),
  compute: (_x, p, s) => ema(s.hourFeels, p.alpha, p.hours),
});

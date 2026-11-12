// feel-3 (UTCI, shared/mrt.ts) beside feel-1 (in use): Kochi, typical hours.
// Run:  research/data/node_modules/.bin/vite-node research/comfort-model/utci-compare.ts   (writes utci-compare-results.md)

import { writeFileSync } from "node:fs";
import { DEFAULT_FEEL, feelOf } from "../../shared/feel";
import { feel3, hourRadiation, utciWind } from "../../shared/mrt";

const K = "47893";
const r1 = (v: number | null) => (v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1));

const cases = [
  { name: "夏の昼・晴れ", date: "2026-08-10", n: 13, t: 33, rh: 60, v: 3, sun: 1 },
  { name: "夏の昼・曇り", date: "2026-08-10", n: 13, t: 30, rh: 75, v: 3, sun: 0 },
  { name: "夏の朝 8時・晴れ", date: "2026-08-10", n: 8, t: 27, rh: 80, v: 1.5, sun: 1 },
  { name: "夏の夜 21時", date: "2026-08-10", n: 21, t: 27, rh: 85, v: 1.5, sun: 0 },
  { name: "春の昼・晴れ", date: "2026-04-15", n: 13, t: 21, rh: 50, v: 3, sun: 1 },
  { name: "冬の昼・晴れ", date: "2026-01-15", n: 13, t: 11, rh: 45, v: 3, sun: 1 },
  { name: "冬の昼・晴れ・風", date: "2026-01-15", n: 13, t: 11, rh: 45, v: 7, sun: 1 },
  { name: "冬の昼・曇り", date: "2026-01-15", n: 13, t: 8, rh: 70, v: 3, sun: 0 },
  { name: "冬の朝 8時・晴れ", date: "2026-01-15", n: 8, t: 2, rh: 75, v: 1.5, sun: 0.2 },
  { name: "冬の夜 21時", date: "2026-01-15", n: 21, t: 5, rh: 70, v: 2, sun: 0 },
];
const lines = [
  "# 肌感：feel-1（今）と feel-3（UTCI、候補）",
  "",
  "高知。風は観測所（10m）の値、周りの様子は既定（建物が密集、α 0.40）。feel-1 の日差しの強さは既定（0.20）。比べるのは土台の値だけ（D18）。どの値をどう感じるかは β モデルが受け持つので、ここでは段を出さない。",
  "",
  "| 場面 | 気温 | feel-1 日かげ / 日なた | feel-3 日かげ / 日なた | feel-3 日なたの上乗せ | feel-1 日なたの上乗せ |",
  "|---|---|---|---|---|---|",
];
for (const c of cases) {
  const s = { ...DEFAULT_FEEL };
  const rad = hourRadiation(c.date, c.n, K, c.sun);
  const solar = rad ? rad.ghi : 0;
  const f1shade = feelOf(c.t, c.rh, c.v, true, { ...s, sun: false }, null);
  const f1sun = feelOf(c.t, c.rh, c.v, true, { ...s, sun: true }, solar);
  const f3 = feel3(c.t, c.rh, utciWind(c.v, 10, s.alpha), rad);
  lines.push(
    `| ${c.name} | ${c.t} | ${r1(f1shade)} / ${r1(f1sun)} | ${r1(f3.shade)} / ${r1(f3.sun)} | ${r1(f3.sun! - f3.shade!)} | ${r1(f1sun! - f1shade!)} |`,
  );
}
lines.push("", "feel-1 の日なたは、地面の日射（ここでは feel-3 と同じ見積もり）に k を掛けた上乗せ。feel-3 は日なた・日かげとも UTCI（平均放射温度 = 気温 + 日差しの分、日かげは空の4割だけ見える）。夜の放射冷却と焼けた地面の熱は、どちらにも入っていない。");
writeFileSync(new URL("./utci-compare-results.md", import.meta.url), lines.join("\n") + "\n");
console.log(lines.join("\n"));

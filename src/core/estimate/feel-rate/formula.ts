// feel.rate: 肌感の変化の速さ (℃/h) — how fast the 肌感 has been moving over the last `lag` hours:
//   rate = (F_now − F_{now − lag}) / lag
// Positive while it is getting warmer, negative while colder.

import { defineFormula } from "../engine";

export const feelRate = defineFormula({
  id: "feel.rate",
  version: 1,
  key: "feelRate",
  label: "肌感の変化の速さ",
  unit: "℃/h",
  needs: ["feel"],
  choices: { feel: ["feelShade", "feelSun"], hourFeels: ["feelShade", "feelSun"] },
  series: ["hourFeels"],
  params: ["lag"],
  enough: (s, p) => (s.hourFeels[p.lag - 1] != null ? null : { have: 0, need: 1, of: `${p.lag}時間前` }),
  compute: (x, p, s) => (x.feel - s.hourFeels[p.lag - 1]!) / p.lag,
});

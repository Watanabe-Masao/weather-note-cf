// feel.sun: 肌感（日なた） — the shade's 肌感 plus the radiation term of the Bureau of Meteorology's
// apparent temperature: + k·Q/(v₁₀ + v₀), Q = absorb × global radiation (W/m²), v₁₀ the wind at 10 m.
// At night the radiation is 0 and 日なた is 日かげ.

import { defineFormula } from "../engine";

export const feelSun = defineFormula({
  id: "feel.sun",
  version: 1,
  key: "feelSun",
  label: "肌感（日なた）",
  unit: "℃",
  needs: ["feelShade", "radSunshine", "windTen"],
  params: ["k", "windOffset", "absorb"],
  domain: { radSunshine: { min: 0 }, windTen: { min: 0 } },
  compute: (x, p) => x.feelShade + (p.k * p.absorb * x.radSunshine) / (x.windTen + p.windOffset),
});

// wind.person: the wind at a person's height from the wind at the anemometer, by the power law
// v_person = v × (h_person / h_measured)^α (α: how built-up the surroundings are).

import { defineFormula } from "../engine";

export const windPerson = defineFormula({
  id: "wind.person",
  version: 1,
  label: "人の高さの風速",
  unit: "m/s",
  needs: ["wind", "windHeight"],
  params: ["personHeight", "alpha"],
  domain: { wind: { min: 0 }, windHeight: { above: 0 } },
  compute: (x, p) => x.wind * (p.personHeight / x.windHeight) ** p.alpha,
});

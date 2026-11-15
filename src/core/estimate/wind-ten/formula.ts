// wind.ten: the wind at 10 m (what the Bureau of Meteorology's radiation term takes) from the wind
// at the anemometer, by the same power law as wind.person: v₁₀ = v × (10 m / h_measured)^α. The
// forecast's wind is already at 10 m (the ratio is 1).

import { defineFormula } from "../engine";

export const windTen = defineFormula({
  id: "wind.ten",
  version: 1,
  key: "windTen",
  label: "10 m の風速",
  unit: "m/s",
  needs: ["wind", "windHeight"],
  params: ["tenMeters", "alpha"],
  domain: { wind: { min: 0 }, windHeight: { above: 0 } },
  compute: (x, p) => x.wind * (p.tenMeters / x.windHeight) ** p.alpha,
});

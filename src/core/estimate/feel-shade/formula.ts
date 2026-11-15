// feel.shade: 肌感（日かげ） — the improved Missenard apparent temperature from the temperature,
// the humidity and the wind at a person's height:
//   a  = a₀ + a₁·v^a₂
//   AT = T₀ − (T₀ − t) / (c₀ − c₁·h + 1/a) − d·t·(1 − h/100)

import { HUMIDITY_MAX, HUMIDITY_MIN } from "../../material/constants";
import { defineFormula } from "../engine";

export const feelShade = defineFormula({
  id: "feel.shade",
  version: 1,
  key: "feelShade",
  label: "肌感（日かげ）",
  unit: "℃",
  needs: ["temp", "humidity", "windPerson"],
  params: ["neutral", "a0", "a1", "a2", "c0", "c1", "d"],
  domain: { humidity: { min: HUMIDITY_MIN, max: HUMIDITY_MAX }, windPerson: { min: 0 } },
  compute: (x, p) => {
    const a = p.a0 + p.a1 * x.windPerson ** p.a2;
    return p.neutral - (p.neutral - x.temp) / (p.c0 - p.c1 * x.humidity + 1 / a) - p.d * x.temp * (1 - x.humidity / HUMIDITY_MAX);
  },
});

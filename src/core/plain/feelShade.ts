// 学習なし版の肌感（日かげ） (principles 0): material → wind.person → feel.shade, with sets that
// have a written basis (the setting 周りの様子, the Missenard coefficients). Reads no answers.

import { type Estimate, evaluate, type ParamSet } from "../estimate/engine";
import { FEEL_SHADE_MISSENARD } from "../estimate/feel-shade/params";
import { feelShade } from "../estimate/feel-shade/formula";
import { windPerson } from "../estimate/wind-person/formula";
import { hourInputs, type Site } from "../material/inputs";
import type { MaterialHour } from "../material/material";

export interface ShadeFeelSets {
  windPerson: ParamSet<(typeof windPerson.params)[number]>;
  feel?: ParamSet<(typeof feelShade.params)[number]>;
}

export function shadeFeel(hour: MaterialHour, site: Site, sets: ShadeFeelSets): Estimate {
  const x = hourInputs(hour, site);
  const wind = evaluate(windPerson, sets.windPerson, { wind: x.wind, windHeight: x.windHeight });
  return evaluate(feelShade, sets.feel ?? FEEL_SHADE_MISSENARD, { temp: x.temp, humidity: x.humidity, windPerson: wind });
}

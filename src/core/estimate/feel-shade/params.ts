// feel.shade の数: the improved Missenard formula's coefficients, as the app has used them
// (shared/feel.ts apparentTemperature). The plain version's only set.

import { defineParams } from "../engine";
import { feelShade } from "./formula";

const BASIS = "改良ミスナール式の係数（これまでの肌感 shared/feel.ts と同じ）";

export const FEEL_SHADE_MISSENARD = defineParams(feelShade, {
  id: "missenard",
  version: 1,
  values: {
    neutral: { value: 37, unit: "℃", basis: `${BASIS}：体温に近い中立の温度` },
    a0: { value: 1.76, unit: "", basis: BASIS },
    a1: { value: 1.4, unit: "", basis: BASIS },
    a2: { value: 0.75, unit: "", basis: `${BASIS}：風速のべき` },
    c0: { value: 0.68, unit: "", basis: BASIS },
    c1: { value: 0.0014, unit: "1/%", basis: BASIS },
    d: { value: 0.29, unit: "", basis: `${BASIS}：乾いた空気の冷え` },
  },
});

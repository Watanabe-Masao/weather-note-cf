// The new calculation core (docs/engineering-principles.md). Layers: material → estimate → judge,
// the judge in two versions: plain/ (no learning, never reads answers) and learned/.
// Nothing here imports from outside src/core except shared/types (test/data/core-boundary.test.ts).

export { DAY_FIELDS, HOUR_FIELDS, type DayField, type HourField } from "./material/fields";
export { type Absence, admits, dayOf, hourOf, type Kind, type MaterialDay, type MaterialHour } from "./material/material";
export { defineFormula, defineParams, evaluate, has, type Estimate, type Formula, type Param, type ParamSet, type Range, type Step, type Value } from "./estimate/engine";
export { feelShade } from "./estimate/feel-shade/formula";
export { FEEL_SHADE_MISSENARD } from "./estimate/feel-shade/params";
export { windPerson } from "./estimate/wind-person/formula";
export { PERSON_HEIGHT, SURROUNDINGS_ALPHA, windPersonSettings } from "./estimate/wind-person/params";
export { hourInputs, type HourInput, type Site } from "./material/inputs";
export { shadeFeel, type ShadeFeelSets } from "./plain/feelShade";
export { adaptEma } from "./estimate/adapt-ema/formula";
export { ADAPT_EMA_STANDARD } from "./estimate/adapt-ema/params";
export { adaptMean } from "./estimate/adapt-mean/formula";
export { ADAPT_MEAN_SEASON } from "./estimate/adapt-mean/params";
export { type AnyFormula, type Run, type Series, type Shortage } from "./estimate/engine";
export { coreMapDoc, edges, FORMULAS, MATERIAL_INPUTS, mermaid } from "./map";
export { dayMeanSeries } from "./material/inputs";
export { adaptationEma, adaptationMean } from "./plain/adaptation";

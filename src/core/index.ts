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

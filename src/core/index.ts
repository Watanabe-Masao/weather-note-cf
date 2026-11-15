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
export { historyEma } from "./estimate/history-ema/formula";
export { HISTORY_EMA_STANDARD } from "./estimate/history-ema/params";
export { historyMean } from "./estimate/history-mean/formula";
export { HISTORY_MEAN_SEASON } from "./estimate/history-mean/params";
export { type AnyFormula, type Run, type Series, type Shortage } from "./estimate/engine";
export { coreMapDoc, edges, FORMULAS, MATERIAL_INPUTS, mermaid } from "./map";
export { dayMeanSeries } from "./material/inputs";
export { longHistoryEma, longHistoryMean } from "./plain/history";
export { type ComparedDay, type Comparison, compareLongHistory, type ComparisonSets, type DayOutcome, type HourOutcome } from "./compare/history";
export { level7 } from "./judge/level7/formula";
export { LEVEL_NAMES, level7Settings } from "./judge/level7/params";
export { seasonShift } from "./judge/season-shift/formula";
export { SEASON_SHIFT_STANDARD } from "./judge/season-shift/params";
export { feelSun } from "./estimate/feel-sun/formula";
export { feelSunSettings } from "./estimate/feel-sun/params";
export { radSunshine } from "./estimate/sun/formula";
export { RAD_SUNSHINE_STANDARD } from "./estimate/sun/params";
export { windTen } from "./estimate/wind-ten/formula";
export { windTenSettings } from "./estimate/wind-ten/params";
export { hourStartOf } from "./material/inputs";
export { type FeelSettingsLike, sunFeel, sunshineRadiation } from "./plain/feelSun";
export { type Concept, CONCEPTS, type Hypothesis, HYPOTHESES } from "./hypotheses";
export { hypothesisMermaid } from "./map";

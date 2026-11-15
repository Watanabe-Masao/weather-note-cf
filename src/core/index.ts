// The new calculation core (docs/engineering-principles.md). Layers: material → estimate → judge,
// the judge in two versions: plain/ (no learning, never reads answers) and learned/.
// Nothing here imports from outside src/core except shared/types (test/data/core-boundary.test.ts).

export { DAY_FIELDS, HOUR_FIELDS, type DayField, type HourField } from "./material/fields";
export { admits, dayOf, hourOf, type Kind, type MaterialDay, type MaterialHour } from "./material/material";

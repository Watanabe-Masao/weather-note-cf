// 答え1件の入力 (principles 0, 6, 7): what the predictors may read of an answer, from the materials
// alone — the 肌感 at the place answered, the plain seasonal shift (long history L1), the short
// history S and how fast the 肌感 moved, and the plain step. Reads no answer but the place given.

import { type Estimate, evaluate } from "../estimate/engine";
import { level7 } from "../judge/level7/formula";
import { level7Settings } from "../judge/level7/params";
import { seasonShift } from "../judge/season-shift/formula";
import { SEASON_SHIFT_STANDARD } from "../judge/season-shift/params";
import type { Site } from "../material/inputs";
import type { MaterialDay, MaterialHour } from "../material/material";
import type { FeelSettingsLike } from "./feelSun";
import { longHistoryMean } from "./history";
import { shortHistories } from "./shortHistory";

export interface CaseInputs {
  feel: Estimate;
  shift: Estimate;
  short: Estimate;
  rate: Estimate;
  level: Estimate;
}

/** Where the person was: 日なた, 日かげ, 半々, or not asked (night: the two are the same). */
export type Place = "sun" | "shade" | "mixed" | null;

/**
 * `hours` consecutive and oldest first, the answer's hour at `index` (pass the day before's evening
 * too); `daysBefore` the days before the answer's date, newest first. 半々 has no 肌感 of its own.
 */
export function caseInputs(
  hours: readonly (MaterialHour | null)[],
  index: number,
  daysBefore: readonly (MaterialDay | null)[],
  place: Place,
  site: Site,
  s: FeelSettingsLike,
  thresholds: readonly [number, number, number, number, number, number],
): CaseInputs {
  const shift = evaluate(seasonShift, SEASON_SHIFT_STANDARD, { history: longHistoryMean(daysBefore) });
  if (place === "mixed") {
    const none: Estimate = { absent: "missingInput", inputs: { place: "mixed" }, trace: [] };
    return { feel: none, shift, short: none, rate: none, level: none };
  }
  const h = shortHistories(hours.slice(0, index + 1), site, s, place === "sun" ? "sun" : "shade")[index];
  return { feel: h.feel, shift, short: h.short, rate: h.rate, level: evaluate(level7, level7Settings(thresholds), { feel: h.feel, shift }) };
}

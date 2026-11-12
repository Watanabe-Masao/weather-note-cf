// #63: the numbers the preference models read from the two optional answers (decision D13).
// Contract: research/comfort-model/mathematical-contract.md (MATH-09)
//
// The saved answers keep their string IDs (warmer / same / cooler, warm / either / cold); only the
// models turn them into numbers, here. Every scale puts the warmer direction on +:
//
//   value | 温冷感 (feeling, 7 steps) | 温熱選好 (wanted change) | 飲料選好 (drink)
//    +1   | 暖かい側                  | 暖かくしたい              | 温かい飲み物
//     0   | ちょうどよい              | このままでよい            | どちらでもよい
//    −1   | 涼しい側                  | 涼しくしたい              | 冷たい飲み物
//
// The three measure different things: the same number does not mean the same in each. An
// unanswered question has no number (it is not 0).

import type { DrinkPreference, Report, ThermalPreference } from "./reports";

export type PreferenceScore = -1 | 0 | 1;

export const PREFERENCE_SCORE = {
  thermal: { warmer: 1, same: 0, cooler: -1 } satisfies Record<ThermalPreference, PreferenceScore>,
  drink: { warm: 1, either: 0, cold: -1 } satisfies Record<DrinkPreference, PreferenceScore>,
} as const;

/** The two answers of a report as numbers; null where not answered (or not asked). */
export function preferenceScores(r: Pick<Report, "thermalPreference" | "drinkPreference">): { thermal: PreferenceScore | null; drink: PreferenceScore | null } {
  return {
    thermal: r.thermalPreference ? PREFERENCE_SCORE.thermal[r.thermalPreference] : null,
    drink: r.drinkPreference ? PREFERENCE_SCORE.drink[r.drinkPreference] : null,
  };
}

/** A preference index from the three probabilities [P(−1), P(0), P(+1)]: P(+1) − P(−1), in −1…+1.
 *  Positive leans warm. 0 is not "no change" (both sides can be equally likely): show the
 *  probabilities with it. */
export const preferenceIndex = (p: [number, number, number]) => p[2] - p[0];

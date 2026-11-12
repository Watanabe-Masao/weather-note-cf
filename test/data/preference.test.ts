// #63 (D13): the numbers of the preference answers. Warmer is + on every scale; unanswered is not 0.
import { describe, expect, it } from "vitest";
import { PREFERENCE_SCORE, preferenceIndex, preferenceScores } from "../../src/beta/preference";
import { DRINK_PREFERENCES, THERMAL_PREFERENCES } from "../../src/beta/reports";

describe("preference coding (D13)", () => {
  it("puts the warmer side on +1 for both questions, and covers every answer", () => {
    expect(PREFERENCE_SCORE.thermal).toEqual({ warmer: 1, same: 0, cooler: -1 });
    expect(PREFERENCE_SCORE.drink).toEqual({ warm: 1, either: 0, cold: -1 });
    expect(THERMAL_PREFERENCES.map((t) => PREFERENCE_SCORE.thermal[t.id])).toEqual([1, 0, -1]);
    expect(DRINK_PREFERENCES.map((d) => PREFERENCE_SCORE.drink[d.id])).toEqual([1, 0, -1]);
  });
  it("leaves an unanswered question without a number", () => {
    expect(preferenceScores({ drinkPreference: "either" })).toEqual({ thermal: null, drink: 0 });
    expect(preferenceScores({})).toEqual({ thermal: null, drink: null });
  });
  it("index = P(+1) − P(−1)", () => {
    expect(preferenceIndex([0.2, 0.3, 0.5])).toBeCloseTo(0.3);
    expect(preferenceIndex([0.5, 0, 0.5])).toBe(0); // 0 with no one wanting "no change"
  });
});

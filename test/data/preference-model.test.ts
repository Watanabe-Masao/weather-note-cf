// MATH-09: the preference models (#63 P3). Probabilities, direction, the rules, and the inputs.
import { describe, expect, it } from "vitest";
import { fitPreference, type PrefObs, predictPreference, prefProbs, prefRps, preferenceLearning, preferenceObservations } from "../../src/beta/preferenceModel";
import { makeReport } from "../../research/data/fixture";

const obsAt = (e: number, k: -1 | 0 | 1, i: number): PrefObs => ({ e, a: 15, y: 0, k, t: i * 86_400_000, w: 1 });
/** Warm drinks when cool, cold ones when warm, either in between. */
const clear = Array.from({ length: 30 }, (_, i) => {
  const e = 10 + (i % 10) * 2;
  return obsAt(e, e < 16 ? 1 : e > 24 ? -1 : 0, i);
});

describe("preference model", () => {
  it("gives three non-negative probabilities that sum to 1", () => {
    for (const th of [[0, 0, 0, 0, 0, 0], [3, -2, 1, -4, 2, 0.5]]) {
      const p = prefProbs(th, [1, 0.5, -1]);
      expect(p.every((v) => v >= 0)).toBe(true);
      expect(p[0] + p[1] + p[2]).toBeCloseTo(1, 12);
    }
  });

  it("learns the direction: warm (+) when cool, cold (−) when warm", () => {
    const fit = fitPreference(clear, { withFeeling: false, halfLifeDays: null, now: 0 });
    const cool = predictPreference(fit, { e: 11, a: 15 });
    const warm = predictPreference(fit, { e: 28, a: 15 });
    expect(cool.index).toBeGreaterThan(0.4);
    expect(warm.index).toBeLessThan(-0.4);
    expect(cool.indexInterval[0]).toBeLessThanOrEqual(cool.index);
    expect(cool.indexInterval[1]).toBeGreaterThanOrEqual(cool.index);
  });

  it("does not show an index from few or one-sided answers, and shows it once there is enough", () => {
    const few = clear.slice(0, 6);
    const f1 = fitPreference(few, { withFeeling: false, halfLifeDays: null, now: 0 });
    expect(preferenceLearning(few, f1, predictPreference(f1, { e: 20, a: 15 })).show).toBe(false);
    const same = clear.map((o) => ({ ...o, k: 0 as const }));
    const f2 = fitPreference(same, { withFeeling: false, halfLifeDays: null, now: 0 });
    expect(preferenceLearning(same, f2, predictPreference(f2, { e: 20, a: 15 })).missing.join()).toContain("2種類以上");
    const f3 = fitPreference(clear, { withFeeling: false, halfLifeDays: null, now: 0 });
    expect(preferenceLearning(clear, f3, predictPreference(f3, { e: 20, a: 15 })).fit).toBe(true);
  });

  it("weighs older answers less with a half-life", () => {
    const old = [...clear.map((o) => ({ ...o, t: 0 })), obsAt(20, 1, 100)];
    const flat = fitPreference(old, { withFeeling: false, halfLifeDays: null, now: 100 * 86_400_000 });
    const hl = fitPreference(old, { withFeeling: false, halfLifeDays: 14, now: 100 * 86_400_000 });
    expect(hl.nEff).toBeLessThan(flat.nEff);
  });

  it("scores with a 3-category RPS", () => {
    expect(prefRps([0, 0, 1], 1)).toBe(0);
    expect(prefRps([1, 0, 0], 1)).toBe(1);
  });

  it("reads answered reports only, as −1/0/+1 (D13), unanswered left out", () => {
    const rs = [
      makeReport("a", 9, 12, -1, { preferenceVersion: 1, drinkPreference: "warm" }),
      makeReport("b", 13, 22, 1, { preferenceVersion: 1, drinkPreference: "cold", thermalPreference: "cooler" }),
      makeReport("c", 14, 20, 0, { preferenceVersion: 1 }),
    ];
    expect(preferenceObservations(rs, "drink").map((o) => o.k)).toEqual([1, -1]);
    expect(preferenceObservations(rs, "thermal").map((o) => o.k)).toEqual([-1]);
  });
});

import { describe, expect, it } from "vitest";
import { adoptionCheck, falseDiscovery, pairedDifference, pitHistogram, randomizedPit, residualSlope, seeded, surrogateResidual } from "../../src/beta/engine/diagnostics";

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
/** Probabilities over the 7 steps of a logistic latent with location m and the given boundaries. */
const probsOf = (m: number, th = [-7, -5, -2, 2, 5, 7]) => {
  const c = [0, ...th.map((b) => logistic(b - m)), 1];
  return Array.from({ length: 7 }, (_, k) => c[k + 1] - c[k]);
};
/** An answer drawn from the same latent (the model is right). */
const draw = (m: number, r: () => number, th = [-7, -5, -2, 2, 5, 7]) => {
  const u = r();
  const z = m + Math.log(u / (1 - u));
  return th.filter((b) => z > b).length - 3;
};

describe("residuals for 7-step answers", () => {
  it("puts the answer between P(Y < y) and P(Y ≤ y)", () => {
    const p = [0.1, 0.1, 0.2, 0.3, 0.2, 0.05, 0.05];
    expect(randomizedPit(p, 0, 0)).toBeCloseTo(0.4, 9);
    expect(randomizedPit(p, 0, 0.5)).toBeCloseTo(0.55, 9);
    expect(randomizedPit(p, -3, 0)).toBeGreaterThan(0);
    expect(surrogateResidual(p, 0, 0.5)).toBeCloseTo(Math.log(0.55 / 0.45), 9);
  });

  it("is flat and centred when the predictions are right, slanted when one is off", () => {
    const r = seeded(3);
    const pits: number[] = [], res: number[] = [], wind: number[] = [], bad: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const w = r() * 8, m = (r() - 0.5) * 10;
      const y = draw(m, r);
      pits.push(randomizedPit(probsOf(m), y, r()));
      res.push(surrogateResidual(probsOf(m), y, r()));
      wind.push(w);
      // The same answers judged by a model that takes the wind as 0.5 warmer per m/s than it is.
      bad.push(surrogateResidual(probsOf(m + 0.5 * w - 2), y, r()));
    }
    const h = pitHistogram(pits, 10);
    for (const c of h) expect(Math.abs(c - 400)).toBeLessThan(80);
    expect(Math.abs(res.reduce((a, b) => a + b, 0) / res.length)).toBeLessThan(0.1);
    expect(residualSlope(wind, res)!.p).toBeGreaterThan(0.01);
    const s = residualSlope(wind, bad)!;
    expect(s.slope).toBeLessThan(-0.3); // felt colder than the bad model says as the wind grows
    expect(s.p).toBeLessThan(1e-6);
  });

  it("needs a few points and some spread", () => {
    expect(residualSlope([1, 2, 3], [0, 0, 0])).toBeNull();
    expect(residualSlope([1, 1, 1, 1, 1], [0, 1, 0, 1, 0])).toBeNull();
  });
});

describe("many variables at once", () => {
  it("keeps the false flags rare (Benjamini–Hochberg)", () => {
    expect(falseDiscovery([0.001, 0.2, 0.04, 0.8], 0.1)).toEqual([true, false, true, false]); // 0.04 ≤ 2/4 × 0.1
    expect(falseDiscovery([0.001, 0.2, 0.06, 0.8], 0.1)).toEqual([true, false, false, false]);
    expect(falseDiscovery([0.001, 0.02, 0.03, 0.8], 0.1)).toEqual([true, true, true, false]);
    // 20 variables with nothing in them: by chance one p under 0.05, but none survives.
    const r = seeded(9);
    const p = Array.from({ length: 20 }, () => 0.05 + r() * 0.95);
    p[7] = 0.03;
    expect(falseDiscovery(p, 0.1).some(Boolean)).toBe(false);
  });
});

describe("two models on the same answers", () => {
  it("draws whole days, so many answers of a few days do not pass for more evidence", () => {
    const r = seeded(5);
    // b is better by 0.01 on average, with a large day-to-day swing shared by that day's answers.
    const pairs = [];
    for (let d = 0; d < 30; d++) {
      const day = `2026-10-${String(d + 1).padStart(2, "0")}`;
      const swing = (r() - 0.5) * 0.08;
      for (let k = 0; k < 3; k++) pairs.push({ day, a: 0.12, b: 0.11 - swing + (r() - 0.5) * 0.01 });
    }
    const d = pairedDifference(pairs, 2000, 1)!;
    expect(d.n).toBe(90);
    expect(d.days).toBe(30);
    expect(d.lo).toBeLessThan(d.mean);
    expect(d.hi).toBeGreaterThan(d.mean);
    // Treating the 90 answers as independent would give a much narrower interval.
    const flat = pairedDifference(pairs.map((p, i) => ({ ...p, day: String(i) })), 2000, 1)!;
    expect(d.hi - d.lo).toBeGreaterThan(1.4 * (flat.hi - flat.lo));
    expect(pairedDifference([])).toBeNull();
  });

  it("adopts a candidate only by the rule fixed in advance (MATH-08)", () => {
    const good = { n: 80, days: 30, mean: 0.01, lo: 0.002, hi: 0.018 };
    expect(adoptionCheck({ diff: good, seasonal: false }).ok).toBe(true);
    expect(adoptionCheck({ diff: { ...good, lo: -0.001 }, seasonal: false }).reasons[0]).toContain("0 を含む");
    expect(adoptionCheck({ diff: { ...good, n: 40 }, seasonal: false }).reasons[0]).toContain("40 件");
    expect(adoptionCheck({ diff: good, seasonal: true, seasonMin: 14, seasonMax: 20 }).ok).toBe(false);
    expect(adoptionCheck({ diff: good, seasonal: true, seasonMin: 9, seasonMax: 27 }).ok).toBe(true);
    expect(adoptionCheck({ diff: null, seasonal: false }).ok).toBe(false);
  });
});

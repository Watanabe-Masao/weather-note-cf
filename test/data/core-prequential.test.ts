// 1歩先の予測で比べる (principles 7, #117): no answer is learned from before it is predicted, the
// plain version reads no answers, and the scores and the interval behave.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Case, compareScores, plainLevelPredictor, type PlainInputs, type Predictor, prequential, rps, STEPS } from "../../src/core";
import { climatologyPredictor } from "../../src/core/learned";

const oneHot = (k: number) => Array.from({ length: STEPS }, (_, i) => (i === k ? 1 : 0));
const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 2))).toISOString().slice(0, 10);
function cases(answers: number[], levels: (number | null)[] = answers): Case<PlainInputs>[] {
  return answers.map((answer, i) => ({
    id: `c${i}`,
    at: Date.UTC(2026, 9, 1) + i * 6 * 3_600_000,
    date: day(i),
    answer,
    inputs: { level: levels[i] == null ? { absent: "missingInput", inputs: { feel: "notObserved" }, trace: [] } : { value: levels[i]!, trace: [] } },
  }));
}
const answer = fc.integer({ min: 0, max: STEPS - 1 });

describe("RPS", () => {
  it("is 0 for the answer with all the weight, 1 for the far end, and grows with the distance", () => {
    for (let a = 0; a < STEPS; a++) expect(rps(oneHot(a), a)).toBe(0);
    expect(rps(oneHot(0), STEPS - 1)).toBe(1);
    expect(rps(oneHot(3), 4)).toBeLessThan(rps(oneHot(3), 6));
  });

  it("stays within 0 and 1 for any forecast", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: STEPS, maxLength: STEPS }), answer, (w, a) => {
        const sum = w.reduce((x, y) => x + y, 0);
        fc.pre(sum > 0);
        const r = rps(w.map((x) => x / sum), a);
        expect(r).toBeGreaterThanOrEqual(-1e-12);
        expect(r).toBeLessThanOrEqual(1 + 1e-12);
      }),
    );
  });
});

describe("one step ahead", () => {
  it("a learned predictor only ever sees answers given before the one it predicts", () => {
    fc.assert(
      fc.property(fc.array(answer, { minLength: 2, maxLength: 30 }), (as) => {
        const cs = cases(as);
        const seen: { predicting: number; past: number[] }[] = [];
        let predicting = -1;
        const spy: Predictor<PlainInputs> = {
          id: "spy",
          kind: "learned",
          fit: (past) => {
            seen.push({ predicting, past: past.map((p) => p.at) });
            return { predict: () => oneHot(0) };
          },
        };
        // which case is being predicted: the loop goes in time order, so count calls
        const order = [...cs].sort((a, b) => a.at - b.at);
        let i = 0;
        const counting: Predictor<PlainInputs> = { ...spy, fit: (past) => ((predicting = order[i++].at), spy.fit(past)) };
        prequential(cs, [counting]);
        for (const s of seen) for (const t of s.past) expect(t).toBeLessThan(s.predicting);
      }),
    );
  });

  it("answers given at the same moment never see each other", () => {
    const cs = cases([1, 5]).map((c) => ({ ...c, at: 0 }));
    const sizes: number[] = [];
    prequential(cs, [{ id: "spy", kind: "learned", fit: (past) => (sizes.push(past.length), { predict: () => oneHot(0) }) }]);
    expect(sizes).toEqual([0, 0]);
  });

  it("the plain version reads no answers: other answers, the same forecasts", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(answer, answer, answer), { minLength: 1, maxLength: 20 }), (rows) => {
        const levels = rows.map((r) => r[0]);
        const a = prequential(cases(rows.map((r) => r[1]), levels), [plainLevelPredictor]);
        const b = prequential(cases(rows.map((r) => r[2]), levels), [plainLevelPredictor]);
        expect(a.map((s) => s.by[plainLevelPredictor.id]?.forecast)).toEqual(b.map((s) => s.by[plainLevelPredictor.id]?.forecast));
      }),
    );
  });

  it("a case the plain judge cannot judge is left out for it, with no score", () => {
    const s = prequential(cases([3, 3], [3, null]), [plainLevelPredictor, climatologyPredictor]);
    expect(s[1].by[plainLevelPredictor.id]).toBeNull();
    expect(s[1].by[climatologyPredictor.id]).not.toBeNull();
  });
});

describe("the climatology: answers only, no weather", () => {
  it("starts even, then follows how often each step was answered", () => {
    const s = prequential(cases([2, 2, 2, 4]), [climatologyPredictor]);
    expect(s[0].by[climatologyPredictor.id]!.forecast).toEqual(Array(STEPS).fill(1 / STEPS));
    const last = s[3].by[climatologyPredictor.id]!.forecast;
    expect(last[2]).toBeCloseTo(4 / (STEPS + 3), 12);
    expect(last.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

describe("comparing two on the same answers", () => {
  it("a predictor that always says the answer beats the climatology, inside its interval", () => {
    const as = Array.from({ length: 40 }, (_, i) => (i * 3) % STEPS);
    const s = prequential(cases(as), [plainLevelPredictor, climatologyPredictor]);
    const c = compareScores(s, climatologyPredictor.id, plainLevelPredictor.id);
    expect(c.n).toBe(40);
    expect(c.days).toBe(20);
    expect(c.rpsB).toBe(0);
    expect(c.diff).toBeLessThan(0);
    expect(c.interval![1]).toBeLessThan(0);
    expect(c.interval![0]).toBeLessThanOrEqual(c.diff);
  });

  it("gives the same interval every time (a fixed seed)", () => {
    const as = Array.from({ length: 30 }, (_, i) => (i * 5) % STEPS);
    const s = prequential(cases(as, as.map((a) => Math.min(6, a + 1))), [plainLevelPredictor, climatologyPredictor]);
    expect(compareScores(s, climatologyPredictor.id, plainLevelPredictor.id)).toEqual(compareScores(s, climatologyPredictor.id, plainLevelPredictor.id));
  });

  it("with a single day there is no interval", () => {
    const s = prequential(cases([1, 2]), [plainLevelPredictor, climatologyPredictor]);
    expect(compareScores(s, climatologyPredictor.id, plainLevelPredictor.id).interval).toBeNull();
  });
});

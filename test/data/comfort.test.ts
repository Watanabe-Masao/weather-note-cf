import { describe, expect, it } from "vitest";
import { beyondRange, fitComfort, interval, type Observation, predictComfort, priorFrom, probabilities, stateOf } from "../../src/beta/comfort";

const T: [number, number, number, number] = [10, 15, 21, 25];

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
}

/** Answers drawn from a known model: the centre follows A, the range widens with the week's spread. */
function simulate(n: number, truth: number[], seed = 3): Observation[] {
  const u = rng(seed);
  const out: Observation[] = [];
  for (let i = 0; i < n; i++) {
    const a = 8 + 18 * u();
    const v7 = 0.5 + 4 * u();
    const x = { a, h7: 55 + 20 * u(), v7, hNow: 50 + 30 * u() };
    const st = stateOf(truth, x);
    const e = st.mu + (u() - 0.5) * 24;
    const p = probabilities(st, e);
    let r = u();
    let y = -3;
    for (let k = 0; k < 7; k++) {
      r -= p[k];
      if (r <= 0) {
        y = k - 3;
        break;
      }
    }
    out.push({ ...x, e, y });
  }
  return out;
}

describe("β: the comfort centre and range", () => {
  it("starts from the person's own 肌感 boundaries", () => {
    const p = priorFrom(T);
    const st = stateOf(p.mean, { a: 15, h7: 65, v7: 2, hNow: 65 });
    expect(st.mu).toBe(18); // middle of 過ごしやすい
    expect(st.h).toBeCloseTo(3, 5); // half of it
    expect(st.g).toBeCloseTo(4.5, 5); // spacing of the outer boundaries
  });

  it("is flat inside the range and steps outside it (thresholds, not a line)", () => {
    const st = { mu: 18, h: 3, g: 4, s: 0.3 };
    const most = (e: number) => probabilities(st, e).indexOf(Math.max(...probabilities(st, e))) - 3;
    expect([16, 18, 20].map(most)).toEqual([0, 0, 0]);
    expect(most(23)).toBe(1);
    expect(most(27)).toBe(2);
    expect(most(9)).toBe(-2);
    expect(beyondRange(st, 20)).toBe(0);
    expect(beyondRange(st, 23)).toBe(2);
    expect(probabilities(st, 18).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("recovers a centre that moves with recent temperatures and a range that widens with an unsettled week", () => {
    const truth = [18, 0.45, 0, Math.log(2.5), 0.25, 0, Math.log(4), Math.log(0.8), 0, 0];
    const fit = fitComfort(simulate(400, truth), T, 0.8);
    const [m0, mA, , l0, lV] = fit.theta;
    expect(Math.abs(m0 - 18)).toBeLessThan(1);
    expect(Math.abs(mA - 0.45)).toBeLessThan(0.12);
    expect(Math.abs(Math.exp(l0) - 2.5)).toBeLessThan(0.8);
    expect(lV).toBeGreaterThan(0.1);
    const [lo, hi] = interval(fit, (t) => t[1]);
    expect(lo).toBeLessThan(0.45);
    expect(hi).toBeGreaterThan(0.45);
  });

  it("learns that a strong wind at the place feels colder than the station says", () => {
    const truth = [18, 0.33, 0, Math.log(3), 0, 0, Math.log(4.5), 0, -3, 0];
    const obs = simulate(300, truth, 5).map((o, i) => ({ ...o, windFelt: (i % 2 ? "strong" : "weak") as "strong" | "weak" }));
    // re-draw answers so the strong-wind half really is 3 ℃ colder
    const fit = fitComfort(
      obs.map((o) => {
        const st = stateOf(truth, o);
        const p = probabilities(st, o.e + (o.windFelt === "strong" ? -3 : 0));
        return { ...o, y: p.indexOf(Math.max(...p)) - 3 };
      }),
      T,
      0.8,
    );
    expect(fit.theta[8]).toBeLessThan(-1.5);
  });

  it("stays at the prior without reports, and predicts a distribution over the 7 answers", () => {
    const fit = fitComfort([], T, 0.8);
    const p = predictComfort(fit, { e: 18, a: 15, h7: 65, v7: 2, hNow: 65 }, 0);
    expect(p.mode).toBe(0);
    expect(p.probs).toHaveLength(7);
    expect(p.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    expect(p.state.mu).toBe(18);
  });
});

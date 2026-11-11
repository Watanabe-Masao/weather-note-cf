import { describe, expect, it } from "vitest";
import {
  beyondRange,
  type Drivers,
  fitEnsemble,
  fitModel,
  interval,
  MODELS,
  type Observation,
  placeTemp,
  predictComfort,
  priorFor,
  probabilities,
  stateOf,
} from "../../src/beta/comfort";

const T: [number, number, number, number, number, number] = [5, 10, 15, 21, 25, 29];
const model = (id: string) => MODELS.find((m) => m.id === id)!;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
}

const typical = (over: Partial<Drivers> = {}): Drivers => ({ e: 18, a: 15, dT1: 0, h7: 65, h1: 65, hNow: 65, v7: 2, sun1: 5, sun7: 5, rain1: null, rain7: null, sky: null, trend: 0, doy: null, radDay: null, night: null, wind6h: 2, minPrev: -6, windPrev: 2, ...over });

/** Answers drawn from a "true" model over varied days. */
function simulate(n: number, truthModel: string, truth: number[], seed = 3): Observation[] {
  const u = rng(seed);
  const m = model(truthModel);
  const out: Observation[] = [];
  for (let i = 0; i < n; i++) {
    const x = typical({
      a: 8 + 18 * u(),
      dT1: (u() - 0.5) * 8,
      h7: 50 + 30 * u(),
      h1: 45 + 40 * u(),
      hNow: 45 + 40 * u(),
      v7: 0.5 + 4 * u(),
      sun1: 9 * u(),
      sun7: 2 + 6 * u(),
      rain1: u() < 0.3 ? 20 * u() : 0,
      rain7: 6 * u(),
      sky: u() < 0.5,
      trend: (u() - 0.5) * 6,
      doy: 1 + Math.floor(365 * u()),
      radDay: 20 * u(),
      night: u() < 0.4,
      wind6h: 6 * u(),
      minPrev: -12 + 10 * u(),
      windPrev: 6 * u(),
    });
    const st = stateOf(m, truth, x);
    x.e = st.mu + (u() - 0.5) * 24;
    const p = probabilities(st, placeTemp(m, truth, x));
    let r = u();
    let y = 3;
    for (let k = 0; k < 7; k++) {
      r -= p[k];
      if (r <= 0) {
        y = k - 3;
        break;
      }
    }
    out.push({ ...x, y });
  }
  return out;
}

describe("β: the comfort centre and range", { timeout: 60_000 }, () => {
  it("starts every model from the person's own 肌感 boundaries", () => {
    for (const m of MODELS) {
      const st = stateOf(m, priorFor(m, T).mean, typical());
      expect(st.mu).toBe(18);
      expect(st.h).toBeCloseTo(3, 5);
      expect(st.g).toBeCloseTo(4.5, 5);
    }
  });

  it("is flat inside the range and steps outside it (thresholds, not a line)", () => {
    const st = { mu: 18, h: 3, g: 4, s: 0.3 };
    const most = (e: number) => probabilities(st, e).indexOf(Math.max(...probabilities(st, e))) - 3;
    expect([16, 18, 20].map(most)).toEqual([0, 0, 0]);
    expect([23, 27, 9].map(most)).toEqual([1, 2, -2]);
    expect(beyondRange(st, 20)).toBe(0);
    expect(beyondRange(st, 23)).toBe(2);
  });

  it("finds that yesterday's sudden change moves the centre, and weighs the models that know it", () => {
    // Truth (M3 shape): centre follows 最近の基準 and yesterday's change; the range narrows after a wet day.
    const m3 = model("M3");
    const truth = [18, 0.35, 0.5, 0, 0, 0, Math.log(2.5), 0.1, -0.15, Math.log(4), Math.log(0.7), 0, 0];
    expect(truth).toHaveLength(m3.mu.length + m3.h.length + 6);
    const obs = simulate(400, "M3", truth);
    const ens = fitEnsemble(obs, T, 0.8);
    const w = Object.fromEntries(ens.fits.map((f, i) => [f.model.id, ens.weights[i]]));
    expect(w.M3 + w.M5).toBeGreaterThan(0.9); // models with yesterday's change win
    expect(w.M0).toBeLessThan(0.01);
    const fit3 = ens.fits.find((f) => f.model.id === "M3")!;
    const [lo, hi] = interval(fit3, (t) => t[2]); // 中心:dT1
    expect(lo).toBeGreaterThan(0.2);
    expect(hi).toBeLessThan(0.8);
  });

  it("tells spring's 15 ℃ from autumn's: after a warm spell the centre is higher, so the same 15 ℃ feels cooler", () => {
    // Truth (M4 shape): the centre follows 最近の基準 and the season's direction.
    const m4 = MODELS.find((m) => m.id === "M4")!;
    const truth = [18, 0.4, 0.4, Math.log(3), 0, 0, Math.log(4.5), Math.log(0.7), 0, 0];
    expect(truth).toHaveLength(m4.mu.length + m4.h.length + 6);
    const ens = fitEnsemble(simulate(400, "M4", truth, 11), T, 0.8);
    const spring = typical({ e: 15, a: 11, trend: 1.5, doy: 90 }); // after winter, warming
    const autumn = typical({ e: 15, a: 21, trend: -1.5, doy: 290 }); // after summer, cooling
    const ps = predictComfort(ens, spring, 0);
    const pa = predictComfort(ens, autumn, 0);
    expect(ps.state.mu).toBeLessThan(pa.state.mu - 2); // truth: 17.0 vs 19.8
    expect(ps.expected).toBeGreaterThan(pa.expected);
    const w = Object.fromEntries(ens.fits.map((f, i) => [f.model.id, ens.weights[i]]));
    expect(w.M4 + w.M5).toBeGreaterThan(w.M6); // the history explains it; the calendar adds nothing
  });

  it("finds that a sunny day keeps the night warmer (the place, not the centre)", () => {
    const m7 = MODELS.find((m) => m.id === "M7")!;
    // +1.2 ℃ at the place per 5 MJ/m² of the day's sun, at night only; 2 m/s more wind takes 0.6 of it away.
    const truth = [18, 0.33, 0, Math.log(3), 0, 1.2, -0.6, Math.log(4.5), Math.log(0.7), 0, 0];
    expect(truth).toHaveLength(m7.mu.length + m7.h.length + (m7.e ?? []).length + 6);
    const ens = fitEnsemble(simulate(400, "M7", truth, 17), T, 0.8);
    const fit7 = ens.fits.find((f) => f.model.id === "M7")!;
    const [lo, hi] = interval(fit7, (t) => t[5]);
    expect(lo).toBeGreaterThan(0.5);
    expect(hi).toBeLessThan(2);
    const w = Object.fromEntries(ens.fits.map((f, i) => [f.model.id, ens.weights[i]]));
    expect(w.M7 + w.M8 + w.M5).toBeGreaterThan(0.9);
    const [wlo, whi] = interval(fit7, (t) => t[6]); // 余熱 × 夜の風
    expect(whi).toBeLessThan(0); // wind carries the warmth off
    expect(wlo).toBeGreaterThan(-1.5);
    // The same 12 ℃ night after a bright day reads warmer than after a dull one.
    const bright = predictComfort(ens, typical({ e: 12, night: true, radDay: 20, wind6h: 1 }), 0);
    const dull = predictComfort(ens, typical({ e: 12, night: true, radDay: 2, wind6h: 1 }), 0);
    const brightWindy = predictComfort(ens, typical({ e: 12, night: true, radDay: 20, wind6h: 7 }), 0);
    expect(bright.expected).toBeGreaterThan(dull.expected);
    expect(bright.expected).toBeGreaterThan(brightWindy.expected);
  });

  it("prefers the simple model when nothing but the place temperature matters", () => {
    const truth = [18, Math.log(3), Math.log(4.5), 0, 0, 0];
    const ens = fitEnsemble(simulate(300, "M0", truth, 9), T, 0.8);
    const w = Object.fromEntries(ens.fits.map((f, i) => [f.model.id, ens.weights[i]]));
    expect(w.M4).toBeLessThan(w.M0 + w.M1);
  });

  it("learns that a strong wind at the place feels colder than the station says", () => {
    const m0 = model("M0");
    const truth = [18, Math.log(3), Math.log(4.5), 0, -3, 0];
    const obs = simulate(300, "M0", [18, Math.log(3), Math.log(4.5), 0, 0, 0], 5).map((o, i) => {
      const windFelt = (i % 2 ? "strong" : "weak") as "strong" | "weak";
      const p = probabilities(stateOf(m0, truth, o), o.e + (windFelt === "strong" ? -3 : 0));
      return { ...o, windFelt, y: p.indexOf(Math.max(...p)) - 3 };
    });
    expect(fitModel(m0, obs, T).theta.at(-2)!).toBeLessThan(-1.5);
  });

  it("predicts a mixture over the models, keeping each model's own prediction", () => {
    const ens = fitEnsemble([], T, 0.8);
    const p = predictComfort(ens, typical(), 0);
    expect(p.mode).toBe(0);
    expect(p.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    expect(p.models.map((m) => m.id)).toEqual(MODELS.map((m) => m.id));
    expect(p.models.every((m) => Math.abs(m.weight - 1 / MODELS.length) < 0.01)).toBe(true); // no reports: equal
  });
});

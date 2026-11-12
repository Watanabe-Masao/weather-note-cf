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
  PRIOR,
  ADAPT_HI,
  ADAPT_LO,
  DRIVERS,
  missingDrivers,
  confoundedPairs,
  probabilities,
  stateOf,
  centreUnknown,
  learningFrom,
  LEARNING_RULES,
  MODEL_VERSION,
  referenceProbs,
  rps,
} from "../../src/beta/comfort";

const model = (id: string) => MODELS.find((m) => m.id === id)!;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
}

const typical = (over: Partial<Drivers> = {}): Drivers => ({ e: 18, a: 15, dT1: 0, h7: 65, h1: 65, hNow: 65, v7: 2, sun1: 5, sun7: 5, rain1: null, rain7: null, sky: null, trend: 0, doy: null, radDay: null, night: null, wind6h: 2, minPrev: -6, windPrev: 2, ...over, storedRad: over.storedRad ?? over.radDay ?? null, sinceSunset: over.sinceSunset ?? 2 }); // the night's stored sun = the day's (comfort-6)

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
  it("starts every model from fixed values, not from the 肌感 display boundaries", () => {
    for (const m of MODELS) {
      const st = stateOf(m, priorFor(m).mean, typical());
      expect(st.mu).toBe(PRIOR.m0);
      expect(st.h).toBeCloseTo(PRIOR.h, 5);
      expect(st.g).toBeCloseTo(PRIOR.g, 5);
    }
    // priorFor takes no settings at all: a display boundary cannot reach it.
    expect(priorFor.length).toBe(1);
  });

  it("lets adaptation stop outside 10–30 ℃ in the limited model, and not in the straight one", () => {
    const lim = MODELS.find((m) => m.id === "M9")!;
    const lin = MODELS.find((m) => m.id === "M1")!;
    const centre = (m: (typeof MODELS)[number], a: number) => stateOf(m, priorFor(m).mean, { ...typical(), a }).mu;
    expect(centre(lim, 35)).toBeCloseTo(centre(lim, ADAPT_HI), 5);
    expect(centre(lim, 2)).toBeCloseTo(centre(lim, ADAPT_LO), 5);
    expect(centre(lim, 20)).toBeCloseTo(centre(lin, 20), 5);
    expect(centre(lin, 35)).toBeGreaterThan(centre(lin, ADAPT_HI));
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
    const ens = fitEnsemble(obs, 0.8);
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
    const ens = fitEnsemble(simulate(400, "M4", truth, 11), 0.8);
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
    const ens = fitEnsemble(simulate(400, "M7", truth, 17), 0.8);
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
    const ens = fitEnsemble(simulate(300, "M0", truth, 9), 0.8);
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
    expect(fitModel(m0, obs).theta.at(-2)!).toBeLessThan(-1.5);
  });

  it("predicts a mixture over the models, keeping each model's own prediction", () => {
    const ens = fitEnsemble([], 0.8);
    const p = predictComfort(ens, typical({ rain1: 0, rain7: 0, sky: true, doy: 100, radDay: 10, night: false, minPrev: -6, windPrev: 2 }), 0);
    expect(p.mode).toBe(0);
    expect(p.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    expect(p.models.map((m) => m.id)).toEqual(MODELS.map((m) => m.id));
    expect(p.models.every((m) => Math.abs(m.weight - 1 / MODELS.length) < 0.01)).toBe(true); // no reports: equal
  });
});

describe("β: what a prediction means (position, answers' spread, the model's uncertainty)", { timeout: 60_000 }, () => {
  const M0truth = (h = 3, s = 0.7) => [18, Math.log(h), Math.log(4), Math.log(s), 0, 0];

  it("with no reports, is wide by itself (the starting values are unsure), and says it is untrained", () => {
    const ens = fitEnsemble([], 0.8);
    const p = predictComfort(ens, typical({ e: 18 }), 0, "untrained");
    expect(Math.max(...p.probs)).toBeLessThan(0.6); // no confident answer from starting values
    expect(p.spread!.param).toBeGreaterThan(0.5);
    expect(p.learning).toBe("untrained");
    expect(p.version).toBe(MODEL_VERSION);
    expect(learningFrom([], 0, [], ens).state).toBe("untrained");
  });

  it("tells a cold-leaning ちょうどよい from a central one: the same 寒い answer is judged differently", () => {
    const ens = fitEnsemble(simulate(300, "M0", M0truth(), 21), 0.8);
    const mu = predictComfort(ens, typical(), 0).state.mu;
    const centre = predictComfort(ens, typical({ e: mu }), 0);
    const coldSide = predictComfort(ens, typical({ e: mu - 2.4 }), 0);
    expect(centre.mode).toBe(0);
    expect(coldSide.mode).toBe(0); // both say ちょうどよい …
    expect(coldSide.z!).toBeLessThan(-0.5); // … but one sits at the cold side of the range
    expect(Math.abs(centre.z!)).toBeLessThan(0.3);
    expect(coldSide.sides!.cold).toBeGreaterThan(centre.sides!.cold);
    // An answer of 涼しい (−1) costs less where it was more expected.
    expect(rps(coldSide.probs, -1)).toBeLessThan(rps(centre.probs, -1));
    expect(-Math.log(coldSide.probs[2])).toBeLessThan(-Math.log(centre.probs[2]));
  });

  it("keeps the answers' own spread apart from the uncertainty of the parameters", () => {
    // Many reports from a person whose answers scatter a lot: the spread is in the answers.
    const scattered = predictComfort(fitEnsemble(simulate(400, "M0", M0truth(3, 2.5), 5), 0.8), typical({ e: 18 }), 0);
    // A few reports from a steady person: what is unsure is the model.
    const few = predictComfort(fitEnsemble(simulate(8, "M0", M0truth(3, 0.4), 5), 0.8), typical({ e: 18 }), 0);
    expect(scattered.spread!.answer).toBeGreaterThan(scattered.spread!.param * 2);
    expect(few.spread!.param).toBeGreaterThan(scattered.spread!.param);
  });

  it("does not claim a centre from one-sided, narrow or single-day answers", () => {
    const ens = fitEnsemble([], 0.8);
    const obs = simulate(40, "M0", M0truth(), 4);
    const coldOnly = obs.map((o) => ({ ...o, y: Math.min(o.y, -1) }));
    const sparse = learningFrom(coldOnly, 10, [], ens);
    expect(sparse.state).toBe("sparse");
    expect(sparse.missing.join()).toContain("両方");
    const narrow = obs.map((o, i) => ({ ...o, e: 18 + (i % 3) }));
    expect(learningFrom(narrow, 10, [], ens).missing.join()).toContain("温度の幅");
    expect(learningFrom(obs, 1, [], ens).missing.join()).toContain("記録した日");
    expect(centreUnknown("sparse")).toBe(true);
    expect(centreUnknown("provisional")).toBe(false);
  });

  it("moves from provisional to testable as the interval of the centre narrows, and to verified only by beating the reference", () => {
    const fewObs = simulate(6, "M0", M0truth(), 8); // both sides, but too few to pin the centre
    const manyObs = simulate(300, "M0", M0truth(), 8);
    expect(learningFrom(fewObs, 10, [], fitEnsemble(fewObs, 0.8)).state).toBe("provisional");
    const many = fitEnsemble(manyObs, 0.8);
    expect(learningFrom(manyObs, 30, [], many).state).toBe("testable");
    // Predictions made while testable: good ones verify, poor ones do not.
    const good = Array.from({ length: LEARNING_RULES.minChecked }, (_, i) => ({ probs: [0, 0, 0.05, 0.9, 0.05, 0, 0], y: 0, earlier: Array(i).fill(i % 2 ? -2 : 2) }));
    const poor = good.map((c) => ({ ...c, probs: [0.9, 0.05, 0.05, 0, 0, 0, 0] }));
    expect(learningFrom(manyObs, 30, good, many).state).toBe("verified");
    expect(learningFrom(manyObs, 30, poor, many).state).toBe("testable");
  });
});

describe("β: scores", () => {
  it("RPS is 0 for a sure right answer and grows with the distance of the miss", () => {
    const sure = (k: number) => Array.from({ length: 7 }, (_, i) => (i === k + 3 ? 1 : 0));
    expect(rps(sure(0), 0)).toBe(0);
    expect(rps(sure(0), -1)).toBeLessThan(rps(sure(0), -3));
    expect(rps(sure(1), 0)).toBeCloseTo(rps(sure(-1), 0), 10);
  });

  it("the reference is the person's earlier answers, smoothed", () => {
    const p = referenceProbs([0, 0, 1]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(p[3]).toBeGreaterThan(p[4]);
    expect(p[4]).toBeGreaterThan(p[0]);
  });
});

describe("β: missing inputs (MATH-03)", { timeout: 60_000 }, () => {
  const full = (over: Partial<Drivers> = {}) => typical({ rain1: 0, rain7: 0, sky: true, doy: 100, radDay: 10, night: false, minPrev: -6, windPrev: 2, ...over });

  it("never reads a missing input as a typical one: the models that need it take no part", () => {
    const ens = fitEnsemble([], 0.8);
    const p = predictComfort(ens, full({ hNow: null }), 0);
    expect(p.excluded).toEqual(expect.arrayContaining(["M2", "M5"])); // they use 今の湿度
    expect(p.missing).toContain("hNow");
    expect(p.models.map((m) => m.id)).not.toContain("M2");
    expect(p.models.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 1); // the rest re-weighted
    expect(missingDrivers(MODELS.find((m) => m.id === "M0")!, full({ hNow: null, trend: null }))).toEqual([]); // M0 always usable
  });

  it("a value that does not apply (the night's warmth by day) is 0, not missing", () => {
    expect(DRIVERS.radNight.value(full({ night: false, radDay: null }))).toBe(0);
    expect(DRIVERS.radNight.value(full({ night: true, radDay: null }))).toBeNull();
    expect(DRIVERS.radNight.value(full({ night: null }))).toBeNull();
  });

  it("fits each model on the observations with all of its inputs, and weighs them on the common ones", () => {
    const M0truth = [18, Math.log(3), Math.log(4), Math.log(0.7), 0, 0];
    const obs = simulate(120, "M0", M0truth, 31).map((o, i) => (i % 3 === 0 ? { ...o, trend: null } : o));
    const ens = fitEnsemble(obs, 0.8);
    const n = (id: string) => ens.fits.find((f) => f.model.id === id)!.n;
    expect(n("M0")).toBe(120);
    expect(n("M4")).toBe(80); // 季節の向き is missing in a third
    expect(ens.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("β: effects the reports cannot tell apart (#35)", { timeout: 60_000 }, () => {
  it("flags two inputs that always move together, and not independent ones", () => {
    const m2 = MODELS.find((m) => m.id === "M2")!;
    const truth = [18, 0.33, 0, Math.log(3), 0, 0, Math.log(4), Math.log(0.7), 0, 0];
    const base = simulate(150, "M2", truth, 41);
    const linked = base.map((o) => ({ ...o, h7: 65 + 2.5 * (o.a - 17) + ((o.e * 7) % 1) * 0.6 }));
    const pair = confoundedPairs(fitModel(m2, linked)).find(([p, q]) => [p, q].includes("中心:a") && [p, q].includes("中心:h7"));
    expect(pair).toBeDefined();
    expect(confoundedPairs(fitModel(m2, base)).find(([p, q]) => [p, q].includes("中心:a") && [p, q].includes("中心:h7"))).toBeUndefined();
  });
});

describe("#62: reports in a row and time bands", () => {
  it("weighs a run of k reports as k / (1 + (k − 1)·0.5), leaving single reports at 1", async () => {
    const { burstWeights } = await import("../../src/beta/comfort");
    const H = 3_600_000;
    // A run of 3 (15 min apart), a gap, a single, a run of 2 exactly under 2 h apart, a report 2 h later (new run).
    const w = burstWeights([0, 0.25 * H, 0.5 * H, 10 * H, 30 * H, 31.99 * H, 33.99 * H]);
    expect(w.map((v) => Math.round(v * 1000) / 1000)).toEqual([0.5, 0.5, 0.5, 1, 0.667, 0.667, 1]);
    // Order does not matter.
    expect(burstWeights([0.5 * H, 0, 0.25 * H])).toEqual([0.5, 0.5, 0.5]);
  });

  it("puts moments in bands by the sun (Kochi, 12 November: dawn 6:07, 8:26, 15:14, dusk 17:32)", async () => {
    const { bandOf } = await import("../../src/beta/comfort");
    expect(bandOf("2026-11-11T22:15:00Z", "47893")).toBe("morning"); // 07:15 JST
    expect(bandOf("2026-11-12T00:15:00Z", "47893")).toBe("day"); // 09:15 (日中)
    expect(bandOf("2026-11-12T03:15:00Z", "47893")).toBe("day"); // 12:15 (昼)
    expect(bandOf("2026-11-12T06:30:00Z", "47893")).toBe("evening"); // 15:30
    expect(bandOf("2026-11-12T08:45:00Z", "47893")).toBe("night"); // 17:45, after dusk
    expect(bandOf("2026-11-11T19:59:00Z", "47893")).toBe("night"); // 04:59, before dawn
    // June: 18:30 is still 夕方, 5:00 already 朝.
    expect(bandOf("2026-06-21T09:30:00Z", "47893")).toBe("evening");
    expect(bandOf("2026-06-20T20:00:00Z", "47893")).toBe("morning");
  });
});

describe("review 2026-11-12: bands and days", () => {
  it("counts a run of reports as the moment it is, and days in JST", async () => {
    const { bandCounts, ensembleFromReports, learningOf } = await import("../../src/beta/comfort");
    const { makeReport } = await import("../../research/data/fixture");
    const at = (iso: string) => ({ ...makeReport(iso, 18, 20, 0), at: new Date(Date.parse(iso)).toISOString(), snapshot: { ...makeReport(iso, 18, 20, 0).snapshot!, date: iso.slice(0, 10), hour: 18 } });
    // 18:00, 18:05, 18:10 JST: one moment (3 × 0.5 = 1.5), not three reports — and 夜 in
    // November (dusk 17:32 in Kochi), where the clock called it 夕方.
    const run = ["2026-11-12T18:00:00+09:00", "2026-11-12T18:05:00+09:00", "2026-11-12T18:10:00+09:00"].map(at);
    expect(bandCounts(run).night).toBe(1.5);
    expect(bandCounts(run).evening).toBe(0);
    // 07:00 and 10:00 JST are one Japanese day (UTC would see 11/11 and 11/12).
    const morning = ["2026-11-12T07:00:00+09:00", "2026-11-12T10:00:00+09:00"].map((iso) => ({ ...at(iso), snapshot: { ...at(iso).snapshot!, hour: Number(iso.slice(11, 13)) } }));
    const l = learningOf(morning, ensembleFromReports(morning));
    expect(l.missing.join()).toContain("今 1日");
  });
});

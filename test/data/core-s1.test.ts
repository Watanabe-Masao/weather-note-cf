// S1: the intercept moved by the short history, learned one step ahead. On made-up answers drawn
// from a known rule, S1 must find the short history when it is there (and beat the learned model
// without it), and must not find it when it is not.

import { describe, expect, it } from "vitest";
import { DEFAULT_FEEL } from "../../shared/feel";
import { stationLatLon } from "../../shared/sunTimes";
import { type Case, caseInputs, compareScores, type MaterialDay, type MaterialHour, plainLevelPredictor, prequential, STEPS } from "../../src/core";
import { climatologyPredictor, ordinalPredictor, type OrdinalInputs } from "../../src/core/learned";

const T = DEFAULT_FEEL.thresholds;
const base = ordinalPredictor({ id: "learned.ordinal.base", thresholds: T, useShort: false });
const s1 = ordinalPredictor({ id: "learned.ordinal.s1", thresholds: T, useShort: true });

/** A seeded generator, so the made-up answers are the same every run. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const v = (value: number) => ({ value, trace: [] });

/** Answers drawn from: boundaries moved by `a0 + a1·(F − S)`, spread `s`. */
function world(n: number, a1: number, seed: number): Case<OrdinalInputs & { level: ReturnType<typeof v> }>[] {
  const r = rng(seed);
  const a0 = 1, s = 1.5;
  return Array.from({ length: n }, (_, i) => {
    const feel = 4 + 26 * r();
    const short = feel - 8 * (r() - 0.5);
    const delta = a0 + a1 * (feel - short);
    const u = r();
    let answer = 0;
    for (const b of T) if (u > 1 / (1 + Math.exp(-(b + delta - feel) / s))) answer++;
    const level = T.filter((b) => feel >= b).length;
    return { id: `c${i}`, at: i * 8 * 3_600_000, date: new Date(i * 8 * 3_600_000).toISOString().slice(0, 10), answer, inputs: { feel: v(feel), shift: v(0), short: v(short), level: v(level) } };
  });
}

describe("S1 one step ahead", () => {
  it("finds the short history when the answers have it, and beats the model without it", () => {
    const scored = prequential(world(160, 0.6, 7), [plainLevelPredictor, climatologyPredictor, base, s1]);
    const vsBase = compareScores(scored, base.id, s1.id);
    expect(vsBase.diff).toBeLessThan(0);
    expect(vsBase.interval![1]).toBeLessThan(0);
    // and the learned ones beat answering by the answers' shares alone
    expect(compareScores(scored, climatologyPredictor.id, s1.id).diff).toBeLessThan(0);
  });

  it("does not find it when the answers do not have it", () => {
    const scored = prequential(world(160, 0, 11), [base, s1]);
    const vsBase = compareScores(scored, base.id, s1.id);
    // Not better: its interval reaches above 0 (an extra number it does not need costs a little).
    expect(vsBase.interval![1]).toBeGreaterThan(0);
  });

  it("with few answers it keeps the plain boundaries (the prior), with a spread", () => {
    const [first] = prequential(world(1, 0.6, 3), [s1]);
    const f = first.by[s1.id]!.forecast;
    expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(Math.max(...f)).toBeLessThan(1);
    expect(f).toHaveLength(STEPS);
  });

  it("without S, S1 says nothing (left out), the base model still does", () => {
    const c = world(1, 0, 5)[0];
    const none = { ...c, inputs: { ...c.inputs, short: { absent: "tooShort" as const, input: "hourFeels", shortage: { have: 0, need: 1, of: "1時間前" }, trace: [] } } };
    const [s] = prequential([none], [base, s1]);
    expect(s.by[s1.id]).toBeNull();
    expect(s.by[base.id]).not.toBeNull();
  });
});

describe("an answer's inputs from the materials", () => {
  const KOCHI = stationLatLon("47893")!;
  const site = { anemometerHeight: 10, lat: KOCHI.lat, lon: KOCHI.lon };
  const settings = { alpha: DEFAULT_FEEL.alpha, absorb: DEFAULT_FEEL.absorb };
  const hours: MaterialHour[] = Array.from({ length: 30 }, (_, i) => ({
    station: "47893",
    date: i < 24 ? "2026-11-14" : "2026-11-15",
    hour: (i % 24) + 1,
    kind: "record",
    provider: "JMA",
    provisional: false,
    values: { temp: 12, humidity: 60, wind: 2, rain: 0, sunshine: 0, pressure: 1013 },
    absent: {},
    rough: [],
  }));
  const days: MaterialDay[] = Array.from({ length: 30 }, () => ({
    station: "47893",
    date: "2026-11-01",
    kind: "record",
    provider: "JMA",
    provisional: false,
    values: { temp: 15, max: null, min: null, humidity: null, wind: null, windMax: null, gust: null, rain: null, sunshine: null, pressure: null },
    absent: {},
    rough: [],
  }));

  it("日かげ: 肌感, shift, S, rate and the plain step, all there", () => {
    const x = caseInputs(hours, 28, days, "shade", site, settings, T);
    for (const k of ["feel", "shift", "short", "rate", "level"] as const) expect("value" in x[k], k).toBe(true);
    expect("value" in x.shift && x.shift.value).toBeCloseTo(0, 9); // a 30-day mean of 15 is the reference
  });

  it("半々 has no 肌感 of its own: nothing to predict from", () => {
    const x = caseInputs(hours, 28, days, "mixed", site, settings, T);
    expect(x.feel).toMatchObject({ absent: "missingInput", inputs: { place: "mixed" } });
    expect("value" in x.shift).toBe(true);
  });
});

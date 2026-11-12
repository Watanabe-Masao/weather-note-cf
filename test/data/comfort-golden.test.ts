// #43: the comfort model's behaviour, fixed. Before the engine is split up (#44), every number it
// gives for a fixed input is written down here; a change that moves any of them beyond its
// tolerance fails, so the model never changes by accident.
//
// The expected values are in comfort-golden.json. After an intended change of the model, write them
// again with   UPDATE_GOLDEN=1 npx vitest run test/data/comfort-golden.test.ts
// and say why in the PR and in the contract's change log (research/comfort-model/mathematical-contract.md).
//
// Tolerances (absolute), by kind of value (#43):
//   probabilities 1e-6 · temperatures and z 1e-4 · parameters θ̂ 1e-3 · log evidence 1e-3 ·
//   model weights 1e-4 · intervals from the 200 draws 1e-3 · states, model lists, CSV columns exact

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Drivers, fitEnsemble, learningFrom, MODEL_VERSION, type Observation, predictComfort, weightsAt } from "../../src/beta/comfort";
import { toCsv } from "../../src/beta/reports";

const FILE = new URL("./comfort-golden.json", import.meta.url);
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/** A fixed, varied set of moments and answers (no randomness beyond this seed). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function moment(u: () => number, i: number): Drivers {
  const doy = 1 + Math.floor(365 * u());
  const a = 17 + 8 * Math.cos((2 * Math.PI * (doy - 210)) / 365);
  return {
    e: a + (u() - 0.45) * 16,
    a,
    dT1: (u() - 0.5) * 4,
    h7: 55 + 25 * u(),
    h1: 50 + 35 * u(),
    hNow: i % 7 === 3 ? null : 45 + 40 * u(), // some inputs missing, on purpose
    v7: 1 + 3 * u(),
    sun1: 9 * u(),
    sun7: 3 + 5 * u(),
    rain1: u() < 0.3 ? 15 * u() : 0,
    rain7: 5 * u(),
    sky: u() < 0.55,
    trend: i % 11 === 5 ? null : (u() - 0.5) * 4,
    doy,
    radDay: 18 * u(),
    night: u() < 0.3,
    wind6h: 5 * u(),
    minPrev: -10 + 8 * u(),
    windPrev: 5 * u(),
    windFelt: (["strong", "weak", "none"] as const)[Math.floor(u() * 3)],
  };
}

function dataset(): Observation[] {
  const u = rng(4343);
  return Array.from({ length: 60 }, (_, i) => {
    const x = moment(u, i);
    // Answers from a plain rule with noise: 0 near 20 ℃ (moving with the baseline), ±1 every 3 ℃.
    const z = (x.e - (20 + 0.33 * (x.a - 15))) / 3 + (u() - 0.5) * 1.2;
    return { ...x, y: Math.max(-3, Math.min(3, Math.round(z))) };
  });
}

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Everything the model says about the fixed input, rounded a little finer than its tolerance. */
function snapshot() {
  const obs = dataset();
  const ens = fitEnsemble(obs, 0.8);
  const u = rng(77);
  const moments: Record<string, Drivers> = {
    day: { ...moment(u, 0), e: 19, a: 15, night: false, windFelt: "weak" },
    night: { ...moment(u, 1), e: 12, a: 13, night: true, radDay: 15, wind6h: 1, windFelt: "none" },
    hot: { ...moment(u, 2), e: 31, a: 25, night: false, windFelt: "strong" },
    missing: { ...moment(u, 4), e: 16, a: 14, hNow: null, trend: null, night: false, windFelt: "weak" },
  };
  const predictions = Object.fromEntries(
    Object.entries(moments).map(([k, x]) => {
      const p = predictComfort(ens, x, Date.parse("2026-11-12T03:00:00Z"), "testable");
      return [
        k,
        {
          probs: p.probs,
          mode: p.mode,
          expected: p.expected,
          state: p.state,
          offset: p.offset,
          beyond: p.beyond,
          sides: p.sides,
          z: p.z,
          zInterval: p.zInterval,
          muInterval: p.muInterval,
          spread: p.spread,
          excluded: p.excluded ?? [],
          missing: p.missing ?? [],
          models: p.models.map((m) => ({ id: m.id, weight: m.weight, mode: m.mode, mu: m.mu, h: m.h, probs: m.probs })),
          weightsAt: weightsAt(ens, x).map((w) => r(w, 6)),
          version: p.version,
        },
      ];
    }),
  );
  const empty = predictComfort(fitEnsemble([], 0.8), moments.day, 0, "untrained");
  return {
    modelVersion: MODEL_VERSION,
    fits: ens.fits.map((f) => ({ id: f.model.id, n: f.n, theta: f.theta.map((t) => r(t, 5)), logEvidence: r(f.logEvidence, 5) })),
    weights: ens.weights.map((w) => r(w, 6)),
    predictions,
    empty: { probs: empty.probs, spread: empty.spread, muInterval: empty.muInterval },
    learning: {
      full: learningFrom(obs, 25, [], ens).state,
      oneDay: learningFrom(obs, 1, [], ens).state,
      coldOnly: learningFrom(
        obs.filter((o) => o.y < 0),
        25,
        [],
        ens,
      ).state,
      none: learningFrom([], 0, [], ens).state,
    },
    csvColumns: toCsv([]).replace(/^﻿/, "").split("\r\n")[0].split(","),
  };
}

type Snap = ReturnType<typeof snapshot>;

/** Compares numbers with `tol`, everything else exactly, and names the place of a difference. */
function close(actual: unknown, expected: unknown, tol: number, path: string) {
  if (typeof expected === "number" && typeof actual === "number") {
    expect(Math.abs(actual - expected), `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol + 1e-12);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, `${path}.length`).toBe(expected.length);
    expected.forEach((v, i) => close((actual as unknown[])[i], v, tol, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    for (const k of Object.keys(expected)) close((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], tol, `${path}.${k}`);
  } else {
    expect(actual, path).toEqual(expected);
  }
}

describe("#43: the comfort model's behaviour, fixed", { timeout: 120_000 }, () => {
  const now = snapshot();
  if (UPDATE || !existsSync(FILE)) writeFileSync(FILE, JSON.stringify(now, null, 1) + "\n");
  const golden = JSON.parse(readFileSync(FILE, "utf8")) as Snap;

  it("keeps the model version (raise it, and write the values again, when the model changes)", () => {
    expect(now.modelVersion).toBe(golden.modelVersion);
  });

  it("fits every model to the same parameters and evidence (θ̂ 1e-3, log evidence 1e-3)", () => {
    golden.fits.forEach((g, i) => {
      const a = now.fits[i];
      expect(a.id).toBe(g.id);
      expect(a.n, `${g.id}.n`).toBe(g.n);
      close(a.theta, g.theta, 1e-3, `${g.id}.theta`);
      close(a.logEvidence, g.logEvidence, 1e-3, `${g.id}.logEvidence`);
    });
  });

  it("weighs the models the same (1e-4)", () => {
    close(now.weights, golden.weights, 1e-4, "weights");
  });

  it("predicts the same at day, night, heat and with missing inputs", () => {
    for (const k of Object.keys(golden.predictions) as (keyof Snap["predictions"])[]) {
      const a = now.predictions[k];
      const g = golden.predictions[k];
      close(a.probs, g.probs, 1e-6, `${k}.probs`);
      close(a.sides, g.sides, 1e-6, `${k}.sides`);
      expect(a.mode, `${k}.mode`).toBe(g.mode);
      close(a.expected, g.expected, 1e-4, `${k}.expected`);
      close(a.state, g.state, 1e-4, `${k}.state`);
      close([a.offset, a.beyond, a.z], [g.offset, g.beyond, g.z], 1e-4, `${k}.place`);
      close([a.zInterval, a.muInterval], [g.zInterval, g.muInterval], 1e-3, `${k}.intervals`);
      close(a.spread, g.spread, 1e-3, `${k}.spread`);
      expect(a.excluded, `${k}.excluded`).toEqual(g.excluded);
      expect(a.missing, `${k}.missing`).toEqual(g.missing);
      expect(a.models.map((m) => m.id), `${k}.models`).toEqual(g.models.map((m) => m.id));
      a.models.forEach((m, j) => {
        close(m.weight, g.models[j].weight, 1e-4, `${k}.${m.id}.weight`);
        close(m.probs, g.models[j].probs, 1e-6, `${k}.${m.id}.probs`);
        close([m.mu, m.h], [g.models[j].mu, g.models[j].h], 1e-4, `${k}.${m.id}.state`);
      });
      close(a.weightsAt, g.weightsAt, 1e-4, `${k}.weightsAt`);
      expect(a.version).toBe(g.version);
    }
  });

  it("predicts the same with no reports (wide, from the starting values)", () => {
    close(now.empty.probs, golden.empty.probs, 1e-6, "empty.probs");
    close(now.empty.spread, golden.empty.spread, 1e-3, "empty.spread");
    close(now.empty.muInterval, golden.empty.muInterval, 1e-3, "empty.muInterval");
  });

  it("judges the learning states the same", () => {
    expect(now.learning).toEqual(golden.learning);
  });

  it("writes the same CSV columns in the same order", () => {
    expect(now.csvColumns).toEqual(golden.csvColumns);
  });

  it("is deterministic: the same input twice gives exactly the same output", () => {
    expect(JSON.stringify(snapshot())).toBe(JSON.stringify(now));
  });
});

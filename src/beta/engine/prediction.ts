// MATH-05: the predictive distribution and what a prediction means.
// Contract: research/comfort-model/mathematical-contract.md

import { type DriverKey, type Drivers } from "./drivers";
import { type Ensemble, weightsAt } from "./ensemble";
import { type ModelFit } from "./estimation";
import { beyondRange, missingDrivers, placeTemp, probabilities, type State, stateOf, type Theta, usable } from "./model";
import { r1, r2 } from "./util";

//
// A prediction says three different things, kept apart (they mean different things when it misses):
//   - where the moment sits in the person's range: z = (E′ − μ) / h (inside the range |z| ≤ 1);
//   - how the answers spread even when the model is right: the ordinal model's own spread;
//   - how unsure the model is about the person: the spread of its parameters (from the Laplace
//     approximation, or the starting values while there are no reports).
// The probabilities are the posterior predictive: averaged over parameter draws, so with few
// reports they are wide by themselves, instead of a sure answer made from the starting values.
//   Var(Y) = E_θ[Var(Y | θ)]  (answers)  +  Var_θ[E(Y | θ)]  (parameters)

/** Version of the prediction (stored with every report, so past predictions stay readable). */
export const MODEL_VERSION = "comfort-7"; // 7: answers on the new words only (SCALE_VERSION 4), the starting point = 従来版 (slope 0.7, outer step 4.5, 慣れ 5–30 ℃; #111); 6: 6: the stored sun at night is the latest daytime's, across midnight (#86); 5: night from sunset to sunrise, the sky in daylight only, runs end after 3 hours (#86); 4: reports in a row weigh less, time bands gate testable (#62); 3: missing inputs leave models out
/** Parameter draws per model. */
export const DRAWS = 200;

/** A small seeded generator: the same moment gives the same prediction (testable, repeatable). */
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
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

function choleskyOf(a: number[][]): number[][] | null {
  const n = a.length;
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 0)) return null;
        L[i][i] = Math.sqrt(sum);
      } else L[i][j] = sum / L[j][j];
    }
  return L;
}

/** Parameter draws of one fit: the Laplace posterior, or the starting values' spread without one. */
export function drawsOf(fit: ModelFit, n = DRAWS, seed = 1): Theta[] {
  const k = fit.theta.length;
  const cov = fit.cov ?? fit.prior.sd.map((sd, i) => fit.prior.sd.map((_, j) => (i === j ? sd * sd : 0)));
  const L = choleskyOf(cov) ?? choleskyOf(cov.map((row, i) => row.map((v, j) => (i === j ? v + 1e-6 : v))));
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const z = Array.from({ length: k }, () => gauss(r));
    return fit.theta.map((t, i) => t + (L ? L[i].reduce((sum, l, j) => sum + l * z[j], 0) : 0));
  });
}

export interface ModelPrediction {
  id: string;
  weight: number;
  probs: number[];
  mode: number;
  mu: number;
  h: number;
  /** Records the model learned from at that moment (0: still its prior). Absent in older reports. */
  n?: number;
}

export type Learning = "untrained" | "sparse" | "provisional" | "testable" | "verified";

export interface ComfortPrediction {
  /** Posterior predictive over the models and their parameters: P(answer −3…+3). */
  probs: number[];
  mode: number;
  expected: number;
  /** Weighted centre, half-range, outer step and blur (at the fitted values). */
  state: State;
  /** E′ − μ, and how far past the range's edge (0 inside). */
  offset: number;
  beyond: number;
  /** Each model's own prediction (kept so models can be compared on predictions made in advance). */
  models: ModelPrediction[];
  n: number;
  alpha: number;
  at: number;
  /** Cold side (−3…−1), ちょうどよい (0), warm side (+1…+3). */
  sides?: { cold: number; neutral: number; warm: number };
  /** Where the moment sits in the range, z = (E′ − μ)/h, with its 95% interval. */
  z?: number;
  zInterval?: [number, number];
  /** 95% interval of the centre μ. */
  muInterval?: [number, number];
  /** Spread of the answer in steps (SD): from the answers themselves, and from the parameters. */
  spread?: { answer: number; param: number };
  /** How far the learning had got when this was predicted. */
  learning?: Learning;
  /** Models left out because an input was missing at this moment, and those inputs. */
  excluded?: string[];
  missing?: DriverKey[];
  version?: string;
}


/** The weighted centre and range of a moment (no place temperature needed). */
export function ensembleState(ens: Ensemble, x: Drivers): State {
  const w = weightsAt(ens, x);
  const sts = ens.fits.map((f, i) => (w[i] > 0 ? stateOf(f.model, f.theta, x) : { mu: 0, h: 0, g: 0, s: 0 }));
  const mix = (k: keyof State) => sts.reduce((s, st, i) => s + w[i] * st[k], 0);
  return { mu: mix("mu"), h: mix("h"), g: mix("g"), s: mix("s") };
}

/** Weighted quantile of (value, weight) pairs. */
function quantile(pairs: [number, number][], q: number): number {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= q * total) return v;
  }
  return sorted[sorted.length - 1][0];
}

/** One model's draws at a moment: probabilities, E(Y), Var(Y), μ and z for each draw. */
function drawn(fit: ModelFit, x: Drivers, seed: number) {
  return drawsOf(fit, DRAWS, seed).map((t) => {
    const st = stateOf(fit.model, t, x);
    const e = placeTemp(fit.model, t, x);
    const p = probabilities(st, e);
    const ey = p.reduce((s, v, k) => s + v * (k - 3), 0);
    const vy = p.reduce((s, v, k) => s + v * (k - 3) ** 2, 0) - ey * ey;
    return { p, ey, vy, mu: st.mu, z: (e - st.mu) / st.h };
  });
}

/** The 95% interval of the centre μ at a moment, over the models and their parameters. */
export function muIntervalOf(ens: Ensemble, x: Drivers): [number, number] {
  const pairs: [number, number][] = [];
  const w = weightsAt(ens, x);
  ens.fits.forEach((f, i) => {
    if (w[i] < 1e-3) return;
    for (const d of drawsOf(f, DRAWS, 7 + i)) pairs.push([stateOf(f.model, d, x).mu, w[i]]);
  });
  return [quantile(pairs, 0.025), quantile(pairs, 0.975)];
}

export function predictComfort(ens: Ensemble, x: Drivers, at: number, learning?: Learning): ComfortPrediction {
  const seed = Math.floor(at / 60_000); // the same minute, the same draws
  let eySum = 0;
  let ey2Sum = 0;
  let vySum = 0;
  const muPairs: [number, number][] = [];
  const zPairs: [number, number][] = [];
  // Models with an input missing at this moment take no part (MATH-03); the rest are re-weighted.
  const weights = weightsAt(ens, x);
  const used = ens.fits.map((f, i) => ({ f, i })).filter(({ f }) => usable(f.model, x));
  const excluded = ens.fits.filter((f) => !usable(f.model, x)).map((f) => f.model.id);
  const missing = [...new Set(ens.fits.flatMap((f) => missingDrivers(f.model, x)))];
  const models = used.map(({ f, i }) => {
    const w = weights[i];
    const ds = drawn(f, x, seed + i);
    const probs = Array.from({ length: 7 }, (_, k) => ds.reduce((s, d) => s + d.p[k], 0) / ds.length);
    for (const d of ds) {
      eySum += (w * d.ey) / ds.length;
      ey2Sum += (w * d.ey * d.ey) / ds.length;
      vySum += (w * d.vy) / ds.length;
      muPairs.push([d.mu, w]);
      zPairs.push([d.z, w]);
    }
    const st = stateOf(f.model, f.theta, x);
    return { id: f.model.id, weight: r2(w), probs, mode: probs.indexOf(Math.max(...probs)) - 3, mu: r1(st.mu), h: r1(st.h), n: f.n, e: placeTemp(f.model, f.theta, x) };
  });
  const wOf = (j: number) => weights[used[j].i];
  const probs = Array.from({ length: 7 }, (_, k) => models.reduce((s, m, j) => s + wOf(j) * m.probs[k], 0));
  const st = ensembleState(ens, x);
  const e = models.reduce((s, m, j) => s + wOf(j) * m.e, 0);
  const sum = (a: number, b: number) => probs.slice(a, b).reduce((s, v) => s + v, 0);
  return {
    probs: probs.map(r2),
    mode: probs.indexOf(Math.max(...probs)) - 3,
    expected: r1(probs.reduce((s, p, k) => s + p * (k - 3), 0)),
    state: { mu: r1(st.mu), h: r1(st.h), g: r1(st.g), s: r2(st.s) },
    offset: r1(e - st.mu),
    beyond: r1(beyondRange(st, e)),
    models: models.map(({ e: _e, ...m }) => ({ ...m, probs: m.probs.map(r2) })),
    n: ens.n,
    alpha: ens.alpha,
    at,
    sides: { cold: r2(sum(0, 3)), neutral: r2(sum(3, 4)), warm: r2(sum(4, 7)) },
    z: r2((e - st.mu) / st.h),
    zInterval: [r2(quantile(zPairs, 0.025)), r2(quantile(zPairs, 0.975))],
    muInterval: [r1(quantile(muPairs, 0.025)), r1(quantile(muPairs, 0.975))],
    spread: { answer: r2(Math.sqrt(Math.max(0, vySum))), param: r2(Math.sqrt(Math.max(0, ey2Sum - eySum * eySum))) },
    ...(learning ? { learning } : {}),
    ...(excluded.length ? { excluded, missing } : {}),
    version: MODEL_VERSION,
  };
}

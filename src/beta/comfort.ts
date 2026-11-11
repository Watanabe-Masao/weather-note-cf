// β: the comfort centre and range of this moment, and where the place sits against them.
//
// The idea: a person feels "どちらでもない" within a range around a centre, and only past its
// edges does it turn cool or warm, step by step. Neither the centre nor the width is fixed: both
// move with what the person has been living in. Nothing here is linear in the end.
//
//   centre      μ = m0 + mA·(A − 15) + mH·(H7 − 65)/10          A: 最近の基準 (℃), H7: 7-day humidity (%)
//   half-range  h = exp(l0 + lV·(V7 − 2) + lH·(Hnow − 65)/10)   V7: spread of the 7 daily means (℃)
//   outer step  g = exp(q0)                                       one step further out per g ℃
//   blur        s = exp(r0)                                       how soft each edge is (℃)
//   felt wind   E' = E + wS·[風 強い] + wN·[風 なし]                the station's wind is in E already;
//                                                                 this is the place's own wind
//
// The 7 answers −3…+3 are cut at μ ± h, μ ± (h + g), μ ± (h + 2g) on the place's temperature E
// (日なた／日かげ温度, which carries wind, humidity and sun), each edge blurred by a logistic of width s:
//   P(Y ≤ k) = σ((c_k − (E − μ)) / s),  c = [−h−2g, −h−g, −h, h, h+g, h+2g]
//
// Priors come from the person's own 肌感 boundaries (no report needed): the centre is the middle of
// 過ごしやすい, h half its width, g the spacing of the outer boundaries; mA is centred on 0.33, the
// slope of EN 16798-1's adaptive comfort temperature against the running mean. Every other driver
// starts at 0, so it moves the centre or the width only when the reports show it.
// Fitted by maximum a posteriori (Nelder–Mead) with a Laplace approximation for the intervals.

import type { FeelSettings } from "../../shared/feel";
import { runningMean } from "./adaptation";
import type { Report } from "./reports";

export const PARAMS = ["m0", "mA", "mH", "l0", "lV", "lH", "q0", "r0", "wS", "wN"] as const;
export type Theta = number[]; // in PARAMS order

export interface Drivers {
  /** Place temperature (日なた／日かげ／半々) now. */
  e: number;
  /** 最近の基準 (℃). */
  a: number;
  /** Mean humidity of the 7 days before (%), null if unknown. */
  h7: number | null;
  /** Spread (standard deviation) of the 7 daily means before (℃), null if unknown. */
  v7: number | null;
  /** Humidity now (%). */
  hNow: number | null;
  /** The wind felt at the place (reports only; the day view has none). */
  windFelt?: "strong" | "weak" | "none" | null;
}

const A_REF = 15;
const H_REF = 65;
const V_REF = 2;

export interface Prior {
  mean: Theta;
  sd: Theta;
}

/** The prior, from the 肌感 boundaries t0 < t1 < t2 < t3. */
export function priorFrom(thresholds: FeelSettings["thresholds"]): Prior {
  const [t0, t1, t2, t3] = thresholds;
  const h = Math.max(0.5, (t2 - t1) / 2);
  const g = Math.max(1, ((t1 - t0) + (t3 - t2)) / 2);
  return {
    mean: [(t1 + t2) / 2, 0.33, 0, Math.log(h), 0, 0, Math.log(g), Math.log(1), 0, 0],
    sd: [3, 0.15, 0.6, 0.5, 0.15, 0.15, 0.5, 0.5, 1.5, 1.5],
  };
}

export interface State {
  mu: number;
  h: number;
  g: number;
  s: number;
}

const z = (v: number | null, ref: number, unit: number) => (v == null ? 0 : (v - ref) / unit);

export function stateOf(theta: Theta, x: Omit<Drivers, "e">): State {
  const [m0, mA, mH, l0, lV, lH, q0, r0] = theta;
  return {
    mu: m0 + mA * (x.a - A_REF) + mH * z(x.h7, H_REF, 10),
    h: Math.exp(l0 + lV * z(x.v7, V_REF, 1) + lH * z(x.hNow, H_REF, 10)),
    g: Math.exp(q0),
    s: Math.exp(r0),
  };
}

const sigma = (x: number) => 1 / (1 + Math.exp(-x));

/** Probability of each answer −3…+3 (7 numbers summing to 1). */
export function probabilities(st: State, e: number): number[] {
  const c = [-st.h - 2 * st.g, -st.h - st.g, -st.h, st.h, st.h + st.g, st.h + 2 * st.g];
  const cdf = [0, ...c.map((ck) => sigma((ck - (e - st.mu)) / st.s)), 1];
  return Array.from({ length: 7 }, (_, k) => Math.max(1e-9, cdf[k + 1] - cdf[k]));
}

/** The place temperature with the felt wind's shift (E'). */
export function placeTemp(theta: Theta, x: Drivers): number {
  return x.e + (x.windFelt === "strong" ? theta[8] : x.windFelt === "none" ? theta[9] : 0);
}

/** Where E sits: inside the range (0), or how far past its edge (℃, signed). */
export function beyondRange(st: State, e: number): number {
  const d = e - st.mu;
  return Math.abs(d) <= st.h ? 0 : Math.sign(d) * (Math.abs(d) - st.h);
}

// ---- fitting -----------------------------------------------------------------------------------

export interface Observation extends Drivers {
  y: number; // −3…+3
}

function negLogPosterior(theta: Theta, obs: Observation[], prior: Prior): number {
  let nlp = 0;
  for (let i = 0; i < theta.length; i++) nlp += ((theta[i] - prior.mean[i]) / prior.sd[i]) ** 2 / 2;
  for (const o of obs) nlp -= Math.log(probabilities(stateOf(theta, o), placeTemp(theta, o))[o.y + 3]);
  return nlp;
}

/** Nelder–Mead minimiser (small, dependency-free). */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iterations = 2000): number[] {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a.f - b.f);
    if (Math.abs(simplex[n].f - simplex[0].f) < 1e-9) break;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const at = (t: number) => centroid.map((c, j) => c + t * (simplex[n].x[j] - c));
    const r = { x: at(-1), f: 0 };
    r.f = f(r.x);
    if (r.f < simplex[0].f) {
      const e = { x: at(-2), f: 0 };
      e.f = f(e.x);
      simplex[n] = e.f < r.f ? e : r;
    } else if (r.f < simplex[n - 1].f) simplex[n] = r;
    else {
      const c = { x: at(r.f < simplex[n].f ? -0.5 : 0.5), f: 0 };
      c.f = f(c.x);
      if (c.f < Math.min(r.f, simplex[n].f)) simplex[n] = c;
      else simplex = simplex.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j])), f: 0 })).map((p, i) => (i === 0 ? p : { ...p, f: f(p.x) }));
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0].x;
}

/** Numerical Hessian, then its inverse (the Laplace covariance). Null if not positive definite. */
function covariance(f: (x: number[]) => number, x: number[]): number[][] | null {
  const n = x.length;
  const eps = 1e-3;
  const H = Array.from({ length: n }, () => Array(n).fill(0));
  const fx = f(x);
  for (let i = 0; i < n; i++)
    for (let j = i; j < n; j++) {
      const p = (di: number, dj: number) => f(x.map((v, k) => v + (k === i ? di : 0) + (k === j ? dj : 0)));
      const v = i === j ? (p(eps, 0) - 2 * fx + p(-eps, 0)) / eps ** 2 : (p(eps, eps) - p(eps, -eps) - p(-eps, eps) + p(-eps, -eps)) / (4 * eps ** 2);
      H[i][j] = H[j][i] = v;
    }
  // Gauss–Jordan inverse
  const M = H.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const inv = M.map((row) => row.slice(n));
  return inv.every((row, i) => row[i] > 0) ? inv : null;
}

export interface ComfortFit {
  theta: Theta;
  /** Laplace covariance of theta (null when it could not be formed: the prior's sd is then used). */
  cov: number[][] | null;
  prior: Prior;
  n: number;
  /** α (慣れの速さ) the 最近の基準 used, chosen by the fit when reports allow. */
  alpha: number;
}

export function fitComfort(obs: Observation[], thresholds: FeelSettings["thresholds"], alpha: number): ComfortFit {
  const prior = priorFrom(thresholds);
  if (!obs.length) return { theta: prior.mean, cov: null, prior, n: 0, alpha };
  const f = (t: Theta) => negLogPosterior(t, obs, prior);
  const theta = nelderMead(f, prior.mean, prior.sd.map((s) => s / 2));
  const refined = nelderMead(f, theta, prior.sd.map((s) => s / 10));
  return { theta: refined, cov: covariance(f, refined), prior, n: obs.length, alpha };
}

/** 95% interval of a function of theta (delta method on the Laplace covariance). */
export function interval(fit: ComfortFit, fn: (t: Theta) => number): [number, number] {
  const v0 = fn(fit.theta);
  const cov = fit.cov ?? fit.prior.sd.map((s, i) => fit.prior.sd.map((_, j) => (i === j ? s * s : 0)));
  const grad = fit.theta.map((_, i) => {
    const d = 1e-4;
    return (fn(fit.theta.map((v, k) => (k === i ? v + d : v))) - v0) / d;
  });
  let variance = 0;
  for (let i = 0; i < grad.length; i++) for (let j = 0; j < grad.length; j++) variance += grad[i] * cov[i][j] * grad[j];
  const half = 1.96 * Math.sqrt(Math.max(0, variance));
  return [v0 - half, v0 + half];
}

// ---- from reports --------------------------------------------------------------------------------

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const spread = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};

/** The drivers of a moment, from its place temperature, past 60 daily means and the 7 days before. */
export function driversFrom(
  e: number,
  history: (number | null)[],
  recent: { mean: number | null; humidity: number | null }[] | undefined,
  hNow: number | null,
  alpha: number,
): Drivers | null {
  const base = runningMean(history.map((m) => ({ mean: m, forecast: false })), alpha);
  if (!base) return null;
  return {
    e,
    a: base.value,
    h7: mean((recent ?? []).map((d) => d.humidity)),
    v7: spread(history.slice(0, 7)),
    hNow,
  };
}

export function placeTempOf(r: Report): number | null {
  const s = r.snapshot;
  if (!s) return null;
  if (r.exposure === "sun") return s.sunTemp;
  if (r.exposure === "shade") return s.shadeTemp;
  return s.sunTemp == null || s.shadeTemp == null ? null : (s.sunTemp + s.shadeTemp) / 2;
}

export function observationsOf(reports: Report[], alpha: number): Observation[] {
  const out: Observation[] = [];
  for (const r of reports) {
    if (r.deleted || !r.history?.length) continue;
    const e = placeTempOf(r);
    if (e == null) continue;
    const d = driversFrom(e, r.history, r.recent, r.snapshot?.humidity ?? null, alpha);
    if (d) out.push({ ...d, windFelt: r.windFelt, y: r.sensation });
  }
  return out;
}

export const ALPHA_GRID = [0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
export const STANDARD_ALPHA = 0.8;
export const MIN_FOR_ALPHA = 30;

/**
 * The fit in use. With enough reports, α is chosen too: the α whose fit gives the highest
 * likelihood of the reports (each α is compared on the same reports and the same model).
 */
export function fitFromReports(reports: Report[], thresholds: FeelSettings["thresholds"]): ComfortFit {
  const base = fitComfort(observationsOf(reports, STANDARD_ALPHA), thresholds, STANDARD_ALPHA);
  if (base.n < MIN_FOR_ALPHA) return base;
  let best = base;
  let bestLp = -negLogPosterior(base.theta, observationsOf(reports, STANDARD_ALPHA), base.prior);
  for (const alpha of ALPHA_GRID) {
    if (alpha === STANDARD_ALPHA) continue;
    const obs = observationsOf(reports, alpha);
    if (obs.length !== base.n) continue;
    const fit = fitComfort(obs, thresholds, alpha);
    const lp = -negLogPosterior(fit.theta, obs, fit.prior);
    if (lp > bestLp) {
      best = fit;
      bestLp = lp;
    }
  }
  return best;
}

// ---- prediction ----------------------------------------------------------------------------------

export interface ComfortPrediction {
  /** Probability of each answer −3…+3. */
  probs: number[];
  /** The most likely answer, and the expected value. */
  mode: number;
  expected: number;
  state: State;
  /** E − μ, and how far past the range's edge (0 inside). */
  offset: number;
  beyond: number;
  n: number;
  alpha: number;
  at: number;
}

export function predictComfort(fit: ComfortFit, x: Drivers, at: number): ComfortPrediction {
  const st = stateOf(fit.theta, x);
  const e = placeTemp(fit.theta, x);
  const probs = probabilities(st, e);
  const mode = probs.indexOf(Math.max(...probs)) - 3;
  const expected = probs.reduce((s, p, k) => s + p * (k - 3), 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    probs: probs.map(r2),
    mode,
    expected: Math.round(expected * 10) / 10,
    state: { mu: Math.round(st.mu * 10) / 10, h: Math.round(st.h * 10) / 10, g: Math.round(st.g * 10) / 10, s: Math.round(st.s * 100) / 100 },
    offset: Math.round((e - st.mu) * 10) / 10,
    beyond: Math.round(beyondRange(st, e) * 10) / 10,
    n: fit.n,
    alpha: fit.alpha,
    at,
  };
}

export interface TrackRecord {
  n: number;
  /** Mean −log P(answer): lower is better (log 7 ≈ 1.95 is a blind guess). */
  logLoss: number | null;
  /** Share answered exactly the most likely step. */
  hit: number | null;
  /** Mean of answer − expected (+: felt warmer than predicted). */
  bias: number | null;
  /** Mean |answer − expected|, overall and for the latest 10. */
  mae: number | null;
  recentMae: number | null;
}

/** The record of the predictions as they were made at sending. */
export function trackRecord(reports: Report[]): TrackRecord {
  const done = reports
    .filter((r) => !r.deleted && r.comfort)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((r) => ({ p: r.comfort!.probs[r.sensation + 3], hit: r.comfort!.mode === r.sensation, err: r.sensation - r.comfort!.expected }));
  const avg = (xs: number[], d = 1) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10 ** d) / 10 ** d : null);
  return {
    n: done.length,
    logLoss: avg(done.map((d) => -Math.log(Math.max(d.p, 1e-3))), 2),
    hit: avg(done.map((d) => (d.hit ? 1 : 0)), 2),
    bias: avg(done.map((d) => d.err)),
    mae: avg(done.map((d) => Math.abs(d.err))),
    recentMae: avg(done.slice(-10).map((d) => Math.abs(d.err))),
  };
}

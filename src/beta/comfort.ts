// β: the comfort centre and range of this moment — several models, compared and combined.
//
// The idea: a person feels "どちらでもない" within a range around a centre; past its edges it turns
// cool or warm step by step. Neither the centre nor the width is fixed: the days before (the recent
// temperatures and how they changed, humidity, sunshine, rain, the weather) move both. Which of
// them matter, and how much, is what the reports are for — so several models, each with its own
// set of drivers, are fitted side by side and compared.
//
// Every model has the same shape:
//   centre      μ = m0 + Σ b_j · x_j            (its centre drivers)
//   half-range  h = exp(l0 + Σ c_j · x_j)       (its range drivers)
//   outer step  g = exp(q0),  blur s = exp(r0)
//   place       E′ = E + wS·[風 強い] + wN·[風 なし]   (E = 日なた／日かげ温度, the station's wind,
//                                                     humidity and sun already in it)
//   answer      P(Y ≤ k) = σ((c_k − (E′ − μ)) / s),  c = μ-relative edges ±h, ±(h+g), ±(h+2g)
//
// Priors: the person's own 肌感 boundaries give the level (centre = middle of 過ごしやすい, h half its
// width, g the spacing of the outer boundaries); the recent-temperature slope starts at 0.33
// (EN 16798-1's adaptive comfort temperature against the running mean); every other driver starts
// at 0 with a spread wide enough for the reports to move it.
//
// Comparison: each model's evidence (marginal likelihood, Laplace approximation) — it already
// charges for every extra driver — gives its weight; the prediction is the weighted mixture
// (Bayesian model averaging). Each report also stores every model's own prediction made at sending,
// so the models are also compared on predictions made before the answer was known.

import type { FeelSettings } from "../../shared/feel";
import { runningMean } from "./adaptation";
import type { Report } from "./reports";

// ---- drivers -------------------------------------------------------------------------------------

/** Everything a model may use, for one moment. Missing values count as typical (0 after centring). */
export interface Drivers {
  /** Place temperature (日なた／日かげ／半々). */
  e: number;
  /** 最近の基準 (℃). */
  a: number;
  /** Yesterday's mean − 最近の基準 (℃): a sudden change. */
  dT1: number | null;
  /** Humidity (%): mean of the 7 days before, yesterday, now. */
  h7: number | null;
  h1: number | null;
  hNow: number | null;
  /** Spread of the 7 daily means before (℃). */
  v7: number | null;
  /** Sunshine hours: yesterday, mean of the 7 days. */
  sun1: number | null;
  sun7: number | null;
  /** Rain (mm): yesterday, mean of the 7 days. */
  rain1: number | null;
  rain7: number | null;
  /** Sunny now (reported sky, or the day's weather). */
  sky: boolean | null;
  /** Slope of the 14 daily means before (℃ per week): + warming (spring-like), − cooling (autumn-like). */
  trend: number | null;
  /** Day of the year (1–366), for the calendar-season check model only. */
  doy: number | null;
  /** Global radiation summed from the morning to this moment (MJ/m²), and whether it is night now. */
  radDay: number | null;
  night: boolean | null;
  /** Wind as an amount: mean of the last 6 hours (m/s) — how much of the stored warmth it has carried off. */
  wind6h: number | null;
  /** Last night: the day before's minimum − 最近の基準 (℃), and last night's mean wind (18時–6時; the
   *  day before's mean when the hours are missing) (m/s). */
  minPrev: number | null;
  windPrev: number | null;
  windFelt?: "strong" | "weak" | "none" | null;
}

export type DriverKey =
  | "a"
  | "dT1"
  | "h7"
  | "h1"
  | "hNow"
  | "v7"
  | "sun1"
  | "sun7"
  | "rain1"
  | "rain7"
  | "sky"
  | "trend"
  | "spring"
  | "radNight"
  | "radNightWind"
  | "coldNight"
  | "coldNightWind";

interface DriverInfo {
  label: string;
  /** What one unit of the centred value is, for people. */
  unit: string;
  value: (d: Drivers) => number;
  /** Prior spread of its effect on the centre (℃ per unit), on log width (per unit) and on the place temperature (℃ per unit). */
  muSd: number;
  hSd: number;
  eSd?: number;
}

const c = (v: number | null, ref: number, unit: number) => (v == null ? 0 : (v - ref) / unit);

export const DRIVERS: Record<DriverKey, DriverInfo> = {
  a: { label: "最近の基準", unit: "1℃", value: (d) => d.a - 15, muSd: 0.15, hSd: 0.03 },
  dT1: { label: "前日の気温の変化（前日 − 基準）", unit: "1℃", value: (d) => d.dT1 ?? 0, muSd: 0.3, hSd: 0.05 },
  h7: { label: "1週間の湿度", unit: "10%", value: (d) => c(d.h7, 65, 10), muSd: 0.6, hSd: 0.15 },
  h1: { label: "前日の湿度", unit: "10%", value: (d) => c(d.h1, 65, 10), muSd: 0.6, hSd: 0.15 },
  hNow: { label: "今の湿度", unit: "10%", value: (d) => c(d.hNow, 65, 10), muSd: 0.6, hSd: 0.15 },
  v7: { label: "1週間の気温の振れ", unit: "1℃", value: (d) => c(d.v7, 2, 1), muSd: 0.5, hSd: 0.15 },
  sun1: { label: "前日の日照", unit: "3時間", value: (d) => c(d.sun1, 5, 3), muSd: 0.6, hSd: 0.15 },
  sun7: { label: "1週間の日照", unit: "3時間", value: (d) => c(d.sun7, 5, 3), muSd: 0.6, hSd: 0.15 },
  rain1: { label: "前日の雨", unit: "log(1+mm)", value: (d) => (d.rain1 == null ? 0 : Math.log1p(d.rain1) - 0.5), muSd: 0.6, hSd: 0.15 },
  rain7: { label: "1週間の雨", unit: "log(1+mm)", value: (d) => (d.rain7 == null ? 0 : Math.log1p(d.rain7) - 0.5), muSd: 0.6, hSd: 0.15 },
  sky: { label: "晴れている", unit: "晴れ=1", value: (d) => (d.sky == null ? 0.5 : d.sky ? 1 : 0) - 0.5, muSd: 1.0, hSd: 0.2 },
  // 春と秋: the same 15 ℃ after a cold winter and after a hot summer. The 最近の基準 carries most of
  // it; the trend says whether the season is warming or cooling.
  trend: { label: "季節の向き（2週間の気温の傾き）", unit: "1℃/週", value: (d) => d.trend ?? 0, muSd: 0.5, hSd: 0.1 },
  // Check only: the calendar itself (+1 late March … −1 late September). If it explains more than
  // the history does, something besides temperature (clothes, day length) makes spring and autumn differ.
  spring: { label: "暦の春らしさ", unit: "春=+1, 秋=−1", value: (d) => (d.doy == null ? 0 : Math.cos((2 * Math.PI * (d.doy - 80)) / 365.25)), muSd: 1.5, hSd: 0.2 },
  // The day's sunshine stored in the ground and walls, given back after dark: it warms the place
  // (E′), not the person's centre. Counts at night only; 10 MJ/m² is an ordinary sunny-ish day.
  radNight: {
    label: "日中の日射の余熱（夜）",
    unit: "5MJ/m²",
    value: (d) => (d.night && d.radDay != null ? (d.radDay - 10) / 5 : 0),
    muSd: 0.6,
    hSd: 0.15,
    eSd: 1.5,
  },
  // Wind carries the stored warmth off — not the wind of the instant but how much has blown since
  // dark: the same day's sun counts for less after hours of wind. (Product with radNight.)
  radNightWind: {
    label: "余熱 × 直近6時間の風",
    unit: "5MJ/m² × 2m/s",
    value: (d) => (d.night && d.radDay != null && d.wind6h != null ? ((d.radDay - 10) / 5) * ((d.wind6h - 2) / 2) : 0),
    muSd: 0.3,
    hSd: 0.1,
    eSd: 1.0,
  },
  // Last night's cold stays in the ground and is felt the next day (daytime only).
  coldNight: {
    label: "前夜の冷え込み（前日の最低 − 基準）",
    unit: "3℃",
    value: (d) => (d.night === false && d.minPrev != null ? (d.minPrev + 6) / 3 : 0),
    muSd: 0.6,
    hSd: 0.15,
    eSd: 1.5,
  },
  // …and a windy night (in winter especially) draws more heat out of the ground.
  coldNightWind: {
    label: "前夜の冷え込み × 前夜の風",
    unit: "3℃ × 2m/s",
    value: (d) => (d.night === false && d.minPrev != null && d.windPrev != null ? ((d.minPrev + 6) / 3) * ((d.windPrev - 2) / 2) : 0),
    muSd: 0.3,
    hSd: 0.1,
    eSd: 1.0,
  },
};

// ---- models --------------------------------------------------------------------------------------

export interface ModelSpec {
  id: string;
  name: string;
  /** Drivers of the centre, of the range's width, and of the place temperature itself. */
  mu: DriverKey[];
  h: DriverKey[];
  e?: DriverKey[];
}

export const MODELS: ModelSpec[] = [
  { id: "M0", name: "一定", mu: [], h: [] },
  { id: "M1", name: "慣れ", mu: ["a"], h: [] },
  { id: "M2", name: "慣れ＋1週間", mu: ["a", "h7"], h: ["v7", "hNow"] },
  { id: "M3", name: "慣れ＋前日", mu: ["a", "dT1", "h1", "sun1", "rain1"], h: ["v7", "h1"] },
  { id: "M4", name: "慣れ＋季節の向き", mu: ["a", "trend"], h: ["v7", "trend"] },
  {
    id: "M5",
    name: "前日・1週間・天気・季節の向き",
    mu: ["a", "dT1", "trend", "h7", "h1", "sun1", "sun7", "rain1", "rain7", "sky"],
    h: ["v7", "hNow", "h1", "sun1", "sky", "trend"],
    e: ["radNight", "radNightWind", "coldNight", "coldNightWind"],
  },
  { id: "M6", name: "慣れ＋暦の季節（確認用）", mu: ["a", "spring"], h: ["v7", "spring"] },
  { id: "M7", name: "慣れ＋季節の向き＋日射の余熱", mu: ["a", "trend"], h: ["v7"], e: ["radNight", "radNightWind"] },
  { id: "M8", name: "慣れ＋季節の向き＋地面の熱（余熱と前夜の冷え、風付き）", mu: ["a", "trend"], h: ["v7"], e: ["radNight", "radNightWind", "coldNight", "coldNightWind"] },
];

/** Parameter names of a model, in theta order. */
export function paramNames(m: ModelSpec): string[] {
  return ["m0", ...m.mu.map((k) => `中心:${k}`), "l0", ...m.h.map((k) => `範囲:${k}`), ...(m.e ?? []).map((k) => `場所:${k}`), "q0", "r0", "wS", "wN"];
}

export type Theta = number[];

export interface Prior {
  mean: Theta;
  sd: Theta;
}

/** The prior, from the 肌感 boundaries t0 < t1 < t2 < t3. */
export function priorFor(m: ModelSpec, thresholds: FeelSettings["thresholds"]): Prior {
  const [t0, t1, t2, t3] = thresholds;
  const h = Math.max(0.5, (t2 - t1) / 2);
  const g = Math.max(1, (t1 - t0 + (t3 - t2)) / 2);
  const es = m.e ?? [];
  const mean = [(t1 + t2) / 2, ...m.mu.map((k) => (k === "a" ? 0.33 : 0)), Math.log(h), ...m.h.map(() => 0), ...es.map(() => 0), Math.log(g), 0, 0, 0];
  const sd = [3, ...m.mu.map((k) => DRIVERS[k].muSd), 0.5, ...m.h.map((k) => DRIVERS[k].hSd), ...es.map((k) => DRIVERS[k].eSd ?? 1), 0.5, 0.5, 1.5, 1.5];
  return { mean, sd };
}

export interface State {
  mu: number;
  h: number;
  g: number;
  s: number;
}

export function stateOf(m: ModelSpec, theta: Theta, x: Drivers): State {
  let i = 0;
  let mu = theta[i++];
  for (const k of m.mu) mu += theta[i++] * DRIVERS[k].value(x);
  let lh = theta[i++];
  for (const k of m.h) lh += theta[i++] * DRIVERS[k].value(x);
  i += (m.e ?? []).length;
  return { mu, h: Math.exp(lh), g: Math.exp(theta[i]), s: Math.exp(theta[i + 1]) };
}

/** The place temperature E′: E plus the place drivers (the day's stored sun at night) and the felt wind. */
export function placeTemp(m: ModelSpec, theta: Theta, x: Drivers): number {
  const n = theta.length;
  let e = x.e + (x.windFelt === "strong" ? theta[n - 2] : x.windFelt === "none" ? theta[n - 1] : 0);
  const start = 1 + m.mu.length + 1 + m.h.length;
  (m.e ?? []).forEach((k, j) => (e += theta[start + j] * DRIVERS[k].value(x)));
  return e;
}

const sigma = (v: number) => 1 / (1 + Math.exp(-v));

/** Probability of each answer −3…+3 (7 numbers summing to 1). */
export function probabilities(st: State, e: number): number[] {
  const edges = [-st.h - 2 * st.g, -st.h - st.g, -st.h, st.h, st.h + st.g, st.h + 2 * st.g];
  const cdf = [0, ...edges.map((ck) => sigma((ck - (e - st.mu)) / st.s)), 1];
  return Array.from({ length: 7 }, (_, k) => Math.max(1e-9, cdf[k + 1] - cdf[k]));
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

const LOG_2PI = Math.log(2 * Math.PI);

/** −log(likelihood × prior), with the prior's normalising constants (needed to compare models). */
function negLogJoint(m: ModelSpec, theta: Theta, obs: Observation[], prior: Prior): number {
  let v = 0;
  for (let i = 0; i < theta.length; i++) v += ((theta[i] - prior.mean[i]) / prior.sd[i]) ** 2 / 2 + Math.log(prior.sd[i]) + LOG_2PI / 2;
  for (const o of obs) v -= Math.log(probabilities(stateOf(m, theta, o), placeTemp(m, theta, o))[o.y + 3]);
  return v;
}

/** Nelder–Mead minimiser (small, dependency-free). */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iterations = 3000): number[] {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a.f - b.f);
    if (Math.abs(simplex[n].f - simplex[0].f) < 1e-8) break;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const at = (t: number) => centroid.map((cc, j) => cc + t * (simplex[n].x[j] - cc));
    const r = { x: at(-1), f: 0 };
    r.f = f(r.x);
    if (r.f < simplex[0].f) {
      const e = { x: at(-2), f: 0 };
      e.f = f(e.x);
      simplex[n] = e.f < r.f ? e : r;
    } else if (r.f < simplex[n - 1].f) simplex[n] = r;
    else {
      const k = { x: at(r.f < simplex[n].f ? -0.5 : 0.5), f: 0 };
      k.f = f(k.x);
      if (k.f < Math.min(r.f, simplex[n].f)) simplex[n] = k;
      else
        simplex = simplex.map((p, i) => {
          if (i === 0) return p;
          const x = p.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j]));
          return { x, f: f(x) };
        });
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0].x;
}

/**
 * BFGS with central-difference gradients and a backtracking line search: converges in tens of
 * iterations where Nelder–Mead needs thousands in 10–20 dimensions.
 */
export function bfgs(f: (x: number[]) => number, x0: number[], iterations = 200): number[] {
  const n = x0.length;
  const grad = (x: number[]) =>
    x.map((_, i) => {
      const h = 1e-5 * Math.max(1, Math.abs(x[i]));
      const a = x.slice();
      const b = x.slice();
      a[i] += h;
      b[i] -= h;
      return (f(a) - f(b)) / (2 * h);
    });
  let x = x0.slice();
  let fx = f(x);
  let g = grad(x);
  const identity = (): number[][] => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let H = identity();
  for (let it = 0; it < iterations; it++) {
    const d = H.map((row) => -row.reduce((s, v, j) => s + v * g[j], 0));
    let slope = d.reduce((s, v, i) => s + v * g[i], 0);
    if (slope >= 0) {
      // Not a descent direction: restart from steepest descent.
      H = identity();
      for (let i = 0; i < n; i++) d[i] = -g[i];
      slope = -g.reduce((s, v) => s + v * v, 0);
    }
    let t = 1;
    let xn = x.map((v, i) => v + t * d[i]);
    let fn = f(xn);
    while (!(fn <= fx + 1e-4 * t * slope) && t > 1e-10) {
      t /= 2;
      xn = x.map((v, i) => v + t * d[i]);
      fn = f(xn);
    }
    if (t <= 1e-10) break;
    const gn = grad(xn);
    const sv = xn.map((v, i) => v - x[i]);
    const yv = gn.map((v, i) => v - g[i]);
    const sy = sv.reduce((s, v, i) => s + v * yv[i], 0);
    const done = Math.abs(fx - fn) < 1e-9 * (1 + Math.abs(fx)) && Math.max(...gn.map(Math.abs)) < 1e-4;
    x = xn;
    fx = fn;
    g = gn;
    if (done) break;
    if (sy > 1e-12) {
      // H ← (I − ρ s yᵀ) H (I − ρ y sᵀ) + ρ s sᵀ
      const rho = 1 / sy;
      const Hy = H.map((row) => row.reduce((s, v, j) => s + v * yv[j], 0));
      const yHy = yv.reduce((s, v, i) => s + v * Hy[i], 0);
      H = H.map((row, i) => row.map((v, j) => v - rho * (Hy[i] * sv[j] + sv[i] * Hy[j]) + (rho * rho * yHy + rho) * sv[i] * sv[j]));
    }
  }
  return x;
}

/** Numerical Hessian's inverse (Laplace covariance) and its log determinant; null if not positive definite. */
function laplace(f: (x: number[]) => number, x: number[]): { cov: number[][]; logDet: number } | null {
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
  // Cholesky H = L Lᵀ (fails exactly when H is not positive definite, i.e. not a proper peak).
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let sum = H[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 0)) return null;
        L[i][i] = Math.sqrt(sum);
      } else L[i][j] = sum / L[j][j];
    }
  const logDetH = 2 * L.reduce((s, row, i) => s + Math.log(row[i]), 0);
  // Covariance = H⁻¹, column by column: solve L z = e_k, then Lᵀ x = z.
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  for (let k = 0; k < n; k++) {
    const zz = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = i === k ? 1 : 0;
      for (let j = 0; j < i; j++) sum -= L[i][j] * zz[j];
      zz[i] = sum / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let sum = zz[i];
      for (let j = i + 1; j < n; j++) sum -= L[j][i] * cov[j][k];
      cov[i][k] = sum / L[i][i];
    }
  }
  return { cov, logDet: -logDetH };
}

export interface ModelFit {
  model: ModelSpec;
  theta: Theta;
  /** Laplace covariance (null: the prior's spread is used for intervals). */
  cov: number[][] | null;
  prior: Prior;
  n: number;
  /** log marginal likelihood (Laplace): fit and complexity in one number; higher is better. */
  logEvidence: number;
}

export function fitModel(m: ModelSpec, obs: Observation[], thresholds: FeelSettings["thresholds"]): ModelFit {
  const prior = priorFor(m, thresholds);
  const k = prior.mean.length;
  if (!obs.length) return { model: m, theta: prior.mean, cov: null, prior, n: 0, logEvidence: 0 };
  const f = (t: Theta) => negLogJoint(m, t, obs, prior);
  const theta = bfgs(f, prior.mean);
  const lap = laplace(f, theta);
  // Without a usable curvature, fall back to the prior's spread (a cautious, complexity-charging guess).
  const logDet = lap ? lap.logDet : prior.sd.reduce((s, v) => s + 2 * Math.log(v), 0);
  const logEvidence = -f(theta) + (k / 2) * LOG_2PI + logDet / 2;
  return { model: m, theta, cov: lap?.cov ?? null, prior, n: obs.length, logEvidence };
}

/** 95% interval of a function of theta (delta method on the Laplace covariance). */
export function interval(fit: ModelFit, fn: (t: Theta) => number): [number, number] {
  const v0 = fn(fit.theta);
  const cov = fit.cov ?? fit.prior.sd.map((s, i) => fit.prior.sd.map((_, j) => (i === j ? s * s : 0)));
  const grad = fit.theta.map((_, i) => (fn(fit.theta.map((v, k) => (k === i ? v + 1e-4 : v))) - v0) / 1e-4);
  let variance = 0;
  for (let i = 0; i < grad.length; i++) for (let j = 0; j < grad.length; j++) variance += grad[i] * cov[i][j] * grad[j];
  const half = 1.96 * Math.sqrt(Math.max(0, variance));
  return [v0 - half, v0 + half];
}

// ---- drivers from reports and from the store -----------------------------------------------------

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sd = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};

export interface PastDayLite {
  mean: number | null;
  humidity: number | null;
  sun: number | null;
  rain: number | null;
  min?: number | null;
  wind?: number | null;
}

/**
 * The drivers of a moment: its place temperature, the 60 daily means before (newest first), the
 * 7 days before in detail (newest first), the humidity and sky of the moment.
 */
/** Least-squares slope of the 14 daily means before, in ℃ per week (null with fewer than 10). */
export function trendOf(history: (number | null)[]): number | null {
  const pts = history.slice(0, 14).flatMap((v, k) => (v == null ? [] : [{ x: -(k + 1), y: v }]));
  if (pts.length < 10) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return (pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx) * 7;
}

/** Day of the year (1–366) of a date "YYYY-MM-DD". */
export const dayOfYear = (date: string) => Math.floor((Date.parse(date) - Date.parse(`${date.slice(0, 4)}-01-01`)) / 86_400_000) + 1;

export function driversFrom(
  e: number,
  history: (number | null)[],
  recent: PastDayLite[] | undefined,
  hNow: number | null,
  sky: boolean | null,
  alpha: number,
  date: string | null = null,
  radDay: number | null = null,
  hour: number | null = null,
  wind6h: number | null = null,
  windLastNight: number | null = null,
): Drivers | null {
  const base = runningMean(history.map((m) => ({ mean: m, forecast: false })), alpha);
  if (!base) return null;
  const week = (recent ?? []).slice(0, 7);
  const y = week[0];
  const yMean = y?.mean ?? history[0] ?? null;
  return {
    e,
    a: base.value,
    dT1: yMean == null ? null : yMean - base.value,
    h7: avg(week.map((d) => d.humidity)),
    h1: y?.humidity ?? null,
    hNow,
    v7: sd(history.slice(0, 7)),
    sun1: y?.sun ?? null,
    sun7: avg(week.map((d) => d.sun)),
    rain1: y?.rain ?? null,
    rain7: avg(week.map((d) => d.rain)),
    sky,
    trend: trendOf(history),
    doy: date ? dayOfYear(date) : null,
    radDay,
    night: hour == null ? null : isNight(hour),
    wind6h,
    minPrev: y?.min == null ? null : y.min - base.value,
    windPrev: windLastNight ?? y?.wind ?? null,
  };
}

/** Night for the stored-sun driver: 18時 to 5時 (JMA hours, 24 = midnight). */
export const isNight = (hour: number) => hour >= 18 || hour <= 5;

export function placeTempOf(r: Report): number | null {
  const s = r.snapshot;
  if (!s) return null;
  if (r.exposure === "sun") return s.sunTemp;
  if (r.exposure === "shade") return s.shadeTemp;
  return s.sunTemp == null || s.shadeTemp == null ? null : (s.sunTemp + s.shadeTemp) / 2;
}

export const reportedSunny = (r: Report) => (r.sky ? r.sky === "clear" || r.sky === "sunny" : null);

export function observationsOf(reports: Report[], alpha: number): Observation[] {
  const out: Observation[] = [];
  for (const r of reports) {
    if (r.deleted || !r.history?.length) continue;
    const e = placeTempOf(r);
    if (e == null) continue;
    const d = driversFrom(e, r.history, r.recent, r.snapshot?.humidity ?? null, reportedSunny(r), alpha, r.snapshot?.date ?? r.at.slice(0, 10), r.snapshot?.radDay ?? null, r.snapshot?.hour ?? null, r.snapshot?.wind6h ?? null, r.snapshot?.windLastNight ?? null);
    if (d) out.push({ ...d, windFelt: r.windFelt, y: r.sensation });
  }
  return out;
}

// ---- the ensemble ----------------------------------------------------------------------------------

export const ALPHA_GRID = [0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
export const STANDARD_ALPHA = 0.8;
export const MIN_FOR_ALPHA = 30;

export interface Ensemble {
  alpha: number;
  fits: ModelFit[];
  /** Posterior model weights (equal prior over models), from the evidence. */
  weights: number[];
  n: number;
}

function weightsOf(fits: ModelFit[]): number[] {
  const top = Math.max(...fits.map((f) => f.logEvidence));
  const raw = fits.map((f) => Math.exp(f.logEvidence - top));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

export function fitEnsemble(obs: Observation[], thresholds: FeelSettings["thresholds"], alpha: number): Ensemble {
  const fits = MODELS.map((m) => fitModel(m, obs, thresholds));
  return { alpha, fits, weights: weightsOf(fits), n: obs.length };
}

/**
 * The ensemble in use. With enough reports, α (慣れの速さ) is chosen first, by the evidence of the
 * 慣れ＋1週間 model (each α on the same reports), then every model is fitted at that α.
 */
export function ensembleFromReports(reports: Report[], thresholds: FeelSettings["thresholds"]): Ensemble {
  let alpha = STANDARD_ALPHA;
  const n = observationsOf(reports, STANDARD_ALPHA).length;
  if (n >= MIN_FOR_ALPHA) {
    const probe = MODELS.find((m) => m.id === "M2")!;
    let best = -Infinity;
    for (const a of ALPHA_GRID) {
      const obs = observationsOf(reports, a);
      if (obs.length !== n) continue;
      const ev = fitModel(probe, obs, thresholds).logEvidence;
      if (ev > best) {
        best = ev;
        alpha = a;
      }
    }
  }
  return fitEnsemble(observationsOf(reports, alpha), thresholds, alpha);
}

// ---- prediction ----------------------------------------------------------------------------------

export interface ModelPrediction {
  id: string;
  weight: number;
  probs: number[];
  mode: number;
  mu: number;
  h: number;
}

export interface ComfortPrediction {
  /** Mixture over the models: probability of each answer −3…+3. */
  probs: number[];
  mode: number;
  expected: number;
  /** Weighted centre, half-range, outer step and blur. */
  state: State;
  /** E′ − μ, and how far past the range's edge (0 inside). */
  offset: number;
  beyond: number;
  /** Each model's own prediction (kept so models can be compared on predictions made in advance). */
  models: ModelPrediction[];
  n: number;
  alpha: number;
  at: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The weighted centre and range of a moment (no place temperature needed). */
export function ensembleState(ens: Ensemble, x: Drivers): State {
  const sts = ens.fits.map((f) => stateOf(f.model, f.theta, x));
  const w = ens.weights;
  const mix = (k: keyof State) => sts.reduce((s, st, i) => s + w[i] * st[k], 0);
  return { mu: mix("mu"), h: mix("h"), g: mix("g"), s: mix("s") };
}

export function predictComfort(ens: Ensemble, x: Drivers, at: number): ComfortPrediction {
  const models = ens.fits.map((f, i) => {
    const st = stateOf(f.model, f.theta, x);
    const probs = probabilities(st, placeTemp(f.model, f.theta, x));
    return { id: f.model.id, weight: r2(ens.weights[i]), probs, mode: probs.indexOf(Math.max(...probs)) - 3, mu: r1(st.mu), h: r1(st.h), e: placeTemp(f.model, f.theta, x) };
  });
  const probs = Array.from({ length: 7 }, (_, k) => models.reduce((s, m, i) => s + ens.weights[i] * m.probs[k], 0));
  const st = ensembleState(ens, x);
  const e = models.reduce((s, m, i) => s + ens.weights[i] * m.e, 0);
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
  };
}

// ---- track records -------------------------------------------------------------------------------

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

const mean = (xs: number[], d = 1) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10 ** d) / 10 ** d : null);

function recordOf(items: { y: number; probs: number[]; mode: number }[]): TrackRecord {
  const exp = (p: number[]) => p.reduce((s, v, k) => s + v * (k - 3), 0);
  return {
    n: items.length,
    logLoss: mean(items.map((d) => -Math.log(Math.max(d.probs[d.y + 3], 1e-3))), 2),
    hit: mean(items.map((d) => (d.mode === d.y ? 1 : 0)), 2),
    bias: mean(items.map((d) => d.y - exp(d.probs))),
    mae: mean(items.map((d) => Math.abs(d.y - exp(d.probs)))),
    recentMae: mean(items.slice(-10).map((d) => Math.abs(d.y - exp(d.probs)))),
  };
}

const done = (reports: Report[]) => reports.filter((r) => !r.deleted && r.comfort).sort((a, b) => (a.at < b.at ? -1 : 1));

/** The record of the combined predictions as they were made at sending. */
export function trackRecord(reports: Report[]): TrackRecord {
  return recordOf(done(reports).map((r) => ({ y: r.sensation, probs: r.comfort!.probs, mode: r.comfort!.mode })));
}

/** Each model's own record, from the predictions it made at sending. */
export function modelRecords(reports: Report[]): Record<string, TrackRecord> {
  const out: Record<string, TrackRecord> = {};
  for (const m of MODELS) {
    const items = done(reports)
      .map((r) => ({ r, p: r.comfort!.models?.find((x) => x.id === m.id) }))
      .filter((x) => x.p)
      .map(({ r, p }) => ({ y: r.sensation, probs: p!.probs, mode: p!.mode }));
    out[m.id] = recordOf(items);
  }
  return out;
}

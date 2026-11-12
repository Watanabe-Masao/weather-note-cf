// MATH-05: fitting one model (prior × likelihood, BFGS, Laplace) and the intervals.
// Contract: research/comfort-model/mathematical-contract.md

import { type Drivers } from "./drivers";
import { type ModelSpec, paramNames, placeTemp, type Prior, priorFor, probabilities, stateOf, type Theta, usable } from "./model";

export interface Observation extends Drivers {
  y: number; // −3…+3
  /** Weight in the likelihood (default 1). Reports made in a row share one answer's worth (#62). */
  w?: number;
}

const LOG_2PI = Math.log(2 * Math.PI);

/** −log(likelihood × prior), with the prior's normalising constants (needed to compare models). */
/** −log(prior × likelihood): what fitting minimises (exported for the research checks, #35). */
export function negLogJoint(m: ModelSpec, theta: Theta, obs: Observation[], prior: Prior): number {
  let v = 0;
  for (let i = 0; i < theta.length; i++) v += ((theta[i] - prior.mean[i]) / prior.sd[i]) ** 2 / 2 + Math.log(prior.sd[i]) + LOG_2PI / 2;
  for (const o of obs) v -= (o.w ?? 1) * Math.log(probabilities(stateOf(m, theta, o), placeTemp(m, theta, o))[o.y + 3]);
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
export function laplace(f: (x: number[]) => number, x: number[]): { cov: number[][]; logDet: number } | null {
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

export function fitModel(m: ModelSpec, all: Observation[]): ModelFit {
  // Only observations with every input of this model (MATH-03: missing is not typical).
  const obs = all.filter((o) => usable(m, o));
  const prior = priorFor(m);
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

/**
 * Pairs of effects the reports cannot tell apart (MATH-07): their estimates move together
 * (|correlation| ≥ `limit` in the Laplace covariance), as when two inputs always rise and fall
 * together (wind and temperature, the season and the baseline). Each is then unknown on its own.
 */
export function confoundedPairs(fit: ModelFit, limit = 0.9): [string, string, number][] {
  if (!fit.cov) return [];
  const names = paramNames(fit.model);
  const out: [string, string, number][] = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const r = fit.cov[i][j] / Math.sqrt(fit.cov[i][i] * fit.cov[j][j]);
      if (Math.abs(r) >= limit) out.push([names[i], names[j], Math.round(r * 100) / 100]);
    }
  return out;
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

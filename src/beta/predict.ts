// β: the predicted sensation shown on the report screen, and how its misses are learnt from.
//
// Prior (works with no reports at all): the place's own 日なた／日かげ温度 E read through the
// person's own 肌感 boundaries, mapped onto the 7-point scale:
//   寒い|肌寒い (t0) → −2, 肌寒い|過ごしやすい (t1) → −1, middle of 過ごしやすい → 0,
//   過ごしやすい|暖かい (t2) → +1, 暖かい|暑い (t3) → +2; straight lines between, the end slopes
//   carried on outside, clamped to ±3.
// Correction (learnt from the reports): residual r = reported − prior, fitted by Bayesian linear
// regression (normal prior centred on 0, so with few reports the correction stays near 0) on
//   [1, d, 風強い, 風なし]   d = air temperature − 最近の基準.
// The prediction is recomputed when the report is sent (the notification and the sending can be
// apart), and stored with the report; its error (reported − predicted) is what is summed up, so the
// track record is always of predictions made before the answer was known.

import type { FeelSettings } from "../../shared/feel";
import { runningMean } from "./adaptation";
import type { Report, Sensation, WindFelt } from "./reports";
import { SENSATIONS } from "./reports";

export const MODEL = "prior-thresholds+bayes-residual/1";

/** The prior: E through the 肌感 boundaries onto −3…+3. */
export function priorSensation(e: number, thresholds: FeelSettings["thresholds"]): number {
  const [t0, t1, t2, t3] = thresholds;
  const pts: [number, number][] = [
    [t0, -2],
    [t1, -1],
    [(t1 + t2) / 2, 0],
    [t2, 1],
    [t3, 2],
  ];
  let v: number;
  if (e <= pts[0][0]) v = pts[0][1] + (e - pts[0][0]) / (pts[1][0] - pts[0][0]);
  else if (e >= pts[4][0]) v = pts[4][1] + (e - pts[4][0]) / (pts[4][0] - pts[3][0]);
  else {
    const i = pts.findIndex((p, k) => k < 4 && e >= p[0] && e <= pts[k + 1][0]);
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    v = y0 + ((e - x0) * (y1 - y0)) / (x1 - x0);
  }
  return Math.max(-3, Math.min(3, v));
}

export interface PredictInputs {
  /** The place's own temperature (日なた, 日かげ, or their mean for 半々). */
  e: number;
  /** Air temperature − 最近の基準, or null when there is no baseline. */
  d: number | null;
  windFelt: WindFelt;
}

/** Prior spread of each correction term (0 at the start): intercept, per ℃ of d, wind strong, wind none. */
const PRIOR_SD = [0.7, 0.12, 0.6, 0.6];
/** Assumed noise of a single report (steps), before enough reports to say. */
const NOISE_SD = 0.9;

export interface Correction {
  coef: number[];
  n: number;
}

const features = (x: PredictInputs) => [1, x.d ?? 0, x.windFelt === "strong" ? 1 : 0, x.windFelt === "none" ? 1 : 0];

/** Solve A b = c (small, symmetric positive definite). */
function solve(A: number[][], c: number[]): number[] {
  const n = c.length;
  const M = A.map((row, i) => [...row, c[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Inputs of a past report, recomputed with today's α (the same way as at sending). */
export function inputsOf(r: Report, alpha: number): PredictInputs | null {
  const s = r.snapshot;
  if (!s) return null;
  const e = r.exposure === "sun" ? s.sunTemp : r.exposure === "shade" ? s.shadeTemp : s.sunTemp == null || s.shadeTemp == null ? null : (s.sunTemp + s.shadeTemp) / 2;
  if (e == null) return null;
  const base = r.history?.length ? runningMean(r.history.map((mean) => ({ mean, forecast: false })), alpha) : null;
  return { e, d: base && s.temp != null ? s.temp - base.value : null, windFelt: r.windFelt };
}

/** Posterior mean of the correction, from all reports (with few, it stays near 0). */
export function fitCorrection(reports: Report[], alpha: number, thresholds: FeelSettings["thresholds"]): Correction {
  const k = PRIOR_SD.length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? (NOISE_SD / PRIOR_SD[i]) ** 2 : 0)));
  const c = Array(k).fill(0);
  let n = 0;
  for (const r of reports) {
    if (r.deleted) continue;
    const x = inputsOf(r, alpha);
    if (!x) continue;
    const f = features(x);
    const resid = r.sensation - priorSensation(x.e, thresholds);
    for (let i = 0; i < k; i++) {
      c[i] += f[i] * resid;
      for (let j = 0; j < k; j++) A[i][j] += f[i] * f[j];
    }
    n++;
  }
  return { coef: n ? solve(A, c) : Array(k).fill(0), n };
}

export interface Prediction {
  /** −3…+3, one decimal. */
  value: number;
  /** Nearest step's words. */
  label: string;
  prior: number;
  correction: number;
  /** Reports the correction was learnt from. */
  n: number;
  model: string;
  /** When it was computed (ms). */
  at: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function predict(x: PredictInputs, fit: Correction, thresholds: FeelSettings["thresholds"], at: number): Prediction {
  const prior = priorSensation(x.e, thresholds);
  const correction = features(x).reduce((s, f, i) => s + f * fit.coef[i], 0);
  const value = Math.max(-3, Math.min(3, prior + correction));
  return { value: round1(value), label: labelOf(value), prior: round1(prior), correction: round1(correction), n: fit.n, model: MODEL, at };
}

export const labelOf = (v: number) => SENSATIONS.find((s) => s.value === (Math.max(-3, Math.min(3, Math.round(v))) as Sensation))!.label;

export interface ErrorStats {
  n: number;
  /** Mean of reported − predicted: + means it felt warmer than predicted. */
  bias: number | null;
  mae: number | null;
  /** The same over the latest 10. */
  recentMae: number | null;
  /** Share of reports on the predicted step (rounded). */
  hit: number | null;
}

/** The track record of the predictions as they were made (stored with each report). */
export function errorStats(reports: Report[]): ErrorStats {
  const done = reports
    .filter((r) => !r.deleted && r.prediction)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((r) => ({ err: r.sensation - r.prediction!.value, hit: Math.round(r.prediction!.value) === r.sensation }));
  const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    n: done.length,
    bias: mean(done.map((d) => d.err)),
    mae: mean(done.map((d) => Math.abs(d.err))),
    recentMae: mean(done.slice(-10).map((d) => Math.abs(d.err))),
    hit: done.length ? Math.round((done.filter((d) => d.hit).length / done.length) * 100) / 100 : null,
  };
}

// β: 慣れの速さ (α) estimated from the person's own reports, never chosen by hand.
//
// Each report keeps the 30 daily means before it (Report.history), so the 最近の基準 can be
// recomputed for any α. For each candidate α the reports are fitted by least squares:
//   M1(α):  sensation ≈ b0 + b1·E + γ·d(α)      E = 日なた／日かげ温度 of the place reported,
//                                               d = air temperature then − 最近の基準(α)
//   M0:     sensation ≈ b0 + b1·E                 (no history)
// The α of the best M1 is taken only when M1 beats M0 by BIC (α counts as a parameter), so a
// history effect the data cannot show is not claimed. Until then the standard α (EN 16798-1) is used.
// Least squares on the 7-point scale is a first approximation (the proposal's ordinal model is for
// the offline analysis of the CSV).

import { runningMean } from "./adaptation";
import type { Report } from "./reports";

export const STANDARD_ALPHA = 0.8;
export const ALPHA_GRID = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
/** Below these the estimate is not attempted. */
export const MIN_REPORTS = 30;
export const MIN_SPAN_DAYS = 14;

export interface AlphaFit {
  /** The α in use. */
  alpha: number;
  /** "fitted": estimated and kept; "no-effect": enough data, but history did not help; "collecting": not enough yet. */
  status: "fitted" | "no-effect" | "collecting";
  /** Reports usable for the fit, and the days they span. */
  n: number;
  spanDays: number;
  /** Share of M0's squared error that the history removes (0.12 = 12% better), when fitted or checked. */
  improvement: number | null;
}

interface Point {
  y: number;
  e: number;
  t: number;
  history: (number | null)[];
}

/** The place's own apparent temperature: sun, shade, or the mean of both for 半々. */
function placeTemp(r: Report): number | null {
  const s = r.snapshot;
  if (!s) return null;
  if (r.exposure === "sun") return s.sunTemp;
  if (r.exposure === "shade") return s.shadeTemp;
  return s.sunTemp == null || s.shadeTemp == null ? null : (s.sunTemp + s.shadeTemp) / 2;
}

/** Least squares on columns X (rows) → sum of squared residuals, or null when singular. */
export function leastSquaresSse(X: number[][], y: number[]): number | null {
  const k = X[0]?.length ?? 0;
  // Normal equations (XᵀX) b = Xᵀy, solved by Gaussian elimination with partial pivoting.
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k + 1 }, (_, j) => 0 * i * j));
  X.forEach((row, n) => {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j];
      A[i][k] += row[i] * y[n];
    }
  });
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  const b = A.map((row, i) => row[k] / row[i]);
  return X.reduce((sse, row, n) => {
    const fit = row.reduce((s, x, i) => s + x * b[i], 0);
    return sse + (y[n] - fit) ** 2;
  }, 0);
}

const bic = (sse: number, n: number, k: number) => n * Math.log(Math.max(sse, 1e-9) / n) + k * Math.log(n);

export function fitAlpha(reports: Report[]): AlphaFit {
  const points: Point[] = [];
  const days = new Set<string>();
  for (const r of reports) {
    if (r.deleted || !r.history?.length) continue;
    const e = placeTemp(r);
    const t = r.snapshot?.temp;
    if (e == null || t == null) continue;
    points.push({ y: r.sensation, e, t, history: r.history });
    days.add(r.at.slice(0, 10));
  }
  const sorted = [...days].sort();
  const spanDays = sorted.length ? Math.round((Date.parse(sorted.at(-1)!) - Date.parse(sorted[0])) / 86_400_000) + 1 : 0;
  const n = points.length;
  const collecting: AlphaFit = { alpha: STANDARD_ALPHA, status: "collecting", n, spanDays, improvement: null };
  if (n < MIN_REPORTS || spanDays < MIN_SPAN_DAYS) return collecting;

  const y = points.map((p) => p.y);
  const sse0 = leastSquaresSse(points.map((p) => [1, p.e]), y);
  if (sse0 == null) return collecting;

  let best: { alpha: number; sse: number } | null = null;
  for (const alpha of ALPHA_GRID) {
    const rows: number[][] = [];
    const ys: number[] = [];
    points.forEach((p) => {
      const base = runningMean(p.history.map((mean) => ({ mean, forecast: false })), alpha);
      if (!base) return;
      rows.push([1, p.e, p.t - base.value]);
      ys.push(p.y);
    });
    if (rows.length < n) continue; // compare every α on the same reports
    const sse = leastSquaresSse(rows, ys);
    if (sse != null && (!best || sse < best.sse)) best = { alpha, sse };
  }
  if (!best) return collecting;
  const improvement = Math.round((1 - best.sse / sse0) * 100) / 100;
  // M1 has two more parameters than M0: γ and α.
  const better = bic(best.sse, n, 4) < bic(sse0, n, 2);
  return better
    ? { alpha: best.alpha, status: "fitted", n, spanDays, improvement }
    : { alpha: STANDARD_ALPHA, status: "no-effect", n, spanDays, improvement };
}

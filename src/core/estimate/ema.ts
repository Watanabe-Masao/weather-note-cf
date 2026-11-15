// The weighted running mean of a run, newest first (index 0 = the step before): step k weighs
// (1 − α)·α^k, so newer steps count more. Shared by the long history (days) and the short one
// (hours): the same shape, each with its own numbers (principles 5, 8 DRY).

import type { Run, Shortage } from "./engine";

const weights = (run: Run, alpha: number, steps: number) => run.slice(0, steps).map((v, k) => ({ v, w: (1 - alpha) * alpha ** k }));

/** Null when the run has enough: the step before, and at least `minCoverage` of the weight. */
export function emaShortage(run: Run, alpha: number, steps: number, minCoverage: number, firstName: string): Shortage | null {
  if (run[0] == null) return { have: 0, need: 1, of: firstName };
  const all = weights(run, alpha, steps);
  const total = all.reduce((a, d) => a + d.w, 0);
  const have = all.filter((d) => d.v != null).reduce((a, d) => a + d.w, 0) / total;
  return have >= minCoverage ? null : { have, need: minCoverage, of: "重みの割合" };
}

/** The weighted mean over the steps that have a value. */
export function ema(run: Run, alpha: number, steps: number): number {
  const present = weights(run, alpha, steps).filter((d): d is { v: number; w: number } => d.v != null);
  return present.reduce((a, d) => a + d.w * d.v, 0) / present.reduce((a, d) => a + d.w, 0);
}

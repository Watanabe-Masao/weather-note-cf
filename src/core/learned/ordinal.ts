// 学習あり版の順序モデル (S1, principles 0b): the seven steps as a cumulative logistic around the
// plain version's boundaries, learned from the answers before:
//   P(Y ≤ k) = σ((b_k + shift + δ − F) / s),   δ = a₀ (+ a₁·(F − S) in S1)
// b_k the settings' boundaries, shift the plain seasonal shift (long history L1), F the 肌感 at the
// place answered, S the short history. Only the intercept moves (S1); the slope — the spread s —
// is learned once for all hours. `base` learns a₀ and s alone: S1 must beat it, not only the plain
// version, for the short history to be said to matter.

import { STEPS } from "../evaluate/constants";
import type { Case, Predictor } from "../evaluate/prequential";
import type { Estimate } from "../estimate/engine";
import { HALF, SQUARE, THETA } from "./constants";
import { minimize } from "./optimize";
import { ORDINAL_FIT } from "./params";

export interface OrdinalInputs {
  /** 肌感 at the place answered. */
  feel: Estimate;
  /** The plain seasonal shift of the boundaries. */
  shift: Estimate;
  /** The short history S (same place). */
  short: Estimate;
}

const num = (e: Estimate) => ("value" in e ? e.value : null);
const sigma = (x: number) => 1 / (1 + Math.exp(-x));

/** The seven chances for a centre offset δ and spread s. */
function chances(b: readonly number[], shift: number, feel: number, delta: number, s: number): number[] {
  const cum = b.map((bk) => sigma((bk + shift + delta - feel) / s));
  return Array.from({ length: STEPS }, (_, k) => (k < STEPS - 1 ? cum[k] : 1) - (k > 0 ? cum[k - 1] : 0));
}

export function ordinalPredictor(o: { id: string; thresholds: readonly number[]; useShort: boolean }): Predictor<OrdinalInputs> {
  const v = ORDINAL_FIT.values;
  const read = (x: OrdinalInputs) => {
    const f = num(x.feel), sh = num(x.shift), st = num(x.short);
    if (f == null || sh == null || (o.useShort && st == null)) return null;
    return { f, sh, d: o.useShort ? f - st! : 0 };
  };
  // θ = [a₀, log s, a₁]
  const start = [v.interceptMean.value, Math.log(v.spreadMean.value), v.shortMean.value];
  const prior = (t: number[]) =>
    HALF * ((t[THETA.a0] - v.interceptMean.value) / v.interceptSd.value) ** SQUARE +
    HALF * ((t[THETA.logS] - Math.log(v.spreadMean.value)) / v.spreadLogSd.value) ** SQUARE +
    (o.useShort ? HALF * ((t[THETA.a1] - v.shortMean.value) / v.shortSd.value) ** SQUARE : 0);
  const delta = (t: number[], d: number) => t[THETA.a0] + t[THETA.a1] * d;
  return {
    id: o.id,
    kind: "learned",
    fit: (past: readonly Case<OrdinalInputs>[]) => {
      const data = past.map((c) => ({ x: read(c.inputs), a: c.answer })).filter((d): d is { x: { f: number; sh: number; d: number }; a: number } => d.x != null);
      let t = start;
      if (data.length >= v.minAnswers.value) {
        const loss = (q: number[]) => prior(q) - data.reduce((acc, d) => acc + Math.log(Math.max(Number.MIN_VALUE, chances(o.thresholds, d.x.sh, d.x.f, delta(q, d.x.d), Math.exp(q[THETA.logS]))[d.a])), 0);
        const fitted = minimize(o.useShort ? loss : (q) => loss([...q, 0]), o.useShort ? start : start.slice(0, -1), v.step.value, v.iterations.value, v.tolerance.value);
        t = o.useShort ? fitted : [...fitted, 0];
      }
      return {
        predict: (x) => {
          const r = read(x);
          return r == null ? null : chances(o.thresholds, r.sh, r.f, delta(t, r.d), Math.exp(t[THETA.logS]));
        },
      };
    },
  };
}

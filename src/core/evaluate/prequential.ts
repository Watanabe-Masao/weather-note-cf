// 1歩先の予測で比べる (principles 7, #117): the answers in the order they were given; for each one,
// every predictor learns from the answers strictly before it — never from it or later — then says
// how likely each of the seven steps is, and is scored on what was answered. The plain version
// learns nothing (it is the yardstick); a learned one must beat it here to be used.
//
// Scores (lower is better): RPS — the ranked probability score over the seven steps, fitting an
// ordered answer (one step off costs less than three) — and hits (the most likely step was the
// answer). Differences between two predictors are on the same answers, with a day-block bootstrap
// interval.

import { BOOTSTRAP, MULBERRY, RPS_POWER, SEED, STEPS } from "./constants";

/** One answer, with what the predictors may read of it before it is answered. */
export interface Case<F = unknown> {
  id: string;
  /** When it was answered (ms). */
  at: number;
  /** Its JST date, the block of the bootstrap. */
  date: string;
  /** What was answered: 0 = 寒い … 6 = 暑い. */
  answer: number;
  /** Inputs known at answer time (the materials' estimates): the predictors' only view of the case. */
  inputs: F;
}

/** The chance of each of the seven steps, or null when it cannot say (an input is missing). */
export type Forecast = readonly number[] | null;

export interface Fitted<F> {
  predict: (inputs: F) => Forecast;
}

/** A way to predict (principles 8 LSP: any of them in the same loop). */
export interface Predictor<F> {
  id: string;
  /** "plain" never reads answers; "learned" learns from the past ones it is given. */
  kind: "plain" | "learned";
  /** Learns from the answers before the one to predict (oldest first). */
  fit: (past: readonly Case<F>[]) => Fitted<F>;
}

/** Ranked probability score of one forecast against the answer (0 best, 1 worst). */
export function rps(p: readonly number[], answer: number): number {
  let cumP = 0;
  let sum = 0;
  for (let k = 0; k < STEPS - 1; k++) {
    cumP += p[k];
    const cumO = answer <= k ? 1 : 0;
    sum += (cumP - cumO) ** RPS_POWER;
  }
  return sum / (STEPS - 1);
}

const argmax = (p: readonly number[]) => p.reduce((best, v, k) => (v > p[best] ? k : best), 0);

export interface Scored {
  id: string;
  date: string;
  answer: number;
  /** Per predictor: its forecast and scores, or null when it could not say. */
  by: Record<string, { forecast: readonly number[]; rps: number; hit: boolean } | null>;
}

/**
 * Runs every predictor one step ahead over the cases. Each fit sees only the cases answered before
 * the one predicted (ties in time are not "before": a case never sees one given at the same moment).
 */
export function prequential<F>(cases: readonly Case<F>[], predictors: readonly Predictor<F>[]): Scored[] {
  const sorted = [...cases].sort((a, b) => a.at - b.at);
  return sorted.map((c) => {
    const past = sorted.filter((x) => x.at < c.at);
    const by: Scored["by"] = {};
    for (const pr of predictors) {
      const f = pr.fit(pr.kind === "plain" ? [] : past).predict(c.inputs);
      by[pr.id] = f == null ? null : { forecast: f, rps: rps(f, c.answer), hit: argmax(f) === c.answer };
    }
    return { id: c.id, date: c.date, answer: c.answer, by };
  });
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + MULBERRY.add) | 0;
    let t = Math.imul(a ^ (a >>> MULBERRY.shiftA), 1 | a);
    t = (t + Math.imul(t ^ (t >>> MULBERRY.shiftB), MULBERRY.mulB | t)) ^ t;
    return ((t ^ (t >>> MULBERRY.shiftC)) >>> 0) / MULBERRY.range;
  };
}

export interface Comparison {
  /** Answers both could say something about. */
  n: number;
  days: number;
  rpsA: number;
  rpsB: number;
  hitsA: number;
  hitsB: number;
  /** Mean of RPS(B) − RPS(A) over the same answers: below 0, B is better. */
  diff: number;
  /** Day-block bootstrap interval of `diff`; null with fewer than BOOTSTRAP.minDays days. */
  interval: [number, number] | null;
}

/** A against B on the answers both could say something about. */
export function compareScores(scored: readonly Scored[], a: string, b: string): Comparison {
  const both = scored.filter((s) => s.by[a] && s.by[b]);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
  const d = both.map((s) => s.by[b]!.rps - s.by[a]!.rps);
  const byDay = new Map<string, number[]>();
  both.forEach((s, i) => byDay.set(s.date, [...(byDay.get(s.date) ?? []), d[i]]));
  const blocks = [...byDay.values()];
  let interval: [number, number] | null = null;
  if (blocks.length >= BOOTSTRAP.minDays) {
    const next = rng(SEED);
    const means: number[] = [];
    for (let r = 0; r < BOOTSTRAP.resamples; r++) {
      const pick: number[] = [];
      for (let k = 0; k < blocks.length; k++) pick.push(...blocks[Math.floor(next() * blocks.length)]);
      means.push(mean(pick));
    }
    means.sort((x, y) => x - y);
    const q = (p: number) => means[Math.min(means.length - 1, Math.floor(p * means.length))];
    interval = [q(BOOTSTRAP.lower), q(BOOTSTRAP.upper)];
  }
  return {
    n: both.length,
    days: blocks.length,
    rpsA: mean(both.map((s) => s.by[a]!.rps)),
    rpsB: mean(both.map((s) => s.by[b]!.rps)),
    hitsA: both.filter((s) => s.by[a]!.hit).length,
    hitsB: both.filter((s) => s.by[b]!.hit).length,
    diff: mean(d),
    interval,
  };
}

/**
 * The answers after a learned predictor's warm-up: those with at least `minAnswers` earlier answers
 * it could use (before that it says only its prior). Comparisons that ask whether learning helped
 * are made here; the warm-up answers would only compare priors.
 */
export function afterWarmUp(scored: readonly Scored[], predictorId: string, minAnswers: number): Scored[] {
  let usable = 0;
  const out: Scored[] = [];
  for (const s of scored) {
    if (usable >= minAnswers) out.push(s);
    if (s.by[predictorId]) usable++;
  }
  return out;
}

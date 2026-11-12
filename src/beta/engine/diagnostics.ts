// #117: the checks that tell which part is broken and keep a few answers from fooling us
// (independent review, 2026-11-13). Pure functions; the screens come later (#118).
// Contract: research/comfort-model/mathematical-contract.md (MATH-08).

/** A small seeded generator, so a check gives the same numbers every time it runs. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- residuals for 7-step answers ---------------------------------------------------------------
//
// "answer − expected step" stops at the end steps and its spread changes with the prediction, so a
// slope against a variable is biased. The randomized PIT puts the answer back on a continuous
// scale: u drawn uniformly between P(Y < y) and P(Y ≤ y) of the prediction. If the predictions are
// right, u is uniform on (0, 1) whatever the inputs; the surrogate residual logit(u) is then a
// standard logistic (mean 0), like the model's own latent noise (Liu & Zhang 2018).

/** The randomized PIT of answer y (−3…3) under probabilities over the 7 steps; `u01` in [0, 1). */
export function randomizedPit(probs: number[], y: number, u01: number): number {
  const t = probs.reduce((a, b) => a + b, 0) || 1;
  let below = 0;
  for (let k = 0; k < y + 3; k++) below += probs[k] / t;
  const at = probs[y + 3] / t;
  return Math.min(1 - 1e-9, Math.max(1e-9, below + u01 * at));
}

/** The surrogate residual: + the answer warmer than predicted, − colder (a standard logistic if right). */
export function surrogateResidual(probs: number[], y: number, u01: number): number {
  const u = randomizedPit(probs, y, u01);
  return Math.log(u / (1 - u));
}

/** Counts of PIT values in `bins` equal bins (flat if the predictions are right). */
export function pitHistogram(pits: number[], bins = 10): number[] {
  const c = Array(bins).fill(0);
  for (const p of pits) c[Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))]++;
  return c;
}

// ---- a slope of residuals against a variable ---------------------------------------------------

export interface Slope {
  n: number;
  slope: number;
  se: number;
  /** Two-sided p for slope 0 (normal approximation). */
  p: number;
}

const erfc = (x: number) => {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
};

/** Least-squares slope of residuals r on x, with its standard error and p. Null with fewer than 5 points or no spread in x. */
export function residualSlope(x: number[], r: number[]): Slope | null {
  const pts = x.map((v, i) => [v, r[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const n = pts.length;
  if (n < 5) return null;
  const mx = pts.reduce((s, [a]) => s + a, 0) / n, my = pts.reduce((s, [, b]) => s + b, 0) / n;
  const sxx = pts.reduce((s, [a]) => s + (a - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const slope = pts.reduce((s, [a, b]) => s + (a - mx) * (b - my), 0) / sxx;
  const res = pts.reduce((s, [a, b]) => s + (b - my - slope * (a - mx)) ** 2, 0) / (n - 2);
  const se = Math.sqrt(res / sxx);
  const p = se > 0 ? erfc(Math.abs(slope / se) / Math.SQRT2) : 1;
  return { n, slope, se, p };
}

/**
 * Benjamini–Hochberg: which of the p-values stand at a false discovery rate q. Looking at many
 * variables at once, some slope turns up by chance (20 variables at 5%: one expected); this keeps
 * the share of false flags among the flagged ones about q.
 */
export function falseDiscovery(p: number[], q = 0.1): boolean[] {
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  let cut = -1;
  order.forEach(([v], k) => {
    if (v <= ((k + 1) / p.length) * q) cut = k;
  });
  const keep = Array(p.length).fill(false);
  for (let k = 0; k <= cut; k++) keep[order[k][1]] = true;
  return keep;
}

// ---- comparing two models on the same answers ----------------------------------------------------

/** One answer scored two ways: its day (YYYY-MM-DD, JST) and the RPS of each. */
export interface Pair {
  day: string;
  a: number;
  b: number;
}

export interface PairedDifference {
  n: number;
  days: number;
  /** Mean of a − b (positive: b is better, a lower score being better). */
  mean: number;
  /** 95% interval by the day-block bootstrap. */
  lo: number;
  hi: number;
}

/**
 * The mean difference of two models' scores on the same answers, with a 95% interval from the
 * day-block bootstrap: whole days are drawn again (answers of one day are not independent: the
 * same weather, the same mood), so 1–3 answers a day do not pass for more evidence than they are.
 */
export function pairedDifference(pairs: Pair[], draws = 2000, seed = 1): PairedDifference | null {
  if (!pairs.length) return null;
  const byDay = new Map<string, number[]>();
  for (const p of pairs) {
    const d = p.a - p.b;
    if (!Number.isFinite(d)) continue;
    byDay.set(p.day, [...(byDay.get(p.day) ?? []), d]);
  }
  const days = [...byDay.values()];
  if (!days.length) return null;
  const sumOf = (ds: number[][]) => {
    let s = 0, n = 0;
    for (const d of ds) for (const v of d) (s += v), n++;
    return s / n;
  };
  const mean = sumOf(days);
  const r = seeded(seed);
  const means: number[] = [];
  for (let b = 0; b < draws; b++) {
    const pick: number[][] = [];
    for (let i = 0; i < days.length; i++) pick.push(days[Math.floor(r() * days.length)]);
    means.push(sumOf(pick));
  }
  means.sort((x, y) => x - y);
  const q = (f: number) => means[Math.min(draws - 1, Math.max(0, Math.round(f * (draws - 1))))];
  return { n: days.reduce((s, d) => s + d.length, 0), days: days.length, mean, lo: q(0.025), hi: q(0.975) };
}

// ---- the rule for adopting a candidate (MATH-08, fixed before comparing) ------------------------

export const ADOPTION = { answers: 50, days: 20, seasonGap: 10 } as const;

export interface AdoptionInput {
  diff: PairedDifference | null;
  /** The 1-month mean temperatures (℃) the compared answers span: min and max. */
  seasonMin?: number | null;
  seasonMax?: number | null;
  /** Whether the candidate's effect depends on the season (慣れ, the base layer's sun). */
  seasonal: boolean;
}

/** Whether a candidate meets MATH-08's rule, and the reasons it does not. */
export function adoptionCheck(c: AdoptionInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const d = c.diff;
  if (!d) return { ok: false, reasons: ["比べた答えがない"] };
  if (d.n < ADOPTION.answers) reasons.push(`答えが ${d.n} 件（${ADOPTION.answers} 件以上が要る）`);
  if (d.days < ADOPTION.days) reasons.push(`日数が ${d.days} 日（${ADOPTION.days} 日以上が要る）`);
  if (c.seasonal) {
    const gap = c.seasonMin != null && c.seasonMax != null ? c.seasonMax - c.seasonMin : 0;
    if (gap < ADOPTION.seasonGap) reasons.push(`季節の幅が ${gap.toFixed(1)}℃（1か月の平均で ${ADOPTION.seasonGap}℃ 以上違う時期を含むことが要る）`);
  }
  if (!(d.lo > 0)) reasons.push(`差の95%区間 ${d.lo.toFixed(4)}〜${d.hi.toFixed(4)} が 0 を含む（または候補の方が悪い）`);
  return { ok: reasons.length === 0, reasons };
}

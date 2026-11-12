// MATH-09 (#63 P3): the preference models — which way a person wants to feel, and which drink
// temperature they would choose — each its own per-person multinomial logistic model over three
// answers (−1, 0, +1; D13). Separate from the feeling model (comfort-4), which it never changes.
// Contract: research/comfort-model/mathematical-contract.md (MATH-09)
//
// Two predictions, judged apart:
//   - "before": from the weather of the moment only (the place temperature E′ and the recent
//     baseline a) — what can be said before the person answers anything;
//   - "with feeling": the same plus the 7-step feeling Y of the same report. Its score is never
//     reported as the "before" score.
//
// Reports made in a row weigh less (MATH-05, #62), and older reports can weigh less (a half-life,
// compared on synthetic people; research/comfort-model/preference-synth.ts). Not shown in the app
// yet (P4): fitting and evaluation, and when an index may be shown, are decided separately.

import { bfgs, burstWeights, drawsOf, laplace, type ModelFit, placeTempOf } from "./comfort";
import { inputQuality } from "./quality";
import { PREFERENCE_SCORE, type PreferenceScore } from "./preference";
import type { Report } from "./reports";

export type PreferenceKind = "thermal" | "drink";

export interface PrefObs {
  /** Place temperature E′ (℃), recent baseline a (℃), the feeling of the same report (−3…+3). */
  e: number;
  a: number;
  y: number;
  /** The answer, −1 / 0 / +1. */
  k: PreferenceScore;
  /** When (ms) and the weight for reports in a row. */
  t: number;
  w: number;
}

export interface PrefOptions {
  withFeeling: boolean;
  /** Older reports weigh 2^(−age/halfLife); null: every report the same. */
  halfLifeDays: number | null;
  /** The moment the ages are counted from (ms). */
  now: number;
}

/** The settings in use. A half-life of 30 days helped a person who changes a little (RPS 0.124 →
 *  0.119) and cost a steady person less (0.127 → 0.128; preference-synth-results.md): too close to
 *  call, so none for now, to be compared again on real answers. */
export const PREF_DEFAULT = { halfLifeDays: null as number | null };

/** Prior sd of every coefficient on the standardised inputs (weak: answers soon outweigh it). */
export const PREF_PRIOR_SD = 1.5;

const features = (o: { e: number; a: number; y: number }, withFeeling: boolean) => (withFeeling ? [1, (o.e - 20) / 5, (o.a - 15) / 5, o.y / 3] : [1, (o.e - 20) / 5, (o.a - 15) / 5]);

/** P(−1), P(0), P(+1) for one moment; θ holds the −1 side's and the +1 side's coefficients (0 is the reference). */
export function prefProbs(theta: number[], u: number[]): [number, number, number] {
  const d = u.length;
  const zm = u.reduce((s, v, i) => s + v * theta[i], 0);
  const zp = u.reduce((s, v, i) => s + v * theta[d + i], 0);
  const m = Math.max(zm, 0, zp);
  const a = Math.exp(zm - m);
  const b = Math.exp(-m);
  const c = Math.exp(zp - m);
  const t = a + b + c;
  return [a / t, b / t, c / t];
}

export interface PrefFit {
  theta: number[];
  cov: number[][] | null;
  withFeeling: boolean;
  /** Reports used, and their weighted count (the evidence there is). */
  n: number;
  nEff: number;
}

function weightsOf(obs: PrefObs[], opt: PrefOptions): number[] {
  return obs.map((o) => o.w * (opt.halfLifeDays == null ? 1 : 2 ** (-(opt.now - o.t) / (opt.halfLifeDays * 86_400_000))));
}

export function fitPreference(obs: PrefObs[], opt: PrefOptions): PrefFit {
  const dim = opt.withFeeling ? 4 : 3;
  const w = weightsOf(obs, opt);
  const us = obs.map((o) => features(o, opt.withFeeling));
  const f = (th: number[]) => {
    let v = th.reduce((s, x) => s + (x / PREF_PRIOR_SD) ** 2 / 2, 0);
    for (let i = 0; i < obs.length; i++) v -= w[i] * Math.log(Math.max(prefProbs(th, us[i])[obs[i].k + 1], 1e-12));
    return v;
  };
  const theta = obs.length ? bfgs(f, Array(2 * dim).fill(0)) : Array(2 * dim).fill(0);
  const lap = obs.length ? laplace(f, theta) : null;
  return { theta, cov: lap?.cov ?? null, withFeeling: opt.withFeeling, n: obs.length, nEff: w.reduce((a, b) => a + b, 0) };
}

export interface PrefPrediction {
  /** Posterior predictive P(−1), P(0), P(+1) (parameter uncertainty integrated by draws). */
  probs: [number, number, number];
  /** P(+1) − P(−1), and its 95% interval over the draws. */
  index: number;
  indexInterval: [number, number];
}

export function predictPreference(fit: PrefFit, x: { e: number; a: number; y?: number }, draws = 200): PrefPrediction {
  const u = features({ ...x, y: x.y ?? 0 }, fit.withFeeling);
  const asFit = { theta: fit.theta, cov: fit.cov, prior: { sd: fit.theta.map(() => PREF_PRIOR_SD) } } as unknown as ModelFit;
  const ps = drawsOf(asFit, draws, 9).map((th) => prefProbs(th, u));
  const probs = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length) as [number, number, number];
  const idx = ps.map((p) => p[2] - p[0]).sort((a, b) => a - b);
  return { probs, index: probs[2] - probs[0], indexInterval: [idx[Math.floor(0.025 * idx.length)], idx[Math.ceil(0.975 * idx.length) - 1]] };
}

/** When a model may be fitted and evaluated, and when its index may be shown (MATH-09). The
 *  numbers were set on synthetic people (preference-synth.ts) and are provisional. */
export const PREF_RULES = {
  /** Weighted answers needed to fit and to start judging predictions made in advance. */
  minFitEff: 8,
  /** Weighted answers needed before an index is shown. */
  minShowEff: 20,
  /** Different answers needed (one answer only says nothing about when it changes). */
  minCategories: 2,
  /** Place temperatures the answers span (℃). */
  minSpan: 5,
  /** The index's 95% interval at most this wide to be shown. */
  maxIndexWidth: 0.8,
} as const;

export interface PrefLearning {
  fit: boolean;
  show: boolean;
  /** What is still missing for showing, in words. */
  missing: string[];
}

export function preferenceLearning(obs: PrefObs[], fit: PrefFit, at: PrefPrediction | null): PrefLearning {
  const missing: string[] = [];
  const cats = new Set(obs.map((o) => o.k)).size;
  const es = obs.map((o) => o.e);
  const span = es.length ? Math.max(...es) - Math.min(...es) : 0;
  const fitOk = fit.nEff >= PREF_RULES.minFitEff && cats >= PREF_RULES.minCategories;
  if (fit.nEff < PREF_RULES.minShowEff) missing.push(`答え（今 ${fit.nEff.toFixed(1)}件分、${PREF_RULES.minShowEff}件分以上）`);
  if (cats < PREF_RULES.minCategories) missing.push("2種類以上の答え");
  if (span < PREF_RULES.minSpan) missing.push(`温度の幅（今 ${span.toFixed(1)}℃、${PREF_RULES.minSpan}℃以上）`);
  if (at && at.indexInterval[1] - at.indexInterval[0] > PREF_RULES.maxIndexWidth)
    missing.push(`指数の幅（今 ${(at.indexInterval[1] - at.indexInterval[0]).toFixed(2)}、${PREF_RULES.maxIndexWidth}以下）`);
  return { fit: fitOk, show: fitOk && missing.length === 0, missing };
}

/** The answers of one question in a person's reports, ready for the model (trainable reports only). */
export function preferenceObservations(reports: Report[], kind: PreferenceKind): PrefObs[] {
  const answered = reports.filter((r) => !r.deleted && inputQuality(r).trainable && (kind === "thermal" ? r.thermalPreference : r.drinkPreference));
  // Only reports the model can read join runs (as observationsOf does for the feeling model).
  const used = answered.filter((r) => placeTempOf(r) != null && r.baseline?.value != null);
  const w = burstWeights(used.map((r) => Date.parse(r.at)));
  return used.map((r, i) => ({
    e: placeTempOf(r)!,
    a: r.baseline!.value,
    y: r.sensation,
    k: kind === "thermal" ? PREFERENCE_SCORE.thermal[r.thermalPreference!] : PREFERENCE_SCORE.drink[r.drinkPreference!],
    t: Date.parse(r.at),
    w: w[i],
  }));
}

/** 3-category RPS (0 best). */
export function prefRps(p: [number, number, number], k: PreferenceScore): number {
  const c1 = p[0] - (k === -1 ? 1 : 0);
  const c2 = p[0] + p[1] - (k <= 0 ? 1 : 0);
  return (c1 * c1 + c2 * c2) / 2;
}

// MATH-08: scores and track records of predictions made in advance.
// Contract: research/comfort-model/mathematical-contract.md

import { type Report, SCALE_VERSION } from "../reports";
import { MODELS } from "./model";

/** Ranked probability score of one prediction (0 best; the 7 steps' order counts). */
export function rps(probs: number[], y: number): number {
  let cp = 0;
  let s = 0;
  for (let k = 0; k < 6; k++) {
    cp += probs[k];
    const co = y + 3 <= k ? 1 : 0;
    s += (cp - co) ** 2;
  }
  return s / 6;
}

/** The reference a prediction must beat: the person's earlier answers' frequencies (add-one). */
export function referenceProbs(earlier: number[]): number[] {
  const c = Array(7).fill(1);
  for (const y of earlier) c[y + 3] += 1;
  const t = c.reduce((a, b) => a + b, 0);
  return c.map((v) => v / t);
}


/** Answer − expected, averaged over the latest DRIFT_N predictions: past ±DRIFT_LIMIT steps the
 *  person may have changed (#35: a +3 ℃ change found 10/10, no false alarm 0/10). */
export const DRIFT_N = 10;
export const DRIFT_LIMIT = 0.5;

/** Bins of predicted probability for the calibration table. */
export const CALIBRATION_BINS: [number, number][] = [
  [0, 0.1],
  [0.1, 0.3],
  [0.3, 0.5],
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 1.0001],
];

export interface CalibrationBin {
  lo: number;
  hi: number;
  /** How many (prediction, side) pairs fell in the bin. */
  n: number;
  /** Mean predicted probability, and how often it actually happened. */
  predicted: number | null;
  observed: number | null;
}

export interface TrackRecord {
  n: number;
  /** Mean RPS (main score; 0 best) and the reference's on the same answers, and the skill
   *  1 − RPS / reference (above 0: better than the person's earlier answers' frequencies). */
  rps: number | null;
  refRps: number | null;
  skill: number | null;
  /** Mean −log P(answer): lower is better (log 7 ≈ 1.95 is a blind guess). */
  logLoss: number | null;
  /** Share answered exactly the most likely step. */
  hit: number | null;
  /** Mean of answer − expected (+: felt warmer than predicted). */
  bias: number | null;
  /** Mean |answer − expected|, overall and for the latest 10. */
  mae: number | null;
  recentMae: number | null;
  /** Mean answer − expected over the latest DRIFT_N, and whether it is past ±DRIFT_LIMIT. */
  recentBias: number | null;
  drifting: boolean;
  /** Calibration of the three sides (寒い側・ちょうどよい・暑い側): predicted vs happened. */
  calibration: CalibrationBin[];
  /** The scores in order of time, every 10 predictions (does learning make them better?). */
  series: { from: string; to: string; n: number; rps: number; refRps: number }[];
  /** Predictions left out because they were answered on another scale version. */
  otherScale: number;
  /** The same means unrounded, for pooling across people (the rounded ones are for display; #86). */
  raw: { rps: number | null; refRps: number | null; skill: number | null; logLoss: number | null; hit: number | null; bias: number | null; mae: number | null };
}

const mean = (xs: number[], d = 1) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10 ** d) / 10 ** d : null);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const avgOrNull = (xs: number[]) => (xs.length ? avg(xs) : null);

interface Item {
  y: number;
  probs: number[];
  mode: number;
  at: string;
  earlier: number[];
}

function recordOf(items: Item[], otherScale: number): TrackRecord {
  const exp = (p: number[]) => p.reduce((s, v, k) => s + v * (k - 3), 0);
  const rpsOf = items.map((d) => rps(d.probs, d.y));
  const refOf = items.map((d) => rps(referenceProbs(d.earlier), d.y));
  const r = items.length ? avg(rpsOf) : null;
  const ref = items.length ? avg(refOf) : null;
  const recent = items.slice(-DRIFT_N).map((d) => d.y - exp(d.probs));
  const recentBias = recent.length >= DRIFT_N ? avg(recent) : null;
  const pairs = items.flatMap((d) => {
    const sides = [d.probs.slice(0, 3), d.probs.slice(3, 4), d.probs.slice(4)].map((ps) => ps.reduce((a, b) => a + b, 0));
    const side = d.y < 0 ? 0 : d.y === 0 ? 1 : 2;
    return sides.map((p, k) => ({ p, hit: k === side ? 1 : 0 }));
  });
  const series: TrackRecord["series"] = [];
  for (let i = 0; i < items.length; i += 10) {
    const chunk = items.slice(i, i + 10);
    series.push({ from: chunk[0].at, to: chunk[chunk.length - 1].at, n: chunk.length, rps: round3(avg(rpsOf.slice(i, i + 10))), refRps: round3(avg(refOf.slice(i, i + 10))) });
  }
  const raw: TrackRecord["raw"] = {
    rps: r,
    refRps: ref,
    skill: r == null || !ref ? null : 1 - r / ref,
    logLoss: avgOrNull(items.map((d) => -Math.log(Math.max(d.probs[d.y + 3], 1e-3)))),
    hit: avgOrNull(items.map((d) => (d.mode === d.y ? 1 : 0))),
    bias: avgOrNull(items.map((d) => d.y - exp(d.probs))),
    mae: avgOrNull(items.map((d) => Math.abs(d.y - exp(d.probs)))),
  };
  return {
    raw,
    n: items.length,
    rps: r == null ? null : round3(r),
    refRps: ref == null ? null : round3(ref),
    skill: r == null || !ref ? null : Math.round((1 - r / ref) * 100) / 100,
    logLoss: mean(items.map((d) => -Math.log(Math.max(d.probs[d.y + 3], 1e-3))), 2),
    hit: mean(items.map((d) => (d.mode === d.y ? 1 : 0)), 2),
    bias: mean(items.map((d) => d.y - exp(d.probs))),
    mae: mean(items.map((d) => Math.abs(d.y - exp(d.probs)))),
    recentMae: mean(items.slice(-10).map((d) => Math.abs(d.y - exp(d.probs)))),
    recentBias: recentBias == null ? null : Math.round(recentBias * 100) / 100,
    drifting: recentBias != null && Math.abs(recentBias) > DRIFT_LIMIT,
    calibration: CALIBRATION_BINS.map(([lo, hi]) => {
      const inBin = pairs.filter((x) => x.p >= lo && x.p < hi);
      return {
        lo,
        hi: Math.min(hi, 1),
        n: inBin.length,
        predicted: inBin.length ? round3(avg(inBin.map((x) => x.p))) : null,
        observed: inBin.length ? round3(avg(inBin.map((x) => x.hit))) : null,
      };
    }),
    series,
    otherScale,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The predictions to judge: made at sending (never refitted afterwards, MATH-06), on the current
 * scale version only — the same number asked in other words is another question (MATH-01).
 */
function judged(reports: Report[]) {
  const live = reports.filter((r) => !r.deleted && r.comfort).sort((a, b) => (a.at < b.at ? -1 : 1));
  const same = live.filter((r) => (r.scaleVersion ?? 1) === SCALE_VERSION);
  return { same, otherScale: live.length - same.length };
}

const itemsOf = (list: Report[], probsOf: (r: Report) => { probs: number[]; mode: number } | undefined): Item[] =>
  list
    .map((r, i) => ({ r, p: probsOf(r), earlier: list.slice(0, i).map((x) => x.sensation as number) }))
    .filter((x) => x.p)
    .map(({ r, p, earlier }) => ({ y: r.sensation, probs: p!.probs, mode: p!.mode, at: r.at, earlier }));

/** The record of the combined predictions as they were made at sending. */
export function trackRecord(reports: Report[]): TrackRecord {
  const { same, otherScale } = judged(reports);
  return recordOf(
    itemsOf(same, (r) => r.comfort),
    otherScale,
  );
}

/** Each model's own record, from the predictions it made at sending. */
export function modelRecords(reports: Report[]): Record<string, TrackRecord> {
  const { same, otherScale } = judged(reports);
  const out: Record<string, TrackRecord> = {};
  for (const m of MODELS) out[m.id] = recordOf(itemsOf(same, (r) => r.comfort!.models?.find((x) => x.id === m.id)), otherScale);
  return out;
}

// MATH-08: scores and track records of predictions made in advance.
// Contract: research/comfort-model/mathematical-contract.md

import type { Report } from "../reports";
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

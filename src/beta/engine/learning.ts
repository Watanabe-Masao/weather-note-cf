// MATH-07: how far the learning has got.
// Contract: research/comfort-model/mathematical-contract.md

import { type Report, SCALE_VERSION } from "../reports";
import { type Ensemble } from "./ensemble";
import { type Observation } from "./estimation";
import { referenceProbs, rps } from "./evaluation";
import { observationsOf } from "./observations";
import { type Learning, muIntervalOf } from "./prediction";
import { r1 } from "./util";

//
// Not a count of reports: a centre can be found only when the answers lie on both sides of ちょうどよい,
// over a spread of temperatures, on several days, and the interval of μ is narrow. Verified needs
// the predictions made in advance to beat a plain reference. The thresholds are provisional: they
// are to be set from the data once there is some (README 8).

export const LEARNING_RULES = {
  /** The answers' place temperatures must span at least this (℃). */
  minSpan: 5,
  /** Reports on at least this many different days. */
  minDays: 3,
  /** The 95% interval of μ at most this wide (℃) to be testable. */
  maxMuWidth: 4,
  /** Predictions made while testable, needed before verdict. */
  minChecked: 20,
} as const;

export const LEARNING_LABELS: Record<Learning, string> = {
  untrained: "未学習",
  sparse: "情報不足",
  provisional: "暫定",
  testable: "検証可能",
  verified: "検証済み",
};

export interface LearningView {
  state: Learning;
  /** What is still missing, in words (empty when nothing is). */
  missing: string[];
  muInterval: [number, number] | null;
}


export function learningOf(reports: Report[], ens: Ensemble): LearningView {
  const live = reports.filter((r) => !r.deleted).sort((a, b) => (a.at < b.at ? -1 : 1));
  // Judged the same way as the track record (evaluation.ts): on the current scale version only.
  const same = live.filter((r) => (r.scaleVersion ?? 1) === SCALE_VERSION);
  const checked = same
    .map((r, i) => ({ r, earlier: same.slice(0, i).map((x) => x.sensation as number) }))
    .filter(({ r }) => r.comfort && (r.comfort.learning === "testable" || r.comfort.learning === "verified"))
    .map(({ r, earlier }) => ({ probs: r.comfort!.probs, y: r.sensation as number, earlier }));
  return learningFrom(observationsOf(reports, ens.alpha), new Set(live.map((r) => r.at.slice(0, 10))).size, checked, ens);
}

/** The rule itself, on observations (testable without whole reports). */
export function learningFrom(obs: Observation[], days: number, checked: { probs: number[]; y: number; earlier: number[] }[], ens: Ensemble): LearningView {
  if (!obs.length) return { state: "untrained", missing: ["感じ方の記録がまだありません"], muInterval: null };
  const missing: string[] = [];
  const ys = obs.map((o) => o.y);
  if (!ys.some((y) => y < 0) || !ys.some((y) => y > 0)) missing.push("ちょうどよいより寒い側と暑い側の両方の答え");
  const es = obs.map((o) => o.e);
  const span = Math.max(...es) - Math.min(...es);
  if (span < LEARNING_RULES.minSpan) missing.push(`温度の幅（今 ${r1(span)}℃、${LEARNING_RULES.minSpan}℃以上）`);
  if (days < LEARNING_RULES.minDays) missing.push(`記録した日（今 ${days}日、${LEARNING_RULES.minDays}日以上）`);
  const muInterval = muIntervalOf(ens, obs[obs.length - 1]);
  if (missing.length) return { state: "sparse", missing, muInterval };
  const width = muInterval[1] - muInterval[0];
  if (width > LEARNING_RULES.maxMuWidth) return { state: "provisional", missing: [`ちょうどよい温度の幅（今 ${r1(width)}℃、${LEARNING_RULES.maxMuWidth}℃以下）`], muInterval };
  // Verified: predictions made in advance while testable, better (RPS) than the plain reference.
  if (checked.length < LEARNING_RULES.minChecked)
    return { state: "testable", missing: [`検証用の予測（今 ${checked.length}件、${LEARNING_RULES.minChecked}件以上）`], muInterval };
  const model = checked.reduce((s, c) => s + rps(c.probs, c.y), 0) / checked.length;
  const ref = checked.reduce((s, c) => s + rps(referenceProbs(c.earlier), c.y), 0) / checked.length;
  return model < ref ? { state: "verified", missing: [], muInterval } : { state: "testable", missing: ["過去の答えの割合より当たる予測"], muInterval };
}

/** States where the person's centre is not yet known: show the distribution, not a centre. */
export const centreUnknown = (s: Learning | undefined) => s === "untrained" || s === "sparse";

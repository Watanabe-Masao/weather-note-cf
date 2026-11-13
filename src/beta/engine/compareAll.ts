// #117: every candidate on the SAME answers (the review of 2026-11-13, "共通評価集合").
//
// Comparing two at a time lets each pair use different answers (whichever both could predict), so
// A–B and B–C are not on the same footing. Here:
//   E   the answers judged at all (same answer words, not deleted, a whole-step answer)
//   V_m the answers candidate m had a prediction for (coverage = |V_m| / |E|)
//   C   the answers every candidate had a prediction for: the main comparison
// with how much each candidate had learned at each answer, so a candidate still at its prior is
// shown as such and never adopted (MATH-08).
//
// Two sources of predictions:
//   - stored: the models in the app (M0…M9), the mixed prediction and the shared constants (従来版),
//     from what was predicted at sending (each report keeps every model's own prediction): nothing
//     is refitted.
//   - rolling origin: candidates not in the app (#113, #114, the UTCI base…), refitted on the
//     answers strictly before each one (at < the answer's at: answers of the same moment never
//     teach each other), for research scripts.

import { type Report, SCALE_VERSION } from "../reports";
import { sharedPrediction } from "./checks";
import { adoptionCheck, type PairedDifference, pairedDifference } from "./diagnostics";
import { rps } from "./evaluation";
import { MODELS } from "./model";
import { placeTempOf } from "./observations";

/** Probabilities below this count as this for the log loss only (the distribution itself is not changed). */
export const LOG_FLOOR = 1e-3;
/** A candidate that had learned from fewer records than this at an answer is "few" there. */
export const MIN_LEARNED = 10;

/** −log of the probability given to the answer (normalised; floored at LOG_FLOOR for the log only). */
export function logLoss(probs: number[], y: number): number {
  const t = probs.reduce((a, b) => a + b, 0) || 1;
  return -Math.log(Math.max(LOG_FLOOR, (probs[y + 3] ?? 0) / t));
}

export type LearnState = "learned" | "few" | "priorOnly" | "unknown";
export const LEARN_LABELS: Record<LearnState, string> = { learned: "学習済み", few: "学習が少ない", priorOnly: "事前のまま（学習 0 件）", unknown: "学習件数の記録なし" };

export interface CandidateScore {
  id: string;
  label: string;
  /** Answers it had a prediction for, and that share of E. */
  predicted: number;
  coverage: number;
  /** On the common answers C: mean RPS and log loss. */
  rps: number | null;
  logLoss: number | null;
  /** On its own answers V_m (a side view: not comparable across candidates). */
  rpsOwn: number | null;
  /** Part of the common set: false when its coverage was below the minimum (then only rpsOwn). */
  inCommon: boolean;
  /** How much it had learned at the common answers: counts per state, and the state that rules (the worst). */
  learn: Record<LearnState, number>;
  state: LearnState;
}

export interface Row {
  id: string;
  day: string;
  at: string;
  a: number | null;
  scores: Record<string, { rps: number; logLoss: number }>;
}

export interface Comparison {
  /** |E| and |C|, and the days and the season (1-month mean, min–max) C spans. */
  eligible: number;
  commonN: number;
  commonDays: number;
  season: { min: number; max: number } | null;
  candidates: CandidateScore[];
  rows: Row[];
}

/** One candidate's prediction at an answer: its probabilities, and how many records it had learned from (null: not known). */
export interface Prediction {
  probs: number[];
  learned: number | null;
}

const jstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);

const stateOf = (learned: number | null): LearnState => (learned == null ? "unknown" : learned === 0 ? "priorOnly" : learned < MIN_LEARNED ? "few" : "learned");
const WORST: LearnState[] = ["priorOnly", "unknown", "few", "learned"];

/** The answers judged at all (E), oldest first; ties keep their id order so the result does not depend on the input order. */
export function eligibleOf(reports: Report[]): Report[] {
  return reports
    .filter((r) => !r.deleted && (r.scaleVersion ?? 1) === SCALE_VERSION && Number.isInteger(r.sensation))
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1));
}

/** Builds the comparison from each candidate's predictions at the answers of E (null: none there). */
export function compareOn(
  eligible: Report[],
  candidates: { id: string; label: string; at: (r: Report, i: number) => Prediction | null }[],
  /** Candidates predicting fewer than this share of E are left out of the common set (shown with their own answers only). */
  minCoverage = 0,
): Comparison {
  const preds = candidates.map((c) => eligible.map((r, i) => c.at(r, i)));
  const cover = preds.map((p) => (eligible.length ? p.filter((v) => v != null).length / eligible.length : 0));
  const inC = cover.map((v) => v >= minCoverage && v > 0);
  const common = eligible.map((_, i) => preds.every((p, k) => !inC[k] || p[i] != null) && inC.some(Boolean));
  const rows: Row[] = [];
  eligible.forEach((r, i) => {
    if (!common[i]) return;
    const y = r.sensation as number;
    const scores: Row["scores"] = {};
    candidates.forEach((c, k) => {
      if (!inC[k]) return;
      const p = preds[k][i]!;
      scores[c.id] = { rps: rps(p.probs, y), logLoss: logLoss(p.probs, y) };
    });
    rows.push({ id: r.id, day: jstDay(r.at), at: r.at, a: r.baseline?.value ?? null, scores });
  });
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const scores = candidates.map((c, k): CandidateScore => {
    const own = eligible.map((r, i) => (preds[k][i] ? rps(preds[k][i]!.probs, r.sensation as number) : null)).filter((v): v is number => v != null);
    const learn: Record<LearnState, number> = { learned: 0, few: 0, priorOnly: 0, unknown: 0 };
    eligible.forEach((_, i) => {
      if (common[i] && inC[k]) learn[stateOf(preds[k][i]!.learned)]++;
    });
    return {
      id: c.id,
      label: c.label,
      predicted: own.length,
      coverage: eligible.length ? own.length / eligible.length : 0,
      rps: inC[k] ? mean(rows.map((row) => row.scores[c.id].rps)) : null,
      logLoss: inC[k] ? mean(rows.map((row) => row.scores[c.id].logLoss)) : null,
      rpsOwn: mean(own),
      inCommon: inC[k],
      learn,
      state: inC[k] ? (WORST.find((s) => learn[s] > 0) ?? "learned") : "unknown",
    };
  });
  const as = rows.map((r) => r.a).filter((v): v is number => v != null);
  return {
    eligible: eligible.length,
    commonN: rows.length,
    commonDays: new Set(rows.map((r) => r.day)).size,
    season: as.length ? { min: Math.min(...as), max: Math.max(...as) } : null,
    candidates: scores,
    rows,
  };
}

/** In the app's view, a candidate predicting fewer than this share of the answers is left out of the common set. */
export const COMMON_MIN_COVERAGE = 0.8;

/** The stored candidates: 従来版 (shared constants), the mixed prediction, and each model in the app. */
export function compareStored(reports: Report[], ids?: string[], minCoverage = 0): Comparison {
  const all = [
    {
      id: "shared",
      label: "従来版のまま",
      at: (r: Report): Prediction | null => {
        const e = placeTempOf(r), a = r.baseline?.value;
        return e != null && a != null ? { probs: sharedPrediction(e, a), learned: Infinity } : null;
      },
    },
    { id: "mixed", label: "混ぜた予測", at: (r: Report): Prediction | null => (r.comfort ? { probs: r.comfort.probs, learned: r.comfort.n ?? null } : null) },
    ...MODELS.map((m) => ({
      id: m.id,
      label: `${m.id} ${m.name}`,
      at: (r: Report): Prediction | null => {
        const p = r.comfort?.models?.find((x) => x.id === m.id);
        return p ? { probs: p.probs, learned: p.n ?? null } : null;
      },
    })),
  ];
  const chosen = ids ? all.filter((c) => ids.includes(c.id)) : all;
  return compareOn(eligibleOf(reports), chosen, minCoverage);
}

/**
 * Rolling origin for candidates not in the app: each answer predicted by `fit` from the answers
 * strictly before it (at < its at), from the `start`-th answer on. `fit` returns null when it cannot
 * predict that answer (an input missing); `learned` is how many records it learned from.
 */
export function compareRolling(
  reports: Report[],
  candidates: { id: string; label: string; fit: (past: Report[], r: Report) => Prediction | null }[],
  start = 3,
): Comparison {
  const e = eligibleOf(reports);
  return compareOn(
    e,
    candidates.map((c) => ({
      id: c.id,
      label: c.label,
      at: (r: Report, i: number) => {
        if (i < start) return null;
        const past = e.filter((q) => q.at < r.at);
        return c.fit(past, r);
      },
    })),
  );
}

/** A against B on the common answers (RPS): the paired difference with the day-block interval. */
export function pairOf(c: Comparison, a: string, b: string): PairedDifference | null {
  return pairedDifference(c.rows.map((r) => ({ day: r.day, a: r.scores[a].rps, b: r.scores[b].rps })));
}

/**
 * MATH-08 for candidate `b` against the one in use `a`, on the common answers: the rule's numbers,
 * plus that the candidate had learned (not at its prior, nor too few, nor unknown) at every answer,
 * and that its log loss is not worse (the RPS can improve while some answers get almost no probability).
 */
export function adoptionOn(c: Comparison, a: string, b: string, seasonal: boolean): { ok: boolean; reasons: string[] } {
  const base = adoptionCheck({ diff: pairOf(c, a, b), seasonal, seasonMin: c.season?.min, seasonMax: c.season?.max });
  const reasons = [...base.reasons];
  const cand = c.candidates.find((x) => x.id === b);
  if (cand && cand.state !== "learned") reasons.push(`候補が${LEARN_LABELS[cand.state]}の答えを含む（学習済みの答えだけで比べる必要がある）`);
  const now = c.candidates.find((x) => x.id === a);
  if (cand?.logLoss != null && now?.logLoss != null && cand.logLoss > now.logLoss) reasons.push(`対数損失が悪くなる（${now.logLoss.toFixed(3)} → ${cand.logLoss.toFixed(3)}）`);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

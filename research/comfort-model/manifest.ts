// #47: the record of one model experiment (research/comfort-model/experiments/<id>.json), and the
// rules a model must pass to be used in the app. A model is adopted by hand, never by its score
// alone; the record makes the decision possible to check and to repeat.

export interface Manifest {
  id: string;
  date: string;
  /** The model under test (MODEL_VERSION) and the scale version of the answers it was judged on. */
  modelVersion: string;
  scaleVersion: number;
  /** The code (git commit) the experiment ran on. */
  commit: string;
  dataset: {
    id: string;
    /** Hash of the data as used (sha256 of the exported file, or of the generator and seed). */
    hash: string;
    kind: "synthetic" | "real";
    /** The evaluation period (answers judged), and how many were judged. */
    period: { from: string; to: string } | null;
    n: number;
    /** Left out, by reason (quality.ts), with counts. */
    excluded: Record<string, number>;
  };
  seed: number | null;
  settings: { prior: string; optimiser: string; alpha: string };
  /** Models compared (ids and versions). */
  compared: string[];
  results: { rps: number | null; logLoss: number | null; skill: number | null; calibration: string | null; notes: string };
  /** The checklist of #47: each item true (passed), false (failed) or a string saying why not applicable. */
  checks: Record<(typeof CHECKS)[number], boolean | string>;
  /** "pending": a candidate waiting for 渡辺さん's approval (D10); the app cannot use it until adopted. */
  decision: "adopted" | "rejected" | "pending";
  reason: string;
  approvedBy: string;
}

export const CHECKS = [
  /** Probabilities sum to 1, the edges are in order, parameters keep their constraints. */
  "mathematical",
  /** Synthetic data: recovers what can be recovered, says when it cannot (synthetic.ts). */
  "recovery",
  /** Prediction scores on the same data and period as the model in use (RPS main, log loss). */
  "performance",
  /** Predicted probabilities match how often things happened. */
  "calibration",
  /** Few reports, missing inputs, extreme weather: no breakdown. */
  "stability",
  /** Past answers, predictions and scale versions are not misread; MODEL_VERSION raised. */
  "compatibility",
  /** The contract (mathematical-contract.md) and its change log are updated. */
  "contract",
] as const;

/** What is wrong with a manifest (empty: fine). */
export function problems(m: Partial<Manifest>): string[] {
  const out: string[] = [];
  const need = (k: keyof Manifest) => m[k] == null && out.push(`${k} がない`);
  (["id", "date", "modelVersion", "scaleVersion", "commit", "dataset", "settings", "compared", "results", "checks", "decision", "reason", "approvedBy"] as const).forEach(need);
  if (m.dataset) {
    if (!m.dataset.hash) out.push("dataset.hash がない");
    if (m.dataset.n == null) out.push("dataset.n がない");
    if (m.dataset.excluded == null) out.push("dataset.excluded がない");
    if (m.dataset.kind === "real" && !m.dataset.period) out.push("実データなのに評価の期間がない");
  }
  if (m.checks) for (const c of CHECKS) if (!(c in m.checks)) out.push(`checks.${c} がない`);
  if (m.decision === "adopted" && m.checks && Object.values(m.checks).some((v) => v === false)) out.push("不合格の項目があるのに採用している");
  if (m.decision && m.decision !== "adopted" && m.decision !== "rejected" && m.decision !== "pending") out.push("decision は adopted・rejected・pending のどれか");
  return out;
}

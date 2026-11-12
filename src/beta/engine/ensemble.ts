// MATH-05: the models together — fitting all, weighing them, and weights at a moment.
// Contract: research/comfort-model/mathematical-contract.md

import type { Report } from "../reports";
import { type Drivers } from "./drivers";
import { fitModel, type ModelFit, type Observation } from "./estimation";
import { MODELS, usable } from "./model";
import { observationsOf } from "./observations";

export const ALPHA_GRID = [0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
export const STANDARD_ALPHA = 0.8;
export const MIN_FOR_ALPHA = 30;

export interface Ensemble {
  alpha: number;
  fits: ModelFit[];
  /** Posterior model weights (equal prior over models), from the evidence. */
  weights: number[];
  n: number;
}

function weightsOf(fits: ModelFit[]): number[] {
  const top = Math.max(...fits.map((f) => f.logEvidence));
  const raw = fits.map((f) => Math.exp(f.logEvidence - top));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/**
 * Every model, fitted on the observations that have all of its inputs. The weights compare the
 * models on the same observations (evidence on different data cannot be compared): those with every
 * model's inputs. When there are none in common, only the models usable on all observations
 * compete (M0 always is).
 */
export function fitEnsemble(obs: Observation[], alpha: number): Ensemble {
  const fits = MODELS.map((m) => fitModel(m, obs));
  const common = obs.filter((o) => MODELS.every((m) => usable(m, o)));
  let evidence: number[];
  if (!obs.length || common.length === obs.length) evidence = fits.map((f) => f.logEvidence);
  else if (common.length) evidence = fits.map((f) => (f.n === common.length ? f.logEvidence : fitModel(f.model, common).logEvidence));
  else evidence = fits.map((f) => (f.n === obs.length ? f.logEvidence : -Infinity));
  return { alpha, fits, weights: weightsOf(fits.map((f, i) => ({ ...f, logEvidence: evidence[i] }))), n: obs.length };
}

/**
 * The weights to use at one moment: a model with a missing input there takes no part (its share
 * goes to the others, in proportion). M0 needs no input, so something always remains.
 */
export function weightsAt(ens: Ensemble, x: Drivers): number[] {
  const w = ens.fits.map((f, i) => (usable(f.model, x) ? ens.weights[i] : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum > 0) return w.map((v) => v / sum);
  // Every model with weight lacks an input: fall back to those usable, evenly.
  const ok = ens.fits.map((f) => (usable(f.model, x) ? 1 : 0));
  const n = ok.reduce((a: number, b) => a + b, 0);
  return ok.map((v) => v / n);
}

/**
 * The ensemble in use. With enough reports, α (慣れの速さ) is chosen first, by the evidence of the
 * 慣れ＋1週間 model (each α on the same reports), then every model is fitted at that α.
 */
export function ensembleFromReports(reports: Report[]): Ensemble {
  let alpha = STANDARD_ALPHA;
  const n = observationsOf(reports, STANDARD_ALPHA).length;
  if (n >= MIN_FOR_ALPHA) {
    const probe = MODELS.find((m) => m.id === "M2")!;
    let best = -Infinity;
    for (const a of ALPHA_GRID) {
      const obs = observationsOf(reports, a);
      if (obs.length !== n) continue;
      const ev = fitModel(probe, obs).logEvidence;
      if (ev > best) {
        best = ev;
        alpha = a;
      }
    }
  }
  return fitEnsemble(observationsOf(reports, alpha), alpha);
}

// β: what the reports have taught so far, shared with the screen — the fitted models and their
// weights (the comfort centre and range, and what moves them; the α of the 最近の基準), and the
// predictions' records. Fitting runs in a worker so the screen never waits for it.

import { createContext, useEffect, useMemo, useRef, useState } from "react";
import { type Ensemble, ensembleFromReports, learningOf, type LearningView, fitEnsemble, MIN_FOR_ALPHA, modelRecords, STANDARD_ALPHA, type TrackRecord, trackRecord } from "./comfort";
import { useReports } from "./useReports";
import { useAccount } from "../account/account";

export interface BetaSettings {
  ens: Ensemble;
  /** The α in use (also ens.alpha). */
  alpha: number;
  record: TrackRecord;
  /** Each model's record from its own predictions at sending. */
  records: Record<string, TrackRecord>;
  minForAlpha: number;
  /** True while the latest reports are still being fitted. */
  fitting: boolean;
  /** Someone is logged in: β (and reports) are shown. Logged out, β stays hidden. */
  enabled: boolean;
  /**
   * The models in use were fitted to this person's current reports. Until then (just opened, e.g.
   * from a notification) a prediction would come from the bare starting values, so a report waits.
   */
  learned: boolean;
  /** How far the learning has got, and what is still missing (comfort.ts: learningOf). */
  learning: LearningView;
}

const initial = (): BetaSettings => {
  const ens = fitEnsemble([], STANDARD_ALPHA);
  return { ens, alpha: ens.alpha, record: trackRecord([]), records: modelRecords([]), minForAlpha: MIN_FOR_ALPHA, fitting: false, enabled: false, learned: false, learning: { state: "untrained", missing: [], muInterval: null } };
};

/**
 * Re-learnt whenever the reports change. The 肌感 display settings play no part: the priors are
 * fixed, so moving a display boundary never moves the research model.
 */
export function useBetaSettings(): BetaSettings {
  const list = useReports();
  const enabled = useAccount().me != null;
  const [ens, setEns] = useState<Ensemble>(() => initial().ens);
  const [fitting, setFitting] = useState(false);
  const [fittedFor, setFittedFor] = useState<typeof list>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!list) return;
    const id = ++seq.current;
    setFitting(true);
    const done = (e: Ensemble) => {
      if (id !== seq.current) return; // a newer fit is on its way
      setEns(e);
      setFittedFor(list);
      setFitting(false);
    };
    try {
      worker.current ??= new Worker(new URL("./fitWorker.ts", import.meta.url), { type: "module" });
      worker.current.onmessage = (ev: MessageEvent<{ id: number; ensemble: Ensemble }>) => ev.data.id === seq.current && done(ev.data.ensemble);
      // The worker's file could not load (offline before it was cached, an old page after a deploy):
      // fit on this thread instead of staying "fitting" for ever, and try a new worker next time.
      worker.current.onerror = (ev) => {
        ev.preventDefault();
        worker.current?.terminate();
        worker.current = null;
        done(ensembleFromReports(list));
      };
      worker.current.postMessage({ id, reports: list });
    } catch {
      // No workers here: fit on this thread.
      done(ensembleFromReports(list));
    }
  }, [list]);
  useEffect(() => () => worker.current?.terminate(), []);
  const learning = useMemo(() => learningOf(list ?? [], ens), [list, ens]);
  return useMemo(
    () => ({
      ens,
      alpha: ens.alpha,
      record: trackRecord(list ?? []),
      records: modelRecords(list ?? []),
      minForAlpha: MIN_FOR_ALPHA,
      fitting,
      enabled,
      learned: list != null && fittedFor === list,
      learning,
    }),
    [ens, list, fitting, enabled, fittedFor, learning],
  );
}

export const BetaContext = createContext<BetaSettings>(initial());

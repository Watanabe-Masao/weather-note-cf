// β: what the reports have taught so far, shared with the screen — the fitted models and their
// weights (the comfort centre and range, and what moves them; the α of the 最近の基準), and the
// predictions' records. Fitting runs in a worker so the screen never waits for it.

import { createContext, useEffect, useMemo, useRef, useState } from "react";
import type { FeelSettings } from "../../shared/feel";
import { DEFAULT_FEEL } from "../../shared/feel";
import { type Ensemble, ensembleFromReports, fitEnsemble, MIN_FOR_ALPHA, modelRecords, STANDARD_ALPHA, type TrackRecord, trackRecord } from "./comfort";
import { useReports } from "./useReports";

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
}

const initial = (thresholds: FeelSettings["thresholds"]): BetaSettings => {
  const ens = fitEnsemble([], thresholds, STANDARD_ALPHA);
  return { ens, alpha: ens.alpha, record: trackRecord([]), records: modelRecords([]), minForAlpha: MIN_FOR_ALPHA, fitting: false };
};

/** Re-learnt whenever the reports (or the 肌感 boundaries the priors are built from) change. */
export function useBetaSettings(thresholds: FeelSettings["thresholds"]): BetaSettings {
  const list = useReports();
  const key = thresholds.join(",");
  const [ens, setEns] = useState<Ensemble>(() => initial(thresholds).ens);
  const [fitting, setFitting] = useState(false);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!list) return;
    const id = ++seq.current;
    setFitting(true);
    const done = (e: Ensemble) => {
      if (id !== seq.current) return; // a newer fit is on its way
      setEns(e);
      setFitting(false);
    };
    try {
      worker.current ??= new Worker(new URL("./fitWorker.ts", import.meta.url), { type: "module" });
      worker.current.onmessage = (ev: MessageEvent<{ id: number; ensemble: Ensemble }>) => ev.data.id === seq.current && done(ev.data.ensemble);
      worker.current.postMessage({ id, reports: list, thresholds });
    } catch {
      // No workers here: fit on this thread.
      done(ensembleFromReports(list, thresholds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, key]);
  useEffect(() => () => worker.current?.terminate(), []);
  return useMemo(
    () => ({
      ens,
      alpha: ens.alpha,
      record: trackRecord(list ?? []),
      records: modelRecords(list ?? []),
      minForAlpha: MIN_FOR_ALPHA,
      fitting,
    }),
    [ens, list, fitting],
  );
}

export const BetaContext = createContext<BetaSettings>(initial(DEFAULT_FEEL.thresholds));

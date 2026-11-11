// β: what the reports have taught so far, shared with the screen — the comfort model's fit (the
// centre and range and what moves them, and the α of the 最近の基準) and the predictions' record.

import { createContext, useMemo } from "react";
import type { FeelSettings } from "../../shared/feel";
import { DEFAULT_FEEL } from "../../shared/feel";
import { type ComfortFit, fitComfort, fitFromReports, MIN_FOR_ALPHA, STANDARD_ALPHA, type TrackRecord, trackRecord } from "./comfort";
import { useReports } from "./useReports";

export interface BetaSettings {
  fit: ComfortFit;
  /** The α in use (also fit.alpha). */
  alpha: number;
  record: TrackRecord;
  /** Reports needed before α is chosen by the fit. */
  minForAlpha: number;
}

const EMPTY: TrackRecord = { n: 0, logLoss: null, hit: null, bias: null, mae: null, recentMae: null };

const initial = (thresholds: FeelSettings["thresholds"]): BetaSettings => ({
  fit: fitComfort([], thresholds, STANDARD_ALPHA),
  alpha: STANDARD_ALPHA,
  record: EMPTY,
  minForAlpha: MIN_FOR_ALPHA,
});

/** Re-learnt whenever the reports (or the 肌感 boundaries the prior is built from) change. */
export function useBetaSettings(thresholds: FeelSettings["thresholds"]): BetaSettings {
  const list = useReports();
  const key = thresholds.join(",");
  return useMemo(() => {
    if (!list) return initial(thresholds);
    const fit = fitFromReports(list, thresholds);
    return { fit, alpha: fit.alpha, record: trackRecord(list), minForAlpha: MIN_FOR_ALPHA };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, key]);
}

export const BetaContext = createContext<BetaSettings>(initial(DEFAULT_FEEL.thresholds));

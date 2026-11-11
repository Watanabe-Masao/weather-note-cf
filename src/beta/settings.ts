// β: what the reports have taught so far, shared with the screen — the α in use (慣れの速さ), the
// correction of the predicted sensation, and the predictions' track record.

import { createContext, useMemo } from "react";
import type { FeelSettings } from "../../shared/feel";
import { DEFAULT_FEEL } from "../../shared/feel";
import { type AlphaFit, fitAlpha, STANDARD_ALPHA } from "./fitAlpha";
import { type Correction, type ErrorStats, errorStats, fitCorrection } from "./predict";
import { useReports } from "./useReports";

export interface BetaSettings extends AlphaFit {
  correction: Correction;
  errors: ErrorStats;
  thresholds: FeelSettings["thresholds"];
}

const DEFAULTS: BetaSettings = {
  alpha: STANDARD_ALPHA,
  status: "collecting",
  n: 0,
  spanDays: 0,
  improvement: null,
  correction: { coef: [0, 0, 0, 0], n: 0 },
  errors: { n: 0, bias: null, mae: null, recentMae: null, hit: null },
  thresholds: DEFAULT_FEEL.thresholds,
};

/** Re-learnt whenever the reports (or the 肌感 boundaries the prior reads) change. */
export function useBetaSettings(thresholds: FeelSettings["thresholds"]): BetaSettings {
  const list = useReports();
  const key = thresholds.join(",");
  return useMemo(() => {
    if (!list) return { ...DEFAULTS, thresholds };
    const fit = fitAlpha(list);
    return { ...fit, correction: fitCorrection(list, fit.alpha, thresholds), errors: errorStats(list), thresholds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, key]);
}

export const BetaContext = createContext<BetaSettings>(DEFAULTS);

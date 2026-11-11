// β: the α in use (慣れの速さ), estimated from the reports (fitAlpha.ts), shared with the screen.

import { createContext, useMemo } from "react";
import { type AlphaFit, fitAlpha, STANDARD_ALPHA } from "./fitAlpha";
import { useReports } from "./useReports";

export type BetaSettings = AlphaFit;

const DEFAULTS: BetaSettings = { alpha: STANDARD_ALPHA, status: "collecting", n: 0, spanDays: 0, improvement: null };

/** Re-estimated whenever the reports change. */
export function useBetaSettings(): BetaSettings {
  const list = useReports();
  return useMemo(() => (list ? fitAlpha(list) : DEFAULTS), [list]);
}

export const BetaContext = createContext<BetaSettings>(DEFAULTS);

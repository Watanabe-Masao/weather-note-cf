// β settings, kept apart from 肌感's (a convenience on this device only).

import { createContext, useCallback, useState } from "react";
import { ADAPT_SPEEDS, type AdaptSpeed } from "./adaptation";

const KEY = "weather-note:beta";

export interface BetaSettings {
  speed: AdaptSpeed;
}

const DEFAULTS: BetaSettings = { speed: "standard" };

export function readBeta(raw: string | null): BetaSettings {
  try {
    const r = JSON.parse(raw ?? "{}") as Partial<BetaSettings>;
    return { speed: ADAPT_SPEEDS.some((s) => s.id === r.speed) ? (r.speed as AdaptSpeed) : DEFAULTS.speed };
  } catch {
    return DEFAULTS;
  }
}

export function useBetaSettings() {
  const [beta, setBeta] = useState<BetaSettings>(() => {
    try {
      return readBeta(localStorage.getItem(KEY));
    } catch {
      return DEFAULTS;
    }
  });
  const update = useCallback((patch: Partial<BetaSettings>) => {
    setBeta((b) => {
      const next = { ...b, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Not remembering is harmless.
      }
      return next;
    });
  }, []);
  return { beta, update };
}

export const BetaContext = createContext<BetaSettings>(DEFAULTS);

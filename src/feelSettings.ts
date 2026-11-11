// Feel settings saved on this device (spec 4.8): level boundaries, surroundings, sunshine factor,
// and the anemometer height for each observation point.

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_FEEL, type FeelSettings, type Scale, SCALES, thresholdsFrom } from "../shared/feel";

const KEY = "weather-note:feel";

export interface SavedFeel {
  thresholds: FeelSettings["thresholds"];
  alpha: number;
  absorb: number;
  /** Anemometer height (m) by station id; missing means 10 m. */
  heights: Record<string, number>;
  /** How many 肌感 steps to show: 7, 5 or 3. */
  scale?: Scale;
}

export const SUNSHINE_PRESETS = [
  { label: "控えめ", absorb: 0.12 },
  { label: "標準", absorb: 0.2 },
  { label: "強め", absorb: 0.28 },
] as const;

const DEFAULTS: SavedFeel = {
  thresholds: DEFAULT_FEEL.thresholds,
  alpha: DEFAULT_FEEL.alpha,
  absorb: DEFAULT_FEEL.absorb,
  heights: {},
  scale: 7,
};

/** Keep only sensible values; anything else falls back to `fallback` (the previous settings, or the defaults). */
export function sanitize(raw: unknown, fallback: SavedFeel = DEFAULTS): SavedFeel {
  const r = (raw ?? {}) as Partial<SavedFeel>;
  // Four boundaries (the old five steps) become the inner four of the seven.
  const t = Array.isArray(r.thresholds) ? thresholdsFrom((r.thresholds as unknown[]).map(Number)) : null;
  const ascending = t && t.every((v, i) => Number.isFinite(v) && (i === 0 || v > t[i - 1]));
  const heights: Record<string, number> = {};
  for (const [id, h] of Object.entries(r.heights ?? {}))
    if (Number.isFinite(h) && h >= 2 && h <= 200) heights[id] = h;
    else if (fallback.heights[id] != null) heights[id] = fallback.heights[id];
  return {
    thresholds: ascending ? (t as SavedFeel["thresholds"]) : fallback.thresholds,
    alpha: Number.isFinite(r.alpha) && r.alpha! >= 0.05 && r.alpha! <= 0.6 ? r.alpha! : fallback.alpha,
    absorb: Number.isFinite(r.absorb) && r.absorb! >= 0 && r.absorb! <= 0.5 ? r.absorb! : fallback.absorb,
    heights,
    scale: SCALES.includes(r.scale as Scale) ? (r.scale as Scale) : (fallback.scale ?? 7),
  };
}

function load(): SavedFeel {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return DEFAULTS;
  }
}

/** Saved settings plus the settings to calculate with for `station` in the sun or the shade. */
export function useFeelSettings(station: string, sun: boolean) {
  const [saved, setSaved] = useState<SavedFeel>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      // Not saving is harmless.
    }
  }, [saved]);

  const update = useCallback((patch: Partial<SavedFeel>) => setSaved((s) => sanitize({ ...s, ...patch }, s)), []);
  // Back to the default boundaries; the display choice (how many steps) stays.
  const reset = useCallback(() => setSaved((s) => ({ ...DEFAULTS, scale: s.scale })), []);

  const settings: FeelSettings = useMemo(
    () => ({
      thresholds: saved.thresholds,
      alpha: saved.alpha,
      absorb: saved.absorb,
      stationHeight: saved.heights[station] ?? DEFAULT_FEEL.stationHeight,
      sun,
      scale: saved.scale ?? 7,
    }),
    [saved, station, sun],
  );
  return { saved, settings, update, reset };
}

// β: "how far today is from what you have been used to lately" (適応基準との差).
//
// The baseline is the running mean of past daily mean air temperatures, the quantity adaptive
// comfort standards use for outdoor exposure (EN 16798-1: θrm = (1 − α)·θ(d−1) + α·θrm(d−1)). In
// closed form, day d−k weighs (1 − α)·α^(k−1). α (慣れの速さ) is not chosen by hand: it is
// estimated from the person's reports (fitAlpha.ts) and stays at the standard 0.8 until they show it.
//
// What this module gives are differences in ℃ from the baseline: the day's mean air temperature,
// and its daytime 日なた温度 / 日かげ温度 (which already carry wind, humidity and sunshine). They are
// NOT a felt temperature and not a prediction of how it will feel: no coefficient has been fitted
// yet. The screen labels them β and says so.

import { addDays } from "../../shared/dates";
import { daytimeFeel, type FeelSettings } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";

/** Past days looked at; beyond these the weights are negligible (0.9^30 ≈ 4%). */
export const HISTORY_DAYS = 30;
/** Share of the total weight that must be present; less is "履歴不足" (never guessed). */
export const MIN_COVERAGE = 0.8;

/** The days a baseline for `date` reads, newest first (d−1, d−2, …). */
export function historyDays(date: string): string[] {
  return Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(date, -(i + 1)));
}

export interface Baseline {
  /** ℃, one decimal. */
  value: number;
  /** Some of the days behind it are forecasts (the day itself is in the future). */
  forecastMixed: boolean;
  /** Share of the weight that had data (0.8–1). */
  coverage: number;
}

export interface PastDay {
  mean: number | null;
  forecast: boolean;
}

/** Running mean over past days (newest first). Null when too little history is there. */
export function runningMean(past: PastDay[], alpha: number): Baseline | null {
  let total = 0;
  let have = 0;
  let sum = 0;
  let forecastMixed = false;
  past.forEach((d, k) => {
    const w = (1 - alpha) * alpha ** k;
    total += w;
    if (d.mean == null) return;
    have += w;
    sum += w * d.mean;
    if (d.forecast) forecastMixed = true;
  });
  if (!total || have / total < MIN_COVERAGE || past[0]?.mean == null) return null; // yesterday is required
  return { value: Math.round((sum / have) * 10) / 10, forecastMixed, coverage: have / total };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A day's mean air temperature from its daily row. */
export function pastDay(row: WeatherRow | null | undefined): PastDay {
  return { mean: num(row?.temp), forecast: row?.type === "forecast" };
}

export interface Departures {
  baseline: Baseline;
  /** Day mean air temperature − baseline. */
  air: number | null;
  /** Daytime (9–17時) 日なた温度 − baseline. */
  sun: number | null;
  /** Daytime 日かげ温度 − baseline. */
  shade: number | null;
}

const minus = (a: number | null, b: number) => (a == null ? null : Math.round((a - b) * 10) / 10);

/** The day's differences from its own baseline, in the sun and in the shade. */
export function departures(
  row: WeatherRow | null | undefined,
  hours: WeatherRow[] | null,
  baseline: Baseline | null,
  feel: FeelSettings,
): Departures | null {
  if (!baseline) return null;
  const rows = hours ?? [];
  return {
    baseline,
    air: minus(num(row?.temp), baseline.value),
    sun: minus(daytimeFeel(rows, { ...feel, sun: true }), baseline.value),
    shade: minus(daytimeFeel(rows, { ...feel, sun: false }), baseline.value),
  };
}

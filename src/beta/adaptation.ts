// β: "how far today is from what you have been used to lately" (適応基準との差).
//
// The baseline is the running mean of past daily mean air temperatures, the quantity adaptive
// comfort standards use for outdoor exposure (EN 16798-1: θrm = (1 − α)·θ(d−1) + α·θrm(d−1)). In
// closed form, day d−k weighs (1 − α)·α^(k−1). α (慣れの速さ) is not chosen by hand: it is
// chosen with the comfort model from the person's reports (comfort.ts), standard 0.8 until then.
//
// What this module gives are differences in ℃ from the baseline: the day's mean air temperature,
// and its daytime 肌感（日なた） / 肌感（日かげ） (which already carry wind, humidity and sunshine). They are
// NOT a felt temperature and not a prediction of how it will feel: no coefficient has been fitted
// yet. The screen labels them β and says so.

import { addDays } from "../../shared/dates";
import { daytimeFeel, type FeelSettings } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";

/**
 * Past days looked at. 60 so that even a slow α keeps nearly all of its weight (0.95^60 ≈ 5%;
 * 30 days would cut α = 0.95 to 79% of it) — the warm-up the plan asks for.
 */
export const HISTORY_DAYS = 60;

/**
 * Two ways to say the same α, because the research notes use the other one: here α is EN 16798's
 * weight on the previous baseline; the notes' "更新率" is the weight on yesterday, 1 − α.
 * The half-life (days until a change counts half) reads the same in both.
 */
export const updateRate = (alpha: number) => Math.round((1 - alpha) * 100) / 100;
export const halfLifeDays = (alpha: number) => Math.round((Math.log(0.5) / Math.log(alpha)) * 10) / 10;
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
  /** Not loaded yet (the request is on its way): "読み込み中", not "履歴不足". */
  loading?: boolean;
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
export function pastDay(row: WeatherRow | null | undefined, loading = false): PastDay {
  return { mean: num(row?.temp), forecast: row?.type === "forecast", loading };
}

export type BaselineState = { state: "ready"; baseline: Baseline } | { state: "loading" } | { state: "short" };

/** Ready, still loading (some past day not fetched yet), or 履歴不足 (fetched, but too little). */
export function baselineState(past: PastDay[], alpha: number): BaselineState {
  const baseline = runningMean(past, alpha);
  if (baseline) return { state: "ready", baseline };
  return past.some((d) => d.loading) ? { state: "loading" } : { state: "short" };
}

export interface Departures {
  baseline: Baseline;
  /** Day mean air temperature − baseline. */
  air: number | null;
  /** Daytime (日中・昼・夕方, by the sun) 肌感（日なた） − baseline. */
  sun: number | null;
  /** Daytime 肌感（日かげ） − baseline. */
  shade: number | null;
}

const minus = (a: number | null, b: number) => (a == null ? null : Math.round((a - b) * 10) / 10);

/** The day's differences from its own baseline, in the sun and in the shade. */
export function departures(
  row: WeatherRow | null | undefined,
  hours: WeatherRow[] | null,
  baseline: Baseline | null,
  feel: FeelSettings,
  station: string | null,
): Departures | null {
  if (!baseline) return null;
  const rows = hours ?? [];
  return {
    baseline,
    air: minus(num(row?.temp), baseline.value),
    sun: minus(daytimeFeel(rows, { ...feel, sun: true }, station), baseline.value),
    shade: minus(daytimeFeel(rows, { ...feel, sun: false }, station), baseline.value),
  };
}

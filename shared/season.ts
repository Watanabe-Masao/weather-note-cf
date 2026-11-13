// 従来版の境目を季節で動かす (#111, 渡辺さん 2026-11-13). The seven words stay; where they begin moves
// with what one is used to: the last 30 days' mean temperature. In summer the boundaries go up (24 can
// be 涼しい, comfortable), in winter down (15 can be 暖かい, comfortable).
//
//   shift = SLOPE × (clamp(30-day mean, LO, HI) − REF)
//   boundaries on a day = the settings' boundaries (as at a 30-day mean of REF) + shift
//
// SLOPE 0.7 is from 渡辺さん's own sense (winter 15 → 暖かい, summer 24 → 涼しい); the literature's
// adaptive slope (0.31, indoors) moves too little outdoors and in Kochi's winter even goes the wrong
// way. LO/HI: beyond them one is used to no more. All provisional: to be fitted to everyone's
// consented reports. β's starting point (the prior) uses the same numbers (MATH-04).

import type { Thresholds } from "./feel";

export const SEASON = { slope: 0.7, lo: 5, hi: 30, ref: 15, days: 30, minDays: 24 } as const;

/** The shift (℃ of 肌感) for a 30-day mean temperature. */
export const seasonShift = (mean30: number): number => SEASON.slope * (Math.min(SEASON.hi, Math.max(SEASON.lo, mean30)) - SEASON.ref);

/** The boundaries moved by a shift. */
export const shifted = (t: Thresholds, shift: number): Thresholds => t.map((v) => Math.round((v + shift) * 10) / 10) as Thresholds;

/** The mean of the days' means when enough of them are there (null: too few, never guessed). */
export function mean30(means: (number | null)[]): number | null {
  const v = means.filter((m): m is number => m != null && Number.isFinite(m));
  if (v.length < SEASON.minDays) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

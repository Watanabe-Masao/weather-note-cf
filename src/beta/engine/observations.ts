// Observations for fitting, from saved reports (MATH-02 decides which may teach).
// Contract: research/comfort-model/mathematical-contract.md

import { runningMean } from "../adaptation";
import { inputQuality } from "../quality";
import type { Report } from "../reports";
import { type Drivers } from "./drivers";
import { type Observation } from "./estimation";

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sd = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};

export interface PastDayLite {
  mean: number | null;
  humidity: number | null;
  sun: number | null;
  rain: number | null;
  min?: number | null;
  wind?: number | null;
}

/**
 * The drivers of a moment: its place temperature, the 60 daily means before (newest first), the
 * 7 days before in detail (newest first), the humidity and sky of the moment.
 */
/** Least-squares slope of the 14 daily means before, in ℃ per week (null with fewer than 10). */
export function trendOf(history: (number | null)[]): number | null {
  const pts = history.slice(0, 14).flatMap((v, k) => (v == null ? [] : [{ x: -(k + 1), y: v }]));
  if (pts.length < 10) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return (pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx) * 7;
}

/** Day of the year (1–366) of a date "YYYY-MM-DD". */
export const dayOfYear = (date: string) => Math.floor((Date.parse(date) - Date.parse(`${date.slice(0, 4)}-01-01`)) / 86_400_000) + 1;

export function driversFrom(
  e: number,
  history: (number | null)[],
  recent: PastDayLite[] | undefined,
  hNow: number | null,
  sky: boolean | null,
  alpha: number,
  date: string | null = null,
  radDay: number | null = null,
  hour: number | null = null,
  wind6h: number | null = null,
  windLastNight: number | null = null,
): Drivers | null {
  const base = runningMean(history.map((m) => ({ mean: m, forecast: false })), alpha);
  if (!base) return null;
  const week = (recent ?? []).slice(0, 7);
  const y = week[0];
  const yMean = y?.mean ?? history[0] ?? null;
  return {
    e,
    a: base.value,
    dT1: yMean == null ? null : yMean - base.value,
    h7: avg(week.map((d) => d.humidity)),
    h1: y?.humidity ?? null,
    hNow,
    v7: sd(history.slice(0, 7)),
    sun1: y?.sun ?? null,
    sun7: avg(week.map((d) => d.sun)),
    rain1: y?.rain ?? null,
    rain7: avg(week.map((d) => d.rain)),
    sky,
    trend: trendOf(history),
    doy: date ? dayOfYear(date) : null,
    radDay,
    night: hour == null ? null : isNight(hour),
    wind6h,
    minPrev: y?.min == null ? null : y.min - base.value,
    windPrev: windLastNight ?? y?.wind ?? null,
  };
}

/** Night for the stored-sun driver: 18時 to 5時 (JMA hours, 24 = midnight). */
export const isNight = (hour: number) => hour >= 18 || hour <= 5;

export function placeTempOf(r: Report): number | null {
  const s = r.snapshot;
  if (!s) return null;
  if (r.exposure === "sun") return s.sunTemp;
  if (r.exposure === "shade") return s.shadeTemp;
  return s.sunTemp == null || s.shadeTemp == null ? null : (s.sunTemp + s.shadeTemp) / 2;
}

export const reportedSunny = (r: Report) => (r.sky ? r.sky === "clear" || r.sky === "sunny" : null);

/**
 * Reports made in a row (#62): a report less than BURST_GAP_H hours after the previous one joins
 * its run. Answers in a run share the moment — the same weather, clothes, activity — so they are
 * not independent evidence. A run of k reports counts as k / (1 + (k − 1)·ρ) answers (the
 * effective size of k answers correlated by ρ): each report weighs 1 / (1 + (k − 1)·ρ). The gap
 * and ρ were chosen on synthetic people (research/comfort-model/bursts.ts).
 */
export const BURST_GAP_H = 2;
export const BURST_RHO = 0.5;

/** Weights for reports at these times (ms), in the same order. */
export function burstWeights(times: number[], gapH = BURST_GAP_H, rho = BURST_RHO): number[] {
  const order = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
  const w = Array(times.length).fill(1);
  let start = 0;
  for (let k = 1; k <= order.length; k++) {
    if (k === order.length || order[k].t - order[k - 1].t >= gapH * 3_600_000) {
      const size = k - start;
      for (let j = start; j < k; j++) w[order[j].i] = 1 / (1 + (size - 1) * rho);
      start = k;
    }
  }
  return w;
}

export function observationsOf(reports: Report[], alpha: number): Observation[] {
  const out: Observation[] = [];
  const used: Report[] = [];
  for (const r of reports) {
    // Only reports whose inputs are good enough teach the model (MATH-02, quality.ts).
    if (r.deleted || !inputQuality(r).trainable) continue;
    const e = placeTempOf(r);
    if (e == null) continue;
    const d = driversFrom(e, r.history ?? [], r.recent, r.snapshot?.humidity ?? null, reportedSunny(r), alpha, r.snapshot?.date ?? r.at.slice(0, 10), r.snapshot?.radDay ?? null, r.snapshot?.hour ?? null, r.snapshot?.wind6h ?? null, r.snapshot?.windLastNight ?? null);
    if (d) {
      out.push({ ...d, windFelt: r.windFelt, y: r.sensation });
      used.push(r);
    }
  }
  // Runs are found among the reports that teach the model (a report left out does not join them).
  const w = burstWeights(used.map((r) => Date.parse(r.at)));
  return out.map((o, i) => (w[i] === 1 ? o : { ...o, w: w[i] }));
}

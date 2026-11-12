// Observations for fitting, from saved reports (MATH-02 decides which may teach).
// Contract: research/comfort-model/mathematical-contract.md

import { DEFAULT_LAT_LON, solarTimes, stationLatLon } from "../../../shared/sunTimes";
import { addDays } from "../../../shared/dates";
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
  night: boolean | null = null,
  wind6h: number | null = null,
  windLastNight: number | null = null,
  skyAtNight = false,
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
    night,
    wind6h,
    minPrev: y?.min == null ? null : y.min - base.value,
    windPrev: windLastNight ?? y?.wind ?? null,
    ...(skyAtNight ? { skyAtNight: true } : {}),
  };
}

/** comfort-3/4: night by the clock, 18時 to 5時 (JMA hours, 24 = midnight), whatever the season. */
export const isNight = (hour: number) => hour >= 18 || hour <= 5;

const hm = (v: string | null | undefined) => {
  const m = v?.match(/^(\d{2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};
const jst = (at: number) => new Date(at + 9 * 3_600_000).toISOString();

/**
 * comfort-5 (#86): night is from sunset to sunrise of the moment itself — 17時 is night in December
 * and day in June. The day's sunrise and sunset come from the report when it stored them (the
 * station's, from the sun API) and are otherwise calculated for the station (shared/sunTimes.ts).
 * `sun` belongs to `sunDate`; it is used only when that is the moment's own JST date.
 */
export function nightAt(at: number, station: string | null | undefined, sun?: SunOfDay | null): boolean {
  return nightOf(at, station, sun).night;
}

type SunOfDay = { sunrise?: string | null; sunset?: string | null; date?: string | null };

/** Sunrise and sunset (minutes JST) of a date: the stored ones when they are that date's, else calculated. */
function riseSet(date: string, station: string | null | undefined, sun?: SunOfDay | null) {
  const own = sun && (sun.date == null || sun.date === date);
  const rise = own ? hm(sun.sunrise) : null;
  const set = own ? hm(sun.sunset) : null;
  if (rise != null && set != null) return { rise, set };
  const c = stationLatLon(station) ?? DEFAULT_LAT_LON;
  return solarTimes(date, c.lat, c.lon);
}

/**
 * The night of a moment (comfort-5) and, at night, the hours since the sunset it follows
 * (comfort-6): this evening's, or the day before's when it is before sunrise.
 */
export function nightOf(at: number, station: string | null | undefined, sun?: SunOfDay | null): { night: boolean; date: string; sinceSunset: number | null; beforeSunrise: boolean } {
  const iso = jst(at);
  const date = iso.slice(0, 10);
  const min = +iso.slice(11, 13) * 60 + +iso.slice(14, 16) + +iso.slice(17, 19) / 60;
  const { rise, set } = riseSet(date, station, sun);
  if (min >= set) return { night: true, date, sinceSunset: (min - set) / 60, beforeSunrise: false };
  if (min < rise) {
    const before = addDays(date, -1);
    return { night: true, date, sinceSunset: (min + 1440 - riseSet(before, station, sun).set) / 60, beforeSunrise: true };
  }
  return { night: false, date, sinceSunset: null, beforeSunrise: false };
}

/**
 * comfort-6: the stored sun of a report's night — the latest daytime's radiation total (MJ/m²) and
 * the hours since that sunset. In the evening the day's own running total (by then its whole day);
 * before sunrise the day before's: its running total when the report was read on the day before's
 * hours (0時台, 24時), otherwise the day before's total from the daily table (the report's `recent`).
 */
export function storedSunOf(r: Report): { storedRad: number | null; sinceSunset: number | null } {
  const at = Date.parse(r.at);
  if (!Number.isFinite(at)) return { storedRad: null, sinceSunset: null };
  const n = nightOf(at, r.station, { sunrise: r.snapshot?.sunrise, sunset: r.snapshot?.sunset, date: r.snapshot?.date ?? null });
  if (!n.night) return { storedRad: null, sinceSunset: null };
  const snapDate = r.snapshot?.date ?? null;
  const sunsetDay = n.beforeSunrise ? addDays(n.date, -1) : n.date;
  if (snapDate === sunsetDay) return { storedRad: r.snapshot?.radDay ?? null, sinceSunset: n.sinceSunset };
  const day = r.recent?.find((d) => d.date === sunsetDay);
  return { storedRad: day?.radiation ?? null, sinceSunset: n.sinceSunset };
}

/**
 * How observations are made from reports, by model version (kept so versions can be compared on
 * the same reports, #54):
 *   - comfort-3: every report the same; night by the clock; the sky counts at night too.
 *   - comfort-4: reports in a row weigh less (runs end at a 2-hour gap).
 *   - comfort-5: runs also end 3 hours after their first report; night from sunset to sunrise;
 *     the sky counts in daylight only (a clear night is not a sunny moment).
 *   - comfort-6: the stored sun at night is the latest daytime's total, fading after sunset (the
 *     day's running total, read until comfort-5, was the new day's — about 0 — after 1時).
 */
export type ObsSettings = "comfort-3" | "comfort-4" | "comfort-5" | "comfort-6";
export const CURRENT_SETTINGS: ObsSettings = "comfort-6";
const sunBased = (s: ObsSettings) => s === "comfort-5" || s === "comfort-6";

/** The night of a report under these settings (null when its moment is unknown). */
export function reportNight(r: Report, settings: ObsSettings = CURRENT_SETTINGS): boolean | null {
  if (!sunBased(settings)) return r.snapshot?.hour == null ? null : isNight(r.snapshot.hour);
  const at = Date.parse(r.at);
  return Number.isFinite(at) ? nightAt(at, r.station, { sunrise: r.snapshot?.sunrise, sunset: r.snapshot?.sunset, date: r.snapshot?.date ?? null }) : null;
}

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
/** comfort-5 (#86): a run also ends this many hours after its first report, so a person who reports
 *  every 1.5–2 hours all day is not one run (burst-cap-results.md). */
export const BURST_MAX_SPAN_H = 3;

/** Weights for reports at these times (ms), in the same order. `maxSpanH`: a run also ends once it
 *  has lasted this long from its first report (Infinity in comfort-4). */
export function burstWeights(times: number[], gapH = BURST_GAP_H, rho = BURST_RHO, maxSpanH = BURST_MAX_SPAN_H): number[] {
  const order = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
  const w = Array(times.length).fill(1);
  let start = 0;
  for (let k = 1; k <= order.length; k++) {
    if (k === order.length || order[k].t - order[k - 1].t >= gapH * 3_600_000 || order[k].t - order[start].t >= maxSpanH * 3_600_000) {
      const size = k - start;
      for (let j = start; j < k; j++) w[order[j].i] = 1 / (1 + (size - 1) * rho);
      start = k;
    }
  }
  return w;
}

export function observationsOf(reports: Report[], alpha: number, settings: ObsSettings = CURRENT_SETTINGS): Observation[] {
  const out: Observation[] = [];
  const used: Report[] = [];
  for (const r of reports) {
    // Only reports whose inputs are good enough teach the model (MATH-02, quality.ts).
    if (r.deleted || !inputQuality(r).trainable) continue;
    const e = placeTempOf(r);
    if (e == null) continue;
    const d = driversFrom(e, r.history ?? [], r.recent, r.snapshot?.humidity ?? null, reportedSunny(r), alpha, r.snapshot?.date ?? r.at.slice(0, 10), r.snapshot?.radDay ?? null, reportNight(r, settings), r.snapshot?.wind6h ?? null, r.snapshot?.windLastNight ?? null, !sunBased(settings));
    if (d) {
      const stored = settings === "comfort-6" ? storedSunOf(r) : { legacyRad: true };
      out.push({ ...d, ...stored, windFelt: r.windFelt, y: r.sensation });
      used.push(r);
    }
  }
  // Runs are found among the reports that teach the model (a report left out does not join them).
  if (settings === "comfort-3") return out; // every report the same (kept for comparisons, #54)
  const w = burstWeights(used.map((r) => Date.parse(r.at)), BURST_GAP_H, BURST_RHO, settings === "comfort-4" ? Infinity : BURST_MAX_SPAN_H);
  return out.map((o, i) => (w[i] === 1 ? o : { ...o, w: w[i] }));
}

// How the light moves from day to day (#101, 明るさの移り変わり), said in minutes.
//
// Two ways to look at it, both from the same light as the hours (shared/brightness.ts: the clear sky
// by the sun's altitude, times a cloud factor):
//   - 時刻で (a chosen clock time): how bright it is then, and how that compares with another day.
//     The difference is said in minutes — "the light of 17:00 today is the light of 17:09 on a clear
//     day" — since a ratio of lux ("1.9分の1") reads badly.
//   - 明るさで (a chosen level): when that light begins and ends, and how long it lasts.
// A difference between two days is split in two (in minutes): the season (where the sun is: the two
// days under a clear sky) and the weather (the rest). The same date a year before has almost no
// season in it; a week before, in autumn, about five minutes of it.

import { CLOUD, clearSkyLux, nightSkyLux, sunshineDayHours, sunshineFactor } from "./brightness";
import type { Where } from "./dayParts";
import { DEFAULT_LAT_LON, solarAltitude, solarNoon, stationLatLon } from "./sunTimes";

const latLonOf = (w: Where) => (w && typeof w === "object" ? w : (stationLatLon(w) ?? DEFAULT_LAT_LON));

/** The cloud factor at a minute of the day: one value for the whole day, or one per JMA hour (index 0 = hour 1, 0:00–1:00). */
export type Clouds = number | (number | null)[];

/** The factor of `clouds` at minute `m` (JMA hour n covers n−1 to n o'clock; a missing hour reads as unknown). */
export function factorAt(clouds: Clouds, m: number): number {
  if (typeof clouds === "number") return clouds;
  const h = Math.min(23, Math.max(0, Math.floor(m / 60)));
  return clouds[h] ?? CLOUD.unknown;
}

/** The light (lux) at minute `m` of a date: the clear sky times the clouds, never below the night sky. */
export function luxAtMinute(date: string, m: number, where: Where, clouds: Clouds = CLOUD.clear): number {
  const c = latLonOf(where);
  const f = factorAt(clouds, m);
  return Math.max(clearSkyLux(solarAltitude(date, m, c.lat, c.lon)) * f, nightSkyLux(f));
}

/** Morning or evening: the side of the day's solar noon a minute is on. */
export const sideOf = (date: string, m: number, where: Where): "am" | "pm" => (m < solarNoon(date, latLonOf(where).lon) ? "am" : "pm");

const SEARCH = 180; // minutes either side of the chosen time

/**
 * The clock time on a clear day `date`, on the same side of noon as `near` and within SEARCH
 * minutes of it, when the light is `lux`. Null when the clear sky never gives that light there.
 */
export function clearClockOf(date: string, lux: number, near: number, where: Where): number | null {
  const noon = solarNoon(date, latLonOf(where).lon);
  const pm = near >= noon;
  // Morning: the light rises with time; evening: it falls. Search the half-day side only.
  let lo = pm ? Math.max(noon, near - SEARCH) : near - SEARCH;
  let hi = pm ? near + SEARCH : Math.min(noon, near + SEARCH);
  const f = (m: number) => luxAtMinute(date, m, where) - lux;
  const flo = f(lo), fhi = f(hi);
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (Math.sign(f(m)) === Math.sign(flo)) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * How many minutes "darker" light `lux` is than the clear sky at `at` on `date` (negative: brighter):
 * in the evening the minutes after `at` that a clear day takes to get that dark, in the morning the
 * minutes before. Null outside the search window (deep night, or noon where the light hardly moves).
 */
export function darkMinutes(date: string, at: number, lux: number, where: Where): number | null {
  const eq = clearClockOf(date, lux, at, where);
  if (eq == null) return null;
  return sideOf(date, at, where) === "pm" ? eq - at : at - eq;
}

export interface Shift {
  /** Minutes the target day is darker than the comparison day at that time (negative: brighter). */
  total: number;
  /** Of which the season: the two days under a clear sky. */
  season: number;
  /** Of which the weather: the rest. */
  weather: number;
}

/**
 * 時刻で: the light at clock time `at` on the target day against the comparison day, in minutes,
 * measured on the target day's clear sky ("today's 17:00 is the light of 17:09 on a clear day").
 */
export function shiftAt(at: number, target: { date: string; clouds: Clouds }, compare: { date: string; clouds: Clouds }, where: Where): Shift | null {
  const lt = luxAtMinute(target.date, at, where, target.clouds);
  const lc = luxAtMinute(compare.date, at, where, compare.clouds);
  const lcClear = luxAtMinute(compare.date, at, where);
  const dt = darkMinutes(target.date, at, lt, where);
  const dc = darkMinutes(target.date, at, lc, where);
  const season = darkMinutes(target.date, at, lcClear, where);
  if (dt == null || dc == null || season == null) return null;
  const total = dt - dc;
  // The comparison day's clear light, seen from the target's clear day: −season is how far it is.
  return { total, season: -season, weather: total + season };
}

/** The first and the last minute of a date with at least `lux` (null when it never gets that light). */
export interface LightSpan {
  start: number;
  end: number;
}

/**
 * 明るさで: when light of at least `lux` begins and ends on a date, to the minute (`step`), by
 * walking out from solar noon; with hourly clouds the edges move by the hour's weather.
 */
export function lightSpan(date: string, lux: number, where: Where, clouds: Clouds = CLOUD.clear, step = 1): LightSpan | null {
  const noon = Math.round(solarNoon(date, latLonOf(where).lon));
  const ok = (m: number) => luxAtMinute(date, m, where, clouds) >= lux;
  if (!ok(noon)) return null;
  let start = noon, end = noon;
  while (start - step >= 0 && ok(start - step)) start -= step;
  while (end + step <= 1440 && ok(end + step)) end += step;
  if (step > 1) {
    // Refine to the minute at each edge.
    while (start - 1 >= 0 && ok(start - 1)) start--;
    while (end + 1 <= 1440 && ok(end + 1)) end++;
  }
  return { start, end };
}

export const spanLength = (s: LightSpan | null) => (s ? s.end - s.start : 0);

export interface SpanShift {
  /** Minutes the target's span is longer than the comparison's (negative: shorter). */
  total: number;
  season: number;
  weather: number;
  /** Minutes the start is later, and the end later, on the target day. */
  start: number;
  end: number;
}

/** 明るさで: the target day's span of `lux` against the comparison day's, split into season and weather. */
export function spanShift(lux: number, target: { date: string; clouds: Clouds }, compare: { date: string; clouds: Clouds }, where: Where): SpanShift | null {
  const t = lightSpan(target.date, lux, where, target.clouds);
  const c = lightSpan(compare.date, lux, where, compare.clouds);
  if (!t || !c) return null;
  const season = spanLength(lightSpan(target.date, lux, where)) - spanLength(lightSpan(compare.date, lux, where));
  const total = spanLength(t) - spanLength(c);
  return { total, season, weather: total - season, start: t.start - c.start, end: t.end - c.end };
}

/**
 * How fast the season moves at a date, per week (clear sky): the change of the span of `lux` over
 * the week before (minutes, negative = getting shorter), and of its start and end.
 */
export function weeklyChange(date: string, lux: number, where: Where, addDays: (d: string, n: number) => string): { length: number; start: number; end: number } | null {
  const a = lightSpan(addDays(date, -7), lux, where), b = lightSpan(date, lux, where);
  if (!a || !b) return null;
  return { length: spanLength(b) - spanLength(a), start: b.start - a.start, end: b.end - a.end };
}

/**
 * A day's cloud factor from its daily sunshine (hours), for views of many days (the year) where the
 * hours are not loaded: the share of the sunshine the day could have had (sunshineFactor).
 */
export function dayFactor(sunHours: number | null | undefined, date: string, where: Where): number {
  if (sunHours == null || !Number.isFinite(sunHours)) return CLOUD.unknown;
  const hours = sunshineDayHours(date, where); // the sunshine the day could have had (the sun above 3°, #132)
  return hours > 0 ? sunshineFactor(sunHours / hours) : CLOUD.unknown;
}

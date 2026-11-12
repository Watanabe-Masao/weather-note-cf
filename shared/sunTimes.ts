// The sun by calculation: sunrise and sunset (for reports that did not store them), the sun's
// altitude through the day, and the moments it crosses an altitude (the parts of the day,
// shared/dayParts.ts). NOAA's solar position algorithm (Meeus, from Julian centuries) with −0.833°
// for refraction and the sun's radius at sunrise and sunset: within about a minute of 国立天文台's
// published times, checked in research/sun/verify-results.md.

import stationList from "./stations.json";
import type { Station } from "./types";

const stations = stationList as Station[];

/** Decimal degrees of a station ([degrees, minutes] in the list), or null for an unknown one. */
export function stationLatLon(blockNo: string | null | undefined): { lat: number; lon: number } | null {
  const s = blockNo ? stations.find((x) => x.blockNo === blockNo) : undefined;
  return s ? { lat: s.lat[0] + s.lat[1] / 60, lon: s.lon[0] + s.lon[1] / 60 } : null;
}

/** Japan's middle, for a station not in the list (135° E is JST's own meridian). */
export const DEFAULT_LAT_LON = { lat: 35, lon: 135 };

/**
 * The sun's declination (radians) and the equation of time (minutes) at a moment (ms): NOAA's full
 * algorithm, within about 0.01° and a few seconds. The short Fourier series of the fractional year,
 * used at first, is fitted to an average year and lagged about a day in 2026: 0.4° of noon altitude
 * at the equinoxes against 国立天文台 — something a comparison with SunCalc could not show.
 */
function solarAngles(at: number): { eqTime: number; decl: number } {
  const T = (at / 86_400_000 + 2440587.5 - 2451545) / 36525;
  const rad = Math.PI / 180;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega * rad)) * rad;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda * rad));
  const y = Math.tan(eps / 2) ** 2;
  const l = L0 * rad;
  const m = M * rad;
  const eqTime = (4 / rad) * (y * Math.sin(2 * l) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l) - 0.5 * y * y * Math.sin(4 * l) - 1.25 * e * e * Math.sin(2 * m));
  return { eqTime, decl };
}

/** The moment (ms) of a time of a date, in minutes after 0:00 JST. */
const momentOf = (date: string, minJst: number) => Date.parse(`${date}T00:00:00+09:00`) + minJst * 60_000;

/** The sun's altitude (degrees, without refraction) at a moment of a date (minutes after 0:00 JST). */
export function solarAltitude(date: string, minJst: number, lat: number, lon: number): number {
  const { eqTime, decl } = solarAngles(momentOf(date, minJst));
  const trueSolar = minJst - 540 + eqTime + 4 * lon; // minutes of true solar time
  const H = ((trueSolar / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  return (Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H)) * 180) / Math.PI;
}

/** Solar noon (minutes JST) of a date. */
export function solarNoon(date: string, lon: number): number {
  // Twice: the equation of time at the noon itself (it moves a few seconds in a day).
  const first = 720 - 4 * lon - solarAngles(momentOf(date, 720)).eqTime + 540;
  return 720 - 4 * lon - solarAngles(momentOf(date, first)).eqTime + 540;
}

/**
 * When the sun crosses an altitude (degrees) that day, rising (before noon) or setting (after):
 * minutes JST, or null when it never does. Bisection on each side of noon, where the altitude only
 * rises or only falls.
 */
export function altitudeCrossing(date: string, deg: number, rising: boolean, lat: number, lon: number): number | null {
  const noon = solarNoon(date, lon);
  let a = rising ? noon - 720 : noon;
  let b = rising ? noon : noon + 720;
  const f = (m: number) => solarAltitude(date, m, lat, lon) - deg;
  if (Math.sign(f(a)) === Math.sign(f(b))) return null;
  for (let i = 0; i < 30; i++) {
    const m = (a + b) / 2;
    if (Math.sign(f(m)) === Math.sign(f(a))) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Sunrise and sunset of a date "YYYY-MM-DD" in minutes after midnight JST (the sun's upper edge at
 *  the horizon, with refraction: −0.833°). */
export function solarTimes(date: string, lat: number, lon: number): { rise: number; set: number } {
  const noon = solarNoon(date, lon);
  return { rise: altitudeCrossing(date, -0.833, true, lat, lon) ?? noon, set: altitudeCrossing(date, -0.833, false, lat, lon) ?? noon };
}

// 太陽の位置と快晴の空 (no parameters of its own but the sky's haze): the sun's altitude at a moment,
// and the clear sky's direct and global irradiance for it. Helpers of the sun's formulas, not
// formulas: every number is a named constant (constants.ts) or comes in as an argument.

import { ANGLE, NOAA, SKY, TIME } from "./constants";

const RAD = Math.PI / ANGLE.halfTurn;
const mod = (x: number, m: number) => ((x % m) + m) % m;
/** Σ c_i·T^i (Horner). */
const poly = (c: readonly number[], t: number) => c.reduceRight((acc, ci) => acc * t + ci, 0);

/** The sun's declination (radians) and the equation of time (minutes) at a moment (ms). */
function solarAngles(ms: number): { decl: number; eqTime: number } {
  const t = (ms / TIME.msPerDay + TIME.julianAtUnixEpoch - TIME.julianJ2000) / TIME.daysPerCentury;
  const l0 = mod(poly(NOAA.meanLongitude, t), ANGLE.turn);
  const m = poly(NOAA.meanAnomaly, t);
  const e = poly(NOAA.eccentricity, t);
  const centre = NOAA.centre.reduce((acc, term) => acc + Math.sin(term.k * m * RAD) * poly(term.c, t), 0);
  const omega = poly(NOAA.node, t);
  const lambda = l0 + centre + NOAA.aberration + NOAA.nutationLongitude * Math.sin(omega * RAD);
  const eps = (poly(NOAA.obliquity, t) / ANGLE.arcsecPerDegree + NOAA.obliquityNutation * Math.cos(omega * RAD)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda * RAD));
  const q = NOAA.eqTime;
  const y = Math.tan(eps / q.half) ** q.square;
  const l = l0 * RAD;
  const ma = m * RAD;
  const eq =
    y * Math.sin(q.twoL * l) -
    q.eTerm * e * Math.sin(ma) +
    q.eyTerm * e * y * Math.sin(ma) * Math.cos(q.twoL * l) -
    q.yy * y * y * Math.sin(q.fourL * l) -
    q.ee * e * e * Math.sin(q.twoM * ma);
  return { decl, eqTime: (ANGLE.minutesPerDegree / RAD) * eq };
}

/** The sun's altitude (degrees, without refraction) at a moment (ms) at a place (degrees). */
export function solarAltitude(ms: number, lat: number, lon: number): number {
  const { decl, eqTime } = solarAngles(ms);
  const minJst = mod(ms / TIME.msPerMinute + TIME.jstOffsetMinutes, TIME.minutesPerDay);
  const trueSolar = minJst - TIME.jstOffsetMinutes + eqTime + ANGLE.minutesPerDegree * lon;
  const h = (trueSolar / ANGLE.minutesPerDegree - ANGLE.halfTurn) * RAD;
  const phi = lat * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h)) / RAD;
}

/** Day of the year (1 = 1 January) of a moment's JST date. */
export function dayOfYear(ms: number): number {
  const jst = new Date(ms + TIME.jstOffsetMinutes * TIME.msPerMinute);
  const start = Date.UTC(jst.getUTCFullYear(), 0, 1);
  const day = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  return Math.round((day - start) / TIME.msPerDay) + 1;
}

/** Relative air mass (Kasten & Young 1989); infinite with the sun down. */
function airMass(altitude: number): number {
  if (altitude <= 0) return Infinity;
  const k = SKY.airMass;
  return 1 / (Math.sin(altitude * RAD) + k.a * (altitude + k.b) ** k.c);
}

/** The haze of the sky through the year (Linke turbidity), from the parameters. */
export interface Haze {
  mean: number;
  amplitude: number;
  /** Day of the year with the clearest sky. */
  clearestDay: number;
}

/** Clear-sky direct normal and global horizontal irradiance (W/m², Ineichen & Perez 2002, sea level). */
export function clearSky(altitude: number, doy: number, haze: Haze): { dni: number; ghi: number } {
  if (altitude <= 0) return { dni: 0, ghi: 0 };
  const turn = (d: number) => (ANGLE.turn * RAD * d) / TIME.daysPerYear;
  const i0 = SKY.solarConstant * (1 + SKY.orbitAmplitude * Math.cos(turn(doy)));
  const tl = haze.mean - haze.amplitude * Math.cos(turn(doy - haze.clearestDay));
  const m = airMass(altitude);
  const k = SKY.ineichen;
  const s = Math.sin(altitude * RAD);
  const dni = k.dni * i0 * Math.exp(-k.dniExp * m * (tl - 1));
  const ghi = Math.max(0, k.ghi * i0 * s * Math.exp(-k.ghiExp * m * tl) * Math.exp(k.ghiCorr * m ** k.ghiCorrPower));
  return { dni: Math.min(dni, ghi / Math.max(s, SKY.tinySin)), ghi };
}

export { RAD };

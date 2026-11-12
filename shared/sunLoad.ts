// The sun on a standing person (#96): a candidate for 日なた温度 (feel-2), not used by the app yet.
//
// 日なた and 日かげ differ by the direct sunshine on the body, nothing else: the sky's scattered
// light reaches both alike. So the candidate adds only the direct beam, and it is zero when the sun
// is down, behind clouds, or the hour had no sunshine — 日なた is then the same as 日かげ.
//
//   direct on the body (W per m² of body) = fp(altitude) × DNI_clear(altitude) × sunshine share
//   - fp: the share of the body's surface the beam falls on, for a standing person, averaged over
//     which way they face (ASHRAE 55-2023, Table C-2; azimuth unknown, so all directions alike).
//     About 0.33 with the sun low, 0.08 with it overhead: a low winter sun meets more of the body.
//   - DNI_clear: the clear sky's direct beam, by the air it crosses (Meinel: 1361 × 0.7^(AM^0.678),
//     air mass by Kasten & Young 1989).
//   - sunshine share: the hour's sunshine (日照) against what it could have had (sun-up part of the
//     hour), as for the light (shared/brightness.ts). The same inputs for records and forecasts at
//     every station: no measured radiation (#103).
// The warming is the Bureau of Meteorology's radiation term with that load: 0.70·Q/(v₁₀ + 10),
// Q = absorptivity × direct on the body (absorptivity of skin and clothing about 0.7, ASHRAE 55).

import { sunUpFraction } from "./brightness";
import { type Where } from "./dayParts";
import { DEFAULT_LAT_LON, solarAltitude, stationLatLon } from "./sunTimes";

const latLonOf = (w: Where) => (w && typeof w === "object" ? w : (stationLatLon(w) ?? DEFAULT_LAT_LON));

/** ASHRAE 55-2023 Table C-2, standing: rows azimuth 0–180° (15° steps), columns altitude 0–90° (15° steps). */
const FP_STANDING = [
  [0.35, 0.35, 0.314, 0.258, 0.206, 0.144, 0.082],
  [0.342, 0.342, 0.31, 0.252, 0.2, 0.14, 0.082],
  [0.33, 0.33, 0.3, 0.244, 0.19, 0.132, 0.082],
  [0.31, 0.31, 0.275, 0.228, 0.175, 0.124, 0.082],
  [0.283, 0.283, 0.251, 0.208, 0.16, 0.114, 0.082],
  [0.252, 0.252, 0.228, 0.188, 0.15, 0.108, 0.082],
  [0.23, 0.23, 0.214, 0.18, 0.148, 0.108, 0.082],
  [0.242, 0.242, 0.222, 0.18, 0.153, 0.112, 0.082],
  [0.274, 0.274, 0.245, 0.203, 0.165, 0.116, 0.082],
  [0.304, 0.304, 0.27, 0.22, 0.174, 0.121, 0.082],
  [0.328, 0.328, 0.29, 0.234, 0.183, 0.125, 0.082],
  [0.344, 0.344, 0.304, 0.244, 0.19, 0.128, 0.082],
  [0.347, 0.347, 0.308, 0.246, 0.191, 0.128, 0.082],
];

/** The table averaged over facing (0–180° covers both sides; the ends count half: trapezoid). */
const FP_BY_ALTITUDE = FP_STANDING[0].map((_, j) => {
  const col = FP_STANDING.map((r) => r[j]);
  return (col.reduce((s, v) => s + v, 0) - (col[0] + col.at(-1)!) / 2) / (col.length - 1);
});

/** Projected area factor of a standing person, averaged over facing, by the sun's altitude (degrees). */
export function projectedArea(altitude: number): number {
  const a = Math.min(90, Math.max(0, altitude)) / 15;
  const j = Math.min(5, Math.floor(a));
  return FP_BY_ALTITUDE[j] + (FP_BY_ALTITUDE[j + 1] - FP_BY_ALTITUDE[j]) * (a - j);
}

/** Relative air mass (Kasten & Young 1989); infinite with the sun down. */
export function airMass(altitude: number): number {
  if (altitude <= 0) return Infinity;
  return 1 / (Math.sin((altitude * Math.PI) / 180) + 0.50572 * (altitude + 6.07995) ** -1.6364);
}

/** The clear sky's direct normal irradiance (W/m², Meinel), 0 with the sun down. */
export function clearDni(altitude: number): number {
  const m = airMass(altitude);
  return Number.isFinite(m) ? 1361 * 0.7 ** (m ** 0.678) : 0;
}

/** Skin and clothing absorb about this share of sunlight (ASHRAE 55). */
export const BODY_ABSORPTIVITY = 0.7;

/**
 * The direct sun on a standing person over JMA hour n of a date (W per m² of body, the hour's mean):
 * the clear beam on the body over the sun-up minutes, times the hour's sunshine share. Null without
 * the hour's sunshine; 0 with the sun down all hour.
 */
export function directOnBody(date: string, n: number, where: Where, sunHours: number | null | undefined): number | null {
  if (sunHours == null || !Number.isFinite(sunHours)) return null;
  const up = sunUpFraction(date, n, where);
  if (up <= 0) return 0;
  const c = latLonOf(where);
  let sum = 0;
  for (let m = (n - 1) * 60 + 2.5; m < n * 60; m += 5) {
    const alt = solarAltitude(date, m, c.lat, c.lon);
    if (alt > 0) sum += projectedArea(alt) * clearDni(alt);
  }
  const clearHour = sum / 12; // mean over the hour (12 five-minute steps), zero where the sun was down
  const share = Math.min(1, Math.max(0, sunHours / up));
  return clearHour * share;
}

/** feel-2's warming in the sun (℃): the Bureau of Meteorology's term with the direct sun on the body. */
export function directWarming(direct: number, wind10: number, absorptivity = BODY_ABSORPTIVITY): number {
  return (0.7 * absorptivity * Math.max(0, direct)) / (Math.max(0, wind10) + 10);
}

// ---- variants for the test board (2026-11-12 review of feel-2) ----------------------------------
//
// Two things the first candidate left out, after review:
//   - f_eff: ASHRAE 55 multiplies the beam on the body by the share of the body's surface that
//     exchanges radiation with the surroundings (standing 0.725). Without it the load is 1/0.725 too big.
//   - the sunlit ground's reflection (shortwave): the ground in the sun throws back ρ of the beam it
//     gets (DNI·sin altitude); a standing person sees the ground with half of the body
//     (0.5·f_eff·ρ·DNI·sin altitude). Larger with the sun high. Albedo ρ about 0.2 (paving, grass).
// Not in any variant: the heat from sun-baked ground and walls (longwave), the largest part of a
// summer noon in the sun; it depends on the surface (asphalt or grass) — a separate question.

/** Share of the body's surface exchanging radiation with the surroundings, standing (ASHRAE 55). */
export const BODY_EFFECTIVE = 0.725;
/** Shortwave reflectance of the ground around (paving, grass, soil: about 0.1–0.3). */
export const GROUND_ALBEDO = 0.2;

/**
 * The sun on a standing person over JMA hour n (W per m² of body): the direct beam, with ASHRAE's
 * f_eff when `effective`, plus the sunlit ground's reflection when `reflect`. Null without sunshine data.
 */
export function bodySunLoad(date: string, n: number, where: Where, sunHours: number | null | undefined, o: { effective?: boolean; reflect?: boolean } = {}): number | null {
  if (sunHours == null || !Number.isFinite(sunHours)) return null;
  const up = sunUpFraction(date, n, where);
  if (up <= 0) return 0;
  const c = latLonOf(where);
  const f = o.effective ? BODY_EFFECTIVE : 1;
  let sum = 0;
  for (let m = (n - 1) * 60 + 2.5; m < n * 60; m += 5) {
    const alt = solarAltitude(date, m, c.lat, c.lon);
    if (alt <= 0) continue;
    const beam = clearDni(alt);
    sum += f * projectedArea(alt) * beam;
    if (o.reflect) sum += 0.5 * BODY_EFFECTIVE * GROUND_ALBEDO * beam * Math.sin((alt * Math.PI) / 180);
  }
  return (sum / 12) * Math.min(1, Math.max(0, sunHours / up));
}

// The 肌感 candidate on UTCI (feel-3, #96, the independent review of 2026-11-13): 日なた and 日かげ as
// the same body heat balance (UTCI) under different radiation, not a shade index with a sun term
// added on top. Not used by the app yet (the test board shows it beside feel-1).
//
//   肌感 = UTCI(air T, mean radiant temperature Tmrt, effective 10 m wind, humidity)
//   Tmrt = T + ΔMRT, ΔMRT from the sun on the body (ASHRAE 55 Appendix C, SolarCal):
//     E = 0.5·f_eff·f_svv·(I_diff + R·GHI) + f_eff·fp(altitude)·I_dir        (W per m² of body)
//     ΔMRT = E·(α_sw / α_lw) / (h_r·f_eff), α_sw 0.7, α_lw 0.95, h_r 6, f_eff 0.725, R 0.2
//   日なた: in the beam, the whole sky seen (f_svv 1). 日かげ: no beam, part of the sky (f_svv 0.4:
//   the shade of a building or a tree hides most of it).
// The sky from the same inputs as everything else (records and forecasts alike, #103): the sun's
// position and the hour's sunshine and rain.
//   - Clear sky: Ineichen & Perez (2002) at sea level, with a Linke turbidity that follows the
//     season (about 3 in winter, 4.5 in the hazy, humid summer: provisional, to be checked against
//     JMA's direct radiation records).
//   - Sunshine share: the hour's sunshine against the minutes the clear beam would pass JMA's
//     sunshine threshold (120 W/m² direct), the same rule as Open-Meteo's sunshine_duration — a
//     low sun gives no 日照 even under a clear sky.
//   - Beam: the clear beam for that share. Global: the clear global times the light's own cloud
//     factor (shared/brightness.ts sunshineFactor: 1/3 with no sunshine, rain darker by its amount,
//     share^0.7 between) — one curve for the light and the radiation, checked against Kochi's
//     measured radiation (research/radiation). Diffuse: global − beam on level ground.
// Only the physical base (D18): no levels, no ちょうどよい. Where a value is felt as 暑い or 涼しい,
// how that moves as one gets used to the season, and each person's differences are the β model's.
// Left out: longwave exchange with the ground and the sky (sun-baked ground, a clear night's
// radiative cooling), a separate step.

import { RAIN_MM, sunshineFactor } from "./brightness";
import { dayEdges, type Where } from "./dayParts";
import { DEFAULT_LAT_LON, solarAltitude, stationLatLon } from "./sunTimes";
import { projectedArea, airMass } from "./sunLoad";
import { utci } from "./utci";

const latLonOf = (w: Where) => (w && typeof w === "object" ? w : (stationLatLon(w) ?? DEFAULT_LAT_LON));
const RAD = Math.PI / 180;

export const SOLARCAL = { fEff: 0.725, absorb: 0.7, emissivity: 0.95, hr: 6, albedo: 0.2 } as const;
/** Sky vault seen: in the sun (open), in the shade (a building's or a tree's shade). */
export const SKY_VIEW = { sun: 1, shade: 0.4 } as const;
/** JMA's sunshine: direct normal irradiance at or above this (W/m²). */
export const SUNSHINE_THRESHOLD = 120;
/** Global radiation with no sunshine at all, as a share of the clear sky's: overcast, rain. */

const dayOfYear = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000) + 1;

/** Extraterrestrial normal irradiance on a date (W/m²). */
export const extraterrestrial = (date: string) => 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear(date)) / 365));

/** Linke turbidity through the year (provisional): about 3 in mid-January, 4.5 in mid-July. */
export const linkeTurbidity = (date: string) => 3.75 - 0.75 * Math.cos((2 * Math.PI * (dayOfYear(date) - 15)) / 365);

/** Clear-sky direct normal and global horizontal irradiance (Ineichen & Perez 2002, sea level). */
export function clearSky(altitude: number, date: string): { dni: number; ghi: number } {
  if (altitude <= 0) return { dni: 0, ghi: 0 };
  const m = airMass(altitude);
  const i0 = extraterrestrial(date);
  const tl = linkeTurbidity(date);
  const s = Math.sin(altitude * RAD);
  const dni = 0.827 * i0 * Math.exp(-0.09 * m * (tl - 1));
  const ghi = Math.max(0, 0.868 * i0 * s * Math.exp(-0.0387 * m * tl) * Math.exp(0.01 * m ** 1.8));
  return { dni: Math.min(dni, ghi / Math.max(s, 1e-6)), ghi };
}

/**
 * SolarCal (ASHRAE 55 Appendix C): ΔMRT (K) of a standing person from the beam (normal, W/m²), the
 * diffuse and global horizontal irradiance, seeing `skyView` of the sky; the beam only in the sun.
 * Averaged over which way the person faces (projectedArea).
 */
export function solarCalDmrt(altitude: number, beam: number, diffuse: number, ghi: number, skyView: number): number {
  const { fEff, absorb, emissivity, hr, albedo } = SOLARCAL;
  const e = 0.5 * fEff * skyView * (diffuse + albedo * ghi) + (altitude > 0 ? fEff * projectedArea(altitude) * beam : 0);
  return (e * (absorb / emissivity)) / (hr * fEff);
}

export interface HourRadiation {
  /** The hour's sunshine share (0–1): sunshine over the minutes the clear beam passes 120 W/m². */
  share: number;
  /** Mean ΔMRT over the hour (K): in the sun, in the shade. */
  dmrtSun: number;
  dmrtShade: number;
  /** Mean global horizontal and diffuse irradiance over the hour (W/m²), for reading. */
  ghi: number;
  diffuse: number;
}

/** The radiation over JMA hour n (n−1 to n o'clock) from its sunshine (hours) and rain. Null without sunshine. */
export function hourRadiation(date: string, n: number, where: Where, sunHours: number | null | undefined, rain: boolean | number = false): HourRadiation | null {
  if (sunHours == null || !Number.isFinite(sunHours)) return null;
  const c = latLonOf(where);
  const steps: { alt: number; dni: number; ghi: number }[] = [];
  let possible = 0;
  for (let m = (n - 1) * 60 + 2.5; m < n * 60; m += 5) {
    const alt = solarAltitude(date, m, c.lat, c.lon);
    const sky = clearSky(alt, date);
    steps.push({ alt, ...sky });
    if (sky.dni >= SUNSHINE_THRESHOLD) possible += 5 / 60;
  }
  const share = possible > 0 ? Math.min(1, Math.max(0, sunHours / possible)) : 0;
  // Rain: true (some) or its amount (mm).
  const mm = typeof rain === "number" ? rain : rain ? RAIN_MM : 0;
  const through = sunshineFactor(share, mm >= RAIN_MM, mm);
  let sun = 0, shade = 0, ghiSum = 0, difSum = 0;
  for (const s of steps) {
    if (s.alt <= 0) continue;
    // The beam only where it passes the sunshine threshold (a low sun gives none to count).
    const beam = s.dni >= SUNSHINE_THRESHOLD ? share * s.dni : 0;
    const ghi = s.ghi * through;
    const level = beam * Math.sin(s.alt * RAD);
    const diffuse = Math.max(0, ghi - level);
    const g = Math.max(ghi, level + diffuse);
    sun += solarCalDmrt(s.alt, beam, diffuse, g, SKY_VIEW.sun);
    shade += solarCalDmrt(s.alt, 0, diffuse, g, SKY_VIEW.shade);
    ghiSum += g;
    difSum += diffuse;
  }
  const k = steps.length;
  return { share, dmrtSun: sun / k, dmrtShade: shade / k, ghi: ghiSum / k, diffuse: difSum / k };
}

/** Sunrise to sunset of a date (minutes JST), for callers that need it. */
export const daylight = (date: string, where: Where) => {
  const e = dayEdges(date, where);
  return { rise: e.rise, set: e.set };
};

/**
 * The effective 10 m wind for UTCI: the station's wind at 10 m (power law over open ground,
 * α 0.14), lowered for the surroundings by the ratio of their wind at a person's height to open
 * ground's (α of the setting: 0.14 open … 0.40 dense urban). UTCI then takes it down to 1.1 m itself.
 */
export function utciWind(v: number, measuredAt: number, alpha: number): number {
  const v10 = v * (10 / measuredAt) ** 0.14;
  return v10 * ((1.5 / 10) ** alpha / (1.5 / 10) ** 0.14);
}

/** feel-3: 肌感 in the sun and in the shade (UTCI). Null when a value is missing. */
export function feel3(
  t: number | null,
  rh: number | null,
  wind10: number | null,
  rad: HourRadiation | null,
): { sun: number | null; shade: number | null } {
  if (t == null || rh == null || wind10 == null) return { sun: null, shade: null };
  const shade = utci(t, t + (rad?.dmrtShade ?? 0), wind10, rh);
  const sun = rad ? utci(t, t + rad.dmrtSun, wind10, rh) : null;
  return { sun, shade };
}

/**
 * Global radiation of an hourly row (W/m², the hour's mean) from its sunshine and rain at the station
 * (#103): what 日なた uses, the same for records and forecasts at every station — measured radiation is
 * left out on purpose (only some stations have it, so a forecast day would differ by its data).
 * Null without sunshine.
 */
export function sunshineRadiation(row: { date: string; n: number; sun?: unknown; rain?: unknown }, where: Where): number | null {
  const sun = typeof row.sun === "number" && Number.isFinite(row.sun) ? row.sun : null;
  const mm = typeof row.rain === "number" && Number.isFinite(row.rain) ? row.rain : 0;
  return hourRadiation(row.date, row.n, where, sun, mm)?.ghi ?? null;
}

// rad.sunshine: 日照から推測した日射 — the hour's mean global radiation (W/m²) from its sunshine and
// rain at the place, the same for records and forecasts at every station (measured radiation is left
// out on purpose: only some stations have it).
//   Every 5 minutes of the hour: the sun's altitude, the clear sky (Ineichen & Perez).
//   share   = sunshine ÷ the hours the clear beam could pass JMA's 120 W/m² (0 when it cannot)
//   through = dim + (1 − dim)·share^power, dim = cloudy, or under rain (≥ rainRef mm)
//             max(rainFloor, rainDim·(mm/rainRef)^rainPower)
//   No sunshine and no rain (v2, #208 H-02b): the hours before and after tell the cloud apart —
//   both without sunshine too (a run of thick cloud) cloudyDark; sunshine in either (a cloud
//   between sunny spells) cloudyBetween; not known (night, not given, not yet) cloudy. Measured in
//   Kochi on one year, checked on another (research/brightness/h02.ts).
//   global  = mean of max(clear global × through, share × direct × sin h)
// 日照 is needed only while the sun can shine: at night (no moment above the threshold) a missing or
// blank 日照 is no loss, and the hour's light is the clear sky's diffuse alone, darkened.

import { defineFormula, type Inputs } from "../engine";
import { HOUR_STEPS, SUNSHINE_THRESHOLD, TIME } from "./constants";
import { clearSky, dayOfYear, RAD, solarAltitude } from "./position";

type Need = "hourStart" | "lat" | "lon" | "sunshine" | "rain" | "sunshineBefore" | "sunshineAfter";
type Optional = "sunshine" | "sunshineBefore" | "sunshineAfter";
type Param = "hazeMean" | "hazeAmplitude" | "hazeClearestDay" | "cloudy" | "cloudyDark" | "cloudyBetween" | "sharePower" | "rainRef" | "rainDim" | "rainPower" | "rainFloor";

/** The 12 moments of the hour: altitude and clear sky. */
function moments(x: Inputs<Need, Optional>, p: Record<Param, number>) {
  const doy = dayOfYear(x.hourStart);
  const haze = { mean: p.hazeMean, amplitude: p.hazeAmplitude, clearestDay: p.hazeClearestDay };
  return Array.from({ length: HOUR_STEPS.count }, (_, i) => {
    const ms = x.hourStart + (HOUR_STEPS.first + i * HOUR_STEPS.minutes) * TIME.msPerMinute;
    const alt = solarAltitude(ms, x.lat, x.lon);
    return { alt, ...clearSky(alt, doy, haze) };
  });
}

/**
 * The share of the clear sky's light an hour with no sunshine and no rain lets through, by its
 * neighbours: a run of cloud (both without sunshine), a cloud between sunny spells (sunshine in
 * either), or not known (cloudy).
 */
function noSunshine(before: number | null, after: number | null, p: Record<Param, number>): number {
  if ((before != null && before > 0) || (after != null && after > 0)) return p.cloudyBetween;
  return before === 0 && after === 0 ? p.cloudyDark : p.cloudy;
}

/** Hours of the hour the clear beam passes the sunshine threshold (可照時間). */
const possibleHours = (m: ReturnType<typeof moments>) => (m.filter((s) => s.dni >= SUNSHINE_THRESHOLD).length * HOUR_STEPS.minutes) / (HOUR_STEPS.count * HOUR_STEPS.minutes);

export const radSunshine = defineFormula({
  id: "rad.sunshine",
  // v2: an hour with no sunshine and no rain is told apart by the hours before and after (#208 H-02b).
  version: 2,
  key: "radSunshine",
  label: "日照から推測した日射",
  unit: "W/m²",
  needs: ["hourStart", "lat", "lon", "sunshine", "rain", "sunshineBefore", "sunshineAfter"] as Need[],
  // The neighbours only refine the no-sunshine hour: without them it keeps `cloudy`.
  optional: ["sunshine", "sunshineBefore", "sunshineAfter"] as Optional[],
  required: (x, p) => (possibleHours(moments(x, p)) > 0 ? ["sunshine"] : []),
  params: ["hazeMean", "hazeAmplitude", "hazeClearestDay", "cloudy", "cloudyDark", "cloudyBetween", "sharePower", "rainRef", "rainDim", "rainPower", "rainFloor"] as Param[],
  domain: { sunshine: { min: 0, max: 1 }, rain: { min: 0 }, sunshineBefore: { min: 0, max: 1 }, sunshineAfter: { min: 0, max: 1 } },
  compute: (x, p) => {
    const m = moments(x, p);
    const possible = possibleHours(m);
    const share = possible > 0 && x.sunshine != null ? Math.min(1, x.sunshine / possible) : 0;
    const dim =
      x.rain >= p.rainRef
        ? Math.max(p.rainFloor, p.rainDim * (x.rain / p.rainRef) ** p.rainPower)
        : share === 0
          ? noSunshine(x.sunshineBefore, x.sunshineAfter, p)
          : p.cloudy;
    const through = dim + (1 - dim) * share ** p.sharePower;
    const sum = m.reduce((acc, s) => {
      if (s.alt <= 0) return acc;
      const beam = s.dni >= SUNSHINE_THRESHOLD ? share * s.dni : 0;
      return acc + Math.max(s.ghi * through, beam * Math.sin(s.alt * RAD));
    }, 0);
    return sum / m.length;
  },
});

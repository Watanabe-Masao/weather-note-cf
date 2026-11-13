// 空の色（模式）: a representative colour of the sky for each 10 minutes, for the 明るさ strip (#: 空の色).
//
// The same inputs as the light (shared/brightness.ts), and nothing else: the sun's position, the
// hour's sunshine and its precipitation — what records and forecasts both have for every station.
// Global radiation and weather text are left out on purpose (a forecast day would differ from a record
// by its data). So a thin veil of cloud with full sunshine is drawn as blue sky, and the clouds of a
// night are not known (the light's own rule: the nearest hour of daylight, else between clear and
// cloudy).
//
// A schematic colour, not a measurement or a photograph:
//   1. The clear sky's tint by the sun's altitude. With the sun up, Preetham, Shirley & Smits (1999):
//      the zenith's chromaticity and the horizon's (80° from the zenith, the mean chromaticity over
//      azimuths so the bright sun's side does not take over), turbidity fixed at 3. With the sun down,
//      a table of twilight tints (TWILIGHT_TINT) — hand-made and provisional, no source yet.
//   2. The clouds turn it white: cloudiness c from the light's own cloud factor (1 under rain), and
//      tint = (1 − c)·clear + c·white (D65), in linear RGB. Sunshine is not cloud cover, so this is a
//      rough mix.
//   3. How light the colour is comes from the felt brightness (brightnessIndex), so the strip's two
//      views agree: OKLab lightness 0.16 + 0.11 × index, kept within 0.27–0.8 (colour still shows by
//      day; a night cell does not sink into the page). The clear zenith a little darker than the
//      horizon by day, the horizon a little lighter around sunrise and sunset; dark colours less
//      saturated (colour fades in the dark).
// One hour is drawn as six 10-minute colours: the sun moves more than 10° in an hour around sunrise
// and sunset, and the middle of the hour alone would miss the evening sky. The clouds stay the
// hour's (the data are hourly).

import { brightnessIndex, CLOUD, clearSkyLux, dayLights, nightSkyLux, RAIN_MM } from "./brightness";
import { DEFAULT_LAT_LON, solarAltitude, stationLatLon } from "./sunTimes";
import type { WeatherRow } from "./types";

/** Turbidity of the clear sky (Preetham): 2 very clear, 3 clear, higher hazy. Fixed: no station has it. */
export const TURBIDITY = 3;
/** Steps of an hour (10 minutes each). */
export const SKY_STEPS = 6;

/** The words of the sky, from the sun's altitude, the cloudiness and rain. */
export const SKY_WORDS = ["夜空", "薄明の青", "日の出前後の空", "夕方の空", "淡い青空", "青空", "雲の多い青空", "白い曇り空", "灰色の空", "暗い曇り空", "雨空", "雨の夜"] as const;
export type SkyWord = (typeof SKY_WORDS)[number];

export interface SkyColour {
  /** Looking up (sRGB hex). */
  zenith: string;
  /** Low over the land (sRGB hex). */
  horizon: string;
  word: SkyWord;
  /** The sun's altitude (degrees). */
  altitude: number;
}

const R = Math.PI / 180;
type P5 = [number, number, number, number, number];
const T = TURBIDITY;
// Perez coefficients of luminance-free chromaticity x, y (Preetham et al. 1999, appendix).
const CX: P5 = [-0.0193 * T - 0.2592, -0.0665 * T + 0.0008, -0.0004 * T + 0.2125, -0.0641 * T - 0.8989, -0.0033 * T + 0.0452];
const CY: P5 = [-0.0167 * T - 0.2608, -0.095 * T + 0.0092, -0.0079 * T + 0.2102, -0.0441 * T - 1.6537, -0.0109 * T + 0.0529];
const MX = [
  [0.00166, -0.00375, 0.00209, 0],
  [-0.02903, 0.06377, -0.03202, 0.00394],
  [0.11693, -0.21196, 0.06052, 0.25886],
];
const MY = [
  [0.00275, -0.0061, 0.00317, 0],
  [-0.04214, 0.0897, -0.04153, 0.00516],
  [0.15346, -0.26756, 0.0667, 0.26688],
];
const perez = (theta: number, gamma: number, [A, B, C, D, E]: P5) => (1 + A * Math.exp(B / Math.max(Math.cos(theta), 0.01))) * (1 + C * Math.exp(D * gamma) + E * Math.cos(gamma) ** 2);

/** The zenith's chromaticity for the sun's zenith angle ts (radians). */
function zenithXY(ts: number): [number, number] {
  const tv = [T * T, T, 1];
  const th = [ts ** 3, ts ** 2, ts, 1];
  const f = (M: number[][]) => {
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) s += tv[i] * M[i][j] * th[j];
    return s;
  };
  return [f(MX), f(MY)];
}

/** Chromaticity of the clear sky at view zenith angle theta and azimuth phi from the sun (radians). */
function skyXY(alt: number, theta: number, phi: number): [number, number] {
  const ts = (90 - alt) * R;
  const [xz, yz] = zenithXY(ts);
  const gamma = Math.acos(Math.max(-1, Math.min(1, Math.cos(ts) * Math.cos(theta) + Math.sin(ts) * Math.sin(theta) * Math.cos(phi))));
  return [(xz * perez(theta, gamma, CX)) / perez(0, ts, CX), (yz * perez(theta, gamma, CY)) / perez(0, ts, CY)];
}

type Lin = [number, number, number];
/** CIE xy (luminance 1) → linear sRGB (D65). */
function xyToLin([x, y]: [number, number]): Lin {
  const X = x / y;
  const Z = (1 - x - y) / y;
  return [3.2406 * X - 1.5372 - 0.4986 * Z, -0.9689 * X + 1.8758 + 0.0415 * Z, 0.0557 * X - 0.204 + 1.057 * Z];
}
const luminance = (v: Lin) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const unit = (v: Lin): Lin => {
  const Y = luminance(v);
  return v.map((c) => Math.max(0, c) / Y) as Lin;
};
const mix = (a: Lin, b: Lin, t: number): Lin => a.map((v, i) => v + (b[i] - v) * t) as Lin;
const fromHex = (h: string): Lin =>
  [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Lin;

/**
 * Tints of the sky with the sun down (degrees, zenith, horizon): bluest in civil and nautical twilight,
 * reddish at night (the town's light). Hand-made and provisional: no source yet (to be checked
 * against measurements).
 */
export const TWILIGHT_TINT: [number, string, string][] = [
  [0, "#7f9fd0", "#f2a05a"],
  [-3, "#5a6fb8", "#e08a80"],
  [-6, "#3550a8", "#8a78b0"],
  [-9, "#22357e", "#4a5088"],
  [-12, "#151f4c", "#2e3050"],
  [-18, "#10141f", "#2a2426"],
];

function twilightTint(alt: number): { z: Lin; h: Lin } {
  const t0 = TWILIGHT_TINT;
  if (alt >= t0[0][0]) return { z: unit(fromHex(t0[0][1])), h: unit(fromHex(t0[0][2])) };
  for (let i = 0; i < t0.length - 1; i++) {
    const [a0, z0, h0] = t0[i];
    const [a1, z1, h1] = t0[i + 1];
    if (alt <= a0 && alt >= a1) {
      const t = (a0 - alt) / (a0 - a1);
      return { z: unit(mix(fromHex(z0), fromHex(z1), t)), h: unit(mix(fromHex(h0), fromHex(h1), t)) };
    }
  }
  const last = t0[t0.length - 1];
  return { z: unit(fromHex(last[1])), h: unit(fromHex(last[2])) };
}

/** Where Preetham takes over from the twilight table (degrees); blended between 0 and this. */
const PREETHAM_FROM = 4;
const tintCache = new Map<number, { z: Lin; h: Lin }>();

/** The clear sky's tint (luminance 1) at the sun's altitude, zenith and horizon. Cached by 0.1°. */
export function clearTint(alt: number): { z: Lin; h: Lin } {
  const key = Math.round(alt * 10);
  const hit = tintCache.get(key);
  if (hit) return hit;
  const above = (a: number) => {
    let sx = 0;
    let sy = 0;
    let k = 0;
    for (let p = 0; p < 360; p += 30) {
      const [x, y] = skyXY(a, 80 * R, p * R);
      sx += x;
      sy += y;
      k++;
    }
    return { z: unit(xyToLin(skyXY(a, 0, 0))), h: unit(xyToLin([sx / k, sy / k])) };
  };
  let out: { z: Lin; h: Lin };
  if (alt >= PREETHAM_FROM) out = above(alt);
  else if (alt <= 0) out = twilightTint(alt);
  else {
    const a = above(PREETHAM_FROM);
    const b = twilightTint(0);
    const t = alt / PREETHAM_FROM;
    out = { z: mix(b.z, a.z, t), h: mix(b.h, a.h, t) };
  }
  if (tintCache.size > 4000) tintCache.clear();
  tintCache.set(key, out);
  return out;
}

// OKLab (Björn Ottosson 2020).
function toOklab(c: Lin): Lin {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab(L: number, a: number, b: number): Lin {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186168 * m + 1.707614701 * s];
}
const inGamut = (c: Lin) => Math.min(...c) >= -1e-4 && Math.max(...c) <= 1 + 1e-4;
function hexOf(c: Lin): string {
  return (
    "#" +
    c
      .map((x) => {
        const v = Math.min(1, Math.max(0, x));
        const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
        return Math.round(g * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/** A tint placed at OKLab lightness L: its chroma scaled with the lightness, less in the dark, pulled into the screen's gamut. */
export function placeTint(v: Lin, L: number): string {
  const [Lv, a, b] = toOklab(v);
  const dark = Math.min(1, Math.max(0.3, (L - 0.1) / 0.4));
  let s = (L / Lv) * dark;
  let c = fromOklab(L, a * s, b * s);
  for (let k = 0; k < 60 && !inGamut(c); k++) {
    s *= 0.94;
    c = fromOklab(L, a * s, b * s);
  }
  return hexOf(c);
}

/** Cloudiness 0–1 from the light's cloud factor (CLOUD): clear 1 → 0, average clouds 1/3 → 1. */
export const cloudiness = (factor: number) => Math.min(1, Math.max(0, Math.log(factor) / Math.log(CLOUD.cloudy)));

/** The words: what the sky would be called (schematic). */
export function skyWord(alt: number, c: number, rain: boolean, index: number, evening: boolean): SkyWord {
  if (rain) return alt > -6 ? "雨空" : "雨の夜";
  if (alt < -12) return "夜空";
  if (alt < -2) return c < 0.7 ? "薄明の青" : "暗い曇り空";
  if (alt < 6 && c < 0.6) return evening ? "夕方の空" : "日の出前後の空";
  if (c >= 0.7) return index >= 3.3 ? "白い曇り空" : "灰色の空";
  if (c >= 0.35) return "雲の多い青空";
  return alt >= 8 ? "青空" : "淡い青空";
}

const WHITE: Lin = [1, 1, 1];

/** The sky at the sun's altitude under a cloud factor (and rain). `evening`: after noon (for the word). */
export function skyAt(alt: number, factor: number, rain: boolean, evening: boolean): SkyColour {
  const lux = Math.max(clearSkyLux(alt) * factor, nightSkyLux(factor));
  const index = brightnessIndex(lux);
  const c = rain ? 1 : cloudiness(factor);
  const tint = clearTint(alt);
  const z = mix(tint.z, WHITE, c);
  const h = mix(tint.h, WHITE, c);
  const base = Math.max(0.27, Math.min(0.8, 0.16 + 0.11 * index));
  const day = Math.max(0, Math.min(1, (alt + 4) / 10));
  const glow = (1 - c) * Math.max(0, 1 - Math.abs(alt + 1) / 6);
  const Lz = Math.max(0.25, base - 0.07 * (1 - c) * day + 0.02 * c);
  const Lh = Math.min(0.86, base + 0.06 * (1 - c) * day - 0.03 * c + 0.16 * glow);
  return { zenith: placeTint(z, Lz), horizon: placeTint(h, Lh), word: skyWord(alt, c, rain, index, evening), altitude: Math.round(alt * 10) / 10 };
}

/**
 * The sky of each of a day's hourly rows (JMA hour n, n−1 to n o'clock) in SKY_STEPS steps of 10
 * minutes, each at its middle (n−1:05, n−1:15, …). The clouds are the hour's, as the light has them
 * (dayLights: a night or twilight hour from the nearest hour of daylight).
 */
export function daySky(rows: WeatherRow[], station: string | null | undefined): { n: number; steps: SkyColour[] }[] {
  const c = stationLatLon(station) ?? DEFAULT_LAT_LON;
  const lights = dayLights(rows, station);
  return rows.map((r, i) => {
    const rain = (typeof r.rain === "number" ? r.rain : 0) >= RAIN_MM;
    const steps = Array.from({ length: SKY_STEPS }, (_, k) => {
      const min = (r.n - 1) * 60 + k * 10 + 5;
      return skyAt(solarAltitude(r.date, min, c.lat, c.lon), lights[i].factor, rain, min > 720);
    });
    return { n: r.n, steps };
  });
}

/** "17:10" for hour n and step k (the step's start). */
export const stepTime = (n: number, k: number) => `${n - 1}:${String(k * 10).padStart(2, "0")}`;

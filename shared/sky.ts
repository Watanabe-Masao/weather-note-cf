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
//      the zenith's chromaticity and the horizon's (80° from the zenith, across from the sun — 90° in
//      azimuth, the pale blue one sees; the mean over azimuths turns yellow-green with a low sun),
//      turbidity fixed at 2. Below 8° the horizon turns to the low sun's colours (GOLDEN). With the sun down,
//      a table of twilight tints (TWILIGHT_TINT) — hand-made and provisional, no source yet.
//   2. The clouds turn it white: cloudiness c from the light's own cloud factor — under rain, the share
//      of the hour without sunshine, so a sunny shower stays blue — and tint = (1 − c)·clear + c·white
//      (D65), in linear RGB; rain then greys it by its amount times c. Sunshine is not cloud cover, so
//      this is a rough mix.
//   3. The colour is the sky as an adapted eye sees it (a clear day's blue, a twilight's deep blue, a
//      night's navy), never greyed to show the dark: its lightness follows how bright the sky looks
//      (apparent luminance, cd/m²) only within a narrow range (skyLightness), with its chroma kept.
//      The sky's luminance is the sun's and the twilight's light spread over the sky, plus the town's
//      glow at night by the surroundings (SKY_GLOW: Kyba et al. 2011), which lightens the navy a
//      little toward a cool grey. How bright it is shows in the strip's thin level line and the card. Strong light makes colour look stronger
//      (Hunt): from 明るい up the chroma grows to ×1.6, and the clear zenith is set a little darker
//      so a screen can show its deep blue. The clear zenith a little darker than the
//      horizon by day, the horizon a little lighter around sunrise and sunset; dark colours less
//      saturated (colour fades in the dark).
// One hour is drawn as six 10-minute colours: the sun moves more than 10° in an hour around sunrise
// and sunset, and the middle of the hour alone would miss the evening sky. The clouds stay the
// hour's (the data are hourly).

import { brightnessIndex, CLOUD, clearSkyLux, dayLights, glowPlace, luxText, nightSkyLux, RAIN_MM, rainFactor, SKY_GLOW, skyGlow, sunlessShare } from "./brightness";
// The town's glow lives with the light (the ground's night comes from it); the sky re-exports it.
export { SKY_GLOW, skyGlow } from "./brightness";
import { DEFAULT_LAT_LON, solarAltitude, stationLatLon } from "./sunTimes";
import type { WeatherRow } from "./types";

/**
 * Turbidity of the clear sky (Preetham): 2 very clear, 3 clear, higher hazy. Fixed: no station has it.
 * 2: a clear day in Japan is a clean, deep blue rather than a hazy one (渡辺さん, 2026-11-13).
 */
export const TURBIDITY = 2;
/** Steps of an hour (10 minutes each). */
export const SKY_STEPS = 6;

/** The words of the sky, from the sun's altitude, the cloudiness and rain. */
export const SKY_WORDS = ["夜空", "薄明の青", "日の出前後の空", "夕方の空", "淡い青空", "青空", "雲の多い青空", "晴れ間のにわか雨", "白い曇り空", "灰色の空", "暗い曇り空", "小雨の空", "雨空", "強い雨の空", "雨の夜"] as const;
export type SkyWord = (typeof SKY_WORDS)[number];

export interface SkyColour {
  /** Looking up (sRGB hex). */
  zenith: string;
  /** Low over the land (sRGB hex). */
  horizon: string;
  word: SkyWord;
  /** The sun's altitude (degrees). */
  altitude: number;
  /** The light on open ground at that moment (lux) and its felt index 0–6 (shared/brightness.ts). */
  lux: number;
  index: number;
  /** How bright the sky itself looks (cd/m²): its own light plus the town's glow (SKY_GLOW). */
  skyLuminance: number;
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
 * Tints of the sky with the sun down (degrees, zenith, horizon), the usual evening rather than a vivid
 * sunset (which the data cannot foresee; review of 2026-11-13): a soft orange and pink low down,
 * bluest in civil and nautical twilight,
 * navy at night (a Kochi photo, 2026-11-13 20:30: navy, no warm cast). Hand-made and provisional: no
 * source yet (to be checked against measurements).
 */
export const TWILIGHT_TINT: [number, string, string][] = [
  [0, "#7f9fd0", "#e9b08a"],
  [-3, "#5a6fb8", "#c99aa0"],
  [-6, "#3550a8", "#8483ad"],
  [-9, "#22357e", "#4a5088"],
  [-12, "#151f4c", "#1f2a52"],
  [-18, "#0c1430", "#14203f"],
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

/** The low sun's horizon (degrees): orange at 0, pale gold at 4, the day's pale blue from 8. */
const GOLDEN = [0, 4, 8] as const;
const GOLD_TINT: Lin = unit(fromHex("#ecdcc4"));
/** Where Preetham takes over from the twilight table (degrees); blended between 0 and this. */
const PREETHAM_FROM = 4;
const tintCache = new Map<number, { z: Lin; h: Lin }>();

/**
 * From tint a to tint b by turning the hue (OKLCh) in the given direction (−1: decreasing hue, e.g.
 * gold → pink → blue), with the chroma moving straight between them (never below the smaller): no
 * grey on the way.
 */
function hueTurn(a: Lin, b: Lin, t: number, dir: 1 | -1): Lin {
  const A = toOklab(a);
  const B = toOklab(b);
  const ha = Math.atan2(A[2], A[1]);
  let hb = Math.atan2(B[2], B[1]);
  if (dir < 0) while (hb > ha) hb -= 2 * Math.PI;
  else while (hb < ha) hb += 2 * Math.PI;
  const u = Math.min(1, Math.max(0, t));
  const h = ha + (hb - ha) * u;
  const C = Math.hypot(A[1], A[2]) * (1 - u) + Math.hypot(B[1], B[2]) * u;
  const L = A[0] * (1 - u) + B[0] * u;
  return unit(fromOklab(L, C * Math.cos(h), C * Math.sin(h)).map((x) => Math.max(0, x)) as Lin);
}

/** The clear sky's tint (luminance 1) at the sun's altitude, zenith and horizon. Cached by 0.1°. */
export function clearTint(alt: number): { z: Lin; h: Lin } {
  const key = Math.round(alt * 10);
  const hit = tintCache.get(key);
  if (hit) return hit;
  const above = (a: number) => {
    // The horizon is taken across from the sun (90° away: the pale blue one sees), not the mean over
    // azimuths, which the low sun's side tints yellow-green (Preetham's known bias). The low sun's
    // glow is drawn by GOLDEN below.
    const side = skyXY(a, 80 * R, 90 * R);
    return { z: unit(xyToLin(skyXY(a, 0, 0))), h: unit(xyToLin(side)) };
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
  // The low sun's horizon (0–8°): the sunset orange, through a pale gold, to the day's pale blue —
  // not Preetham's low-sun horizon, which turns yellow-green (a known bias of the model).
  if (alt > 0 && alt < GOLDEN[2]) {
    const day = above(GOLDEN[2]).h;
    const orange = twilightTint(0).h;
    out = {
      z: out.z,
      // Gold to the day's pale blue by turning the hue through pink, not by mixing (gold and blue are
      // opposite: a mix passes through grey).
      h: alt <= GOLDEN[1] ? mix(orange, GOLD_TINT, (alt - GOLDEN[0]) / (GOLDEN[1] - GOLDEN[0])) : hueTurn(GOLD_TINT, day, (alt - GOLDEN[1]) / (GOLDEN[2] - GOLDEN[1]), -1),
    };
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

/** A tint placed at OKLab lightness L: its chroma scaled with the lightness (× vivid), less in the dark, pulled into the screen's gamut. */
export function placeTint(v: Lin, L: number, vivid = 1, minChroma = 0): string {
  const [Lv, a, b] = toOklab(v);
  // Chroma kept in proportion to the lightness: the colour stays itself, never greyed to show the dark.
  let s = (L / Lv) * vivid;
  // A floor on the chroma (a clear sky's blue): raised to it when the tint would be paler.
  const chroma = Math.hypot(a, b);
  if (minChroma > 0 && chroma > 1e-6 && chroma * s < minChroma) s = minChroma / chroma;
  let c = fromOklab(L, a * s, b * s);
  for (let k = 0; k < 60 && !inGamut(c); k++) {
    s *= 0.94;
    c = fromOklab(L, a * s, b * s);
  }
  return hexOf(c);
}

/** Cloudiness 0–1 from the light's cloud factor (CLOUD): clear 1 → 0, average clouds 1/3 → 1. */
export const cloudiness = (factor: number) => sunlessShare(factor, CLOUD.cloudy);

/** Under rain: the share of the hour without sunshine, read back from the cloud factor (rainFactor of the rain, raised to it). */
export const rainCloudiness = (factor: number, mm: number) => sunlessShare(factor, rainFactor(mm));

/** The words: what the sky would be called (schematic). */
export function skyWord(alt: number, c: number, rainMm: number, index: number, evening: boolean): SkyWord {
  if (rainMm >= RAIN_MM) {
    if (alt > 0 && c < 0.5) return "晴れ間のにわか雨";
    return alt <= -6 ? "雨の夜" : rainMm < 1 ? "小雨の空" : rainMm >= 10 ? "強い雨の空" : "雨空";
  }
  if (alt < -12) return "夜空";
  if (alt < -2) return c < 0.7 ? "薄明の青" : "暗い曇り空";
  if (alt < 6 && c < 0.6) return evening ? "夕方の空" : "日の出前後の空";
  if (c >= 0.7) return index >= 3.3 ? "白い曇り空" : "灰色の空";
  if (c >= 0.35) return "雲の多い青空";
  return alt >= 8 ? "青空" : "淡い青空";
}

const WHITE: Lin = [1, 1, 1];

/**
 * The tint of the town's glow: what a lit night sky turns to. Japan's street lights are now mostly
 * white LEDs (not the orange sodium lamps of the European measurements), and the air scatters their
 * blue the most, so the glow is a cool, slightly bluish grey; clouds over a town look neutral grey.
 * Checked against a photo of Kochi (薊野, 2026-11-13 20:30, a residential street, partly cloudy):
 * navy sky, grey clouds, no warm cast.
 */
const GLOW_TINT: Lin = unit(fromHex("#9aa3b8"));

/**
 * How light the sky's colour is drawn, from its apparent luminance (cd/m²), on a log scale and narrow:
 * 0.0001 cd/m² (a dark night) → 0.33, each tenfold +0.05, up to 0.74 (a bright daytime sky). The eye
 * adapts, so a night sky is seen as navy, not as a dark grey (渡辺さん, 2026-11-13: "グレースケールを
 * 重ねて明るさを表現するとおかしくなる"): the colour shows the sky; how bright it is, the level line
 * and the card's numbers.
 */
export const skyLightness = (cdm2: number) => Math.min(0.74, Math.max(0.33, 0.33 + 0.05 * Math.log10(Math.max(1e-4, cdm2) / 1e-4)));

/** One step of how a sky colour was made, for tracing it to its formula and source. */
export interface SkyStep {
  key: "base" | "cloud" | "town" | "light" | "vivid";
  label: string;
  /** The colour after this step (before the last, shown at a fixed lightness so the tint is seen). */
  zenith: string;
  horizon: string;
  /** What was computed, with its numbers. */
  note: string;
  /** Where the numbers come from; provisional when not from a measurement or a published model. */
  source: string;
  provisional: boolean;
}

/** The tint of rain cloud: a slightly cool grey (rain shows darker and bluer than a plain overcast). */
const RAIN_TINT: Lin = unit(fromHex("#8c97a8"));
/** Lightness at which the steps before the last are shown. */
const TRACE_L = 0.62;

function compute(alt: number, factor: number, rainMm: number, evening: boolean, alpha: number | null | undefined, trace: SkyStep[] | null): SkyColour {
  const mm = Number.isFinite(rainMm) ? Math.max(0, rainMm) : 0;
  const rain = mm >= RAIN_MM;
  // The light on open ground (the levels, unchanged by the town: shared/brightness.ts).
  const lux = Math.max(clearSkyLux(alt) * factor, nightSkyLux(factor, alpha));
  const index = brightnessIndex(lux);
  // Under rain the cloud factor is rainFactor^(share of the hour without sunshine) (brightness.ts):
  // the same share makes the sky white and grey, so a sunny shower stays a mostly blue sky.
  const c = rain ? rainCloudiness(factor, mm) : cloudiness(factor);
  const show = (z: Lin, h: Lin) => ({ zenith: placeTint(z, TRACE_L), horizon: placeTint(h, TRACE_L) });

  // 1. The clear sky's tint by the sun's altitude.
  const tint = clearTint(alt);
  trace?.push({
    key: "base",
    label: "基準色（太陽の高さ）",
    ...show(tint.z, tint.h),
    note: `太陽 ${alt.toFixed(1)}°`,
    source:
      alt >= 8
        ? "Preetham, Shirley & Smits 1999（霞の度合い 2）。地平は太陽の真横の方角"
        : alt > 0
          ? "天頂：Preetham 1999。地平：日の出入りの色（橙→金→淡い青、仮）"
          : "薄明の色の表（手で作った仮の値、出典なし）",
    provisional: alt < 8,
  });

  // 2. Clouds turn it white; rain to a cool grey, the heavier the more.
  const rainShare = rain ? c * Math.min(1, 0.4 + 0.6 * (Math.log(mm / RAIN_MM) / Math.log(40))) : 0;
  const zc = mix(mix(tint.z, WHITE, c), RAIN_TINT, rainShare);
  const hc = mix(mix(tint.h, WHITE, c), RAIN_TINT, rainShare);
  trace?.push({
    key: "cloud",
    label: "雲・雨",
    ...show(zc, hc),
    note: rain ? `雨 ${mm.toFixed(1)}mm：曇りの度合い ${c.toFixed(2)}（日照のなかった割合）、雨雲の灰色 ${(rainShare * 100).toFixed(0)}%` : `曇りの度合い ${c.toFixed(2)}（雲の係数 ${factor.toFixed(2)}）`,
    source: rain ? "雲の係数：Janiczek & DeYoung 1987 の暗い層雲から降水量で連続に（仮）" : "雲の係数：日照の割合（Janiczek & DeYoung 1987 の空の区分）",
    provisional: rain,
  });

  // 3. The town's glow (night): lightens the navy toward a cool grey.
  const glowL = skyGlow(alpha, c);
  const natural = (clearSkyLux(alt) * factor) / Math.PI;
  // Kyba's measurements are the whole night sky (stars and airglow included), and the ground's
  // night is π × the same (brightness.ts): the larger of the two, not their sum, so neither counts
  // the starlight twice and lux ≈ π × sky luminance at night.
  const sky = Math.max(natural, glowL);
  const lit = Math.max(0, glowL - SKY_GLOW[0].clear) / sky;
  const z = mix(zc, GLOW_TINT, 0.35 * lit);
  const h = mix(hc, GLOW_TINT, Math.min(1, 0.45 * lit));
  const place = glowPlace(alpha);
  trace?.push({
    key: "town",
    label: "街の明かり",
    ...show(z, h),
    note: `${place.label}：街の明かり ${luminanceText(glowL)}、見える空のうち ${(lit * 100).toFixed(0)}%`,
    source: place.alpha === 0.14 || place.alpha === 0.3 ? "Kyba ほか 2011（ベルリンの郊外・市内の実測）" : "Kyba ほか 2011 の間・外挿（仮）",
    provisional: !(place.alpha === 0.14 || place.alpha === 0.3),
  });

  // 4. How light: the sky's apparent luminance, narrow (an adapted eye), never greyed.
  const base = skyLightness(sky);
  const day = Math.max(0, Math.min(1, (alt + 4) / 10));
  const glow = (1 - c) * Math.max(0, 1 - Math.abs(alt + 1) / 6);
  const sun = Math.max(0, Math.min(1, (index - 3) / 3));
  const Lz = Math.max(0.3, base - (0.05 + 0.08 * sun) * (1 - c) * day + 0.02 * c);
  const Lh = Math.min(0.86, base + 0.06 * (1 - c) * day - 0.03 * c + 0.08 * glow + 0.03 * lit);
  trace?.push({
    key: "light",
    label: "明るさ",
    zenith: placeTint(z, Lz),
    horizon: placeTint(h, Lh),
    note: `空の輝度 ${luminanceText(sky)} → 明度 ${base.toFixed(2)}（天頂 ${Lz.toFixed(2)}・地平 ${Lh.toFixed(2)}）。地上は ${luxText(lux)}`,
    source: "空の輝度＝地上の照度÷π と街の明かり（Kyba 2011）の大きい方。明度は対数で 0.33〜0.74（仮）",
    provisional: true,
  });

  // 5. How vivid: a clear sky is clean; strong light looks stronger (Hunt); twilight and night calm.
  // Low sun: the Hunt boost is kept at half its noon value for a clear sky (morning and evening are
  // not duller than they are).
  const boost = Math.max(sun, 0.5 * (1 - c) * day);
  const vivid = (1 + 0.6 * boost) * (1 + 0.35 * (1 - c) * day) * (alt < -4 ? 0.8 : 1);
  // A clear zenith stays a clean blue from noon through civil twilight: ozone takes the yellow-orange
  // out of a low sun's light, so the zenith deepens rather than whitens — which Preetham's model
  // (no ozone) misses. Floor 0.13 (OKLab chroma) down to −6°, easing to 0.07 by −12° (a calm navy).
  const zFloor = (1 - c) * (alt >= -6 ? 0.13 : alt >= -12 ? 0.13 - (0.06 * (-6 - alt)) / 6 : 0.07);
  const out = { zenith: placeTint(z, Lz, vivid, zFloor), horizon: placeTint(h, Lh, vivid, (1 - c) * 0.05) };
  trace?.push({
    key: "vivid",
    label: "鮮やかさ",
    ...out,
    note: `彩度 ×${vivid.toFixed(2)}、晴れの天頂の彩度の下限 ${zFloor.toFixed(2)}`,
    source: "強い光ほど色が強く見える（ハント効果、Hunt 1952）。晴れの天頂はオゾンの吸収で低い太陽でも青い（Preetham のモデルにない分を下限で補う）。倍率・下限は仮",
    provisional: true,
  });
  return { ...out, word: skyWord(alt, c, mm, index, evening), altitude: Math.round(alt * 10) / 10, lux, index, skyLuminance: sky };
}

/**
 * The sky at the sun's altitude under a cloud factor and the hour's precipitation (mm). `evening`:
 * after noon (for the word). `alpha`: the surroundings (周りの様子), for the town's glow at night.
 */
export function skyAt(alt: number, factor: number, rainMm: number, evening: boolean, alpha?: number | null): SkyColour {
  return compute(alt, factor, rainMm, evening, alpha, null);
}

/** The same, with each step of how the colour was made (formula and source), for checking it. */
export function skyTrace(alt: number, factor: number, rainMm: number, evening: boolean, alpha?: number | null): { sky: SkyColour; steps: SkyStep[] } {
  const steps: SkyStep[] = [];
  return { sky: compute(alt, factor, rainMm, evening, alpha, steps), steps };
}

/**
 * The sky of each of a day's hourly rows (JMA hour n, n−1 to n o'clock) in SKY_STEPS steps of 10
 * minutes, each at its middle (n−1:05, n−1:15, …). The clouds are the hour's, as the light has them
 * (dayLights: a night or twilight hour from the nearest hour of daylight).
 */
export function daySky(rows: WeatherRow[], station: string | null | undefined, alpha?: number | null): { n: number; steps: SkyColour[] }[] {
  const c = stationLatLon(station) ?? DEFAULT_LAT_LON;
  const lights = dayLights(rows, station, alpha);
  return rows.map((r, i) => {
    const mm = typeof r.rain === "number" && Number.isFinite(r.rain) ? r.rain : 0;
    const steps = Array.from({ length: SKY_STEPS }, (_, k) => {
      const min = (r.n - 1) * 60 + k * 10 + 5;
      return skyAt(solarAltitude(r.date, min, c.lat, c.lon), lights[i].factor, mm, min > 720, alpha);
    });
    return { n: r.n, steps };
  });
}

/** "約2.4 mcd/m²", "約1,000 cd/m²": a sky's luminance. */
export function luminanceText(cdm2: number): string {
  if (cdm2 < 1) {
    const m = cdm2 * 1000;
    return `約${m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString("ja-JP")} mcd/m²`;
  }
  const d = 10 ** Math.max(0, Math.floor(Math.log10(cdm2)) - 1);
  return `約${(Math.round(cdm2 / d) * d).toLocaleString("ja-JP")} cd/m²`;
}

/** "17:10" for hour n and step k (the step's start). */
export const stepTime = (n: number, k: number) => `${n - 1}:${String(k * 10).padStart(2, "0")}`;

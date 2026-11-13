// How bright it is outdoors (照度, lux on open level ground), and how bright that feels.
//
// The eye answers to ratios, not differences (Weber–Fechner): ten times the light reads as one
// step brighter. So the felt brightness is a scale of levels cut by powers of ten, and inside a
// level by the logarithm of the light:
//   暗い < 1 lx ≤ 薄明 < 100 ≤ 薄暗い < 1,000 ≤ 明るい < 1万 ≤ とても明るい < 5万 ≤ 日差しの明るさ
// The levels name the amount of light, not a feeling: the top is the light of open sunshine (most
// sunny noons, winter too), not "まぶしい" — glare depends on where one looks and what the eye is
// used to, which the step-out impression (STEP_OUT) is for.
// as a continuous index 0–6 (one unit per level), which is what the graphs draw.
//
// The same inputs for every day: a record and a forecast are compared side by side, so the light is
// computed only from what both have for every station and hour — the sun's position, the hour's
// sunshine (日照) and its precipitation. Weather text (missing from many records) and global
// radiation (measured at few stations, forecast everywhere) are left out on purpose, or a forecast
// day would differ from a record by its data rather than its weather.
//
// The light of an hour: the clear sky by the sun's altitude, times a cloud factor — but never below
// the night sky over a town (NIGHT_SKY): stars, airglow and the town's light scattered back by the air,
//     about 0.003 lx under a clear sky, and about ten times that under cloud, which reflects the
//     street lights down. The bottom of the scale (0.0001 lx) is true darkness, which a town's night
//     never reaches. The moon is left out (up to 0.3 lx at full moon).
// The clear sky (clearSkyLux) is the U.S. Naval Observatory model (Janiczek & DeYoung 1987) from the
// sun high up down to −5°, which runs smoothly through the horizon (about 750 lx at 0°), and below
// −6° a table of twilight measurements down to starlight (0.001 lx at
// −18°). research/brightness/model-review.md compares it with the IES formula used before, which
// was about twice too bright with the sun 0.5–3° up and jumped at the horizon.
// The cloud factor (CLOUD) follows the same report's sky conditions: clear 1, average clouds 1/3,
// dark stratus 1/10 (taken when it rains: 0.5 mm or more, the least a record shows). In daylight it
// comes from the hour's sunshine against the sunshine the hour could have had; with the sun down the
// sunshine is always 0 and says nothing, so rain decides, or else the nearest hour of daylight
// (dayLights).
// The sun's altitude is taken at the middle of the hour (JMA hour n covers n−1 to n o'clock).

import { dayEdges, type Where } from "./dayParts";
import { DEFAULT_LAT_LON, solarAltitude, stationLatLon } from "./sunTimes";
import type { WeatherRow } from "./types";

export const BRIGHTNESS_LEVELS = [
  { id: "dark", label: "暗い", from: 0.0001, example: "町の夜空・月明かり（真っ暗は 0.0001lx）" },
  { id: "twilight", label: "薄明", from: 1, example: "日の出前・日没後" },
  { id: "dim", label: "薄暗い", from: 100, example: "厚い雲の夕方" },
  { id: "bright", label: "明るい", from: 1_000, example: "曇りの昼" },
  { id: "veryBright", label: "とても明るい", from: 10_000, example: "晴れの朝夕・冬の昼" },
  { id: "dazzling", label: "日差しの明るさ", from: 50_000, example: "晴れの昼" },
] as const;
/** The top of the scale (index 6): the brightest sun on open ground. */
const TOP = 130_000;
const EDGES = [...BRIGHTNESS_LEVELS.map((l) => l.from), TOP];

/**
 * How much of the clear sky's light gets through (Janiczek & DeYoung's sky conditions): clear (cloud
 * under 30%) 1, average clouds 1/3, dark stratus (rain, snow) 1/10. Unknown: halfway in steps (log)
 * between clear and average clouds.
 */
export const CLOUD = { clear: 1, cloudy: 1 / 3, rain: 1 / 10, unknown: 1 / Math.sqrt(3) } as const;

/**
 * The night sky over a town (lux): clear about 0.003 (stars, airglow, a little sky glow), overcast
 * about 0.03 (the town's light reflected by the clouds). In between by the cloud factor (log), at
 * overcast from average clouds down.
 */
export const NIGHT_SKY = { clear: 0.003, overcast: 0.03 } as const;
export function nightSkyLux(factor: number): number {
  const t = Math.min(1, Math.max(0, Math.log(factor) / Math.log(CLOUD.cloudy)));
  return NIGHT_SKY.clear * (NIGHT_SKY.overcast / NIGHT_SKY.clear) ** t;
}

/** Lux → the felt index 0–6 (log-linear inside each level). */
export function brightnessIndex(lux: number): number {
  const x = Math.min(TOP, Math.max(EDGES[0], lux));
  for (let k = 0; k < EDGES.length - 1; k++)
    if (x < EDGES[k + 1] || k === EDGES.length - 2) return k + Math.log(x / EDGES[k]) / Math.log(EDGES[k + 1] / EDGES[k]);
  return 6;
}

/** The felt index 0–6 → lux. */
export function luxOf(index: number): number {
  const i = Math.min(6, Math.max(0, index));
  const k = Math.min(EDGES.length - 2, Math.floor(i));
  return EDGES[k] * (EDGES[k + 1] / EDGES[k]) ** (i - k);
}

/** The level of an index (its name). */
export const brightnessLevel = (index: number) => BRIGHTNESS_LEVELS[Math.min(5, Math.max(0, Math.floor(index)))];

/** "約3万lx", "約450lx", "約0.03lx". */
export function luxText(lux: number): string {
  if (lux < 0.001) return "0.001lx未満";
  if (lux < 1) return `約${Number(lux.toPrecision(1))}lx`;
  if (lux >= 10_000) return `約${Math.round(lux / 10_000)}万lx`;
  const d = 10 ** Math.max(0, Math.floor(Math.log10(lux)) - 1);
  return `約${(Math.round(lux / d) * d).toLocaleString("ja-JP")}lx`;
}

/** Table cells: "5万", "7千", "450", "<1" (lux, two figures at most). */
export function luxShort(lux: number): string {
  if (lux < 1) return "<1";
  if (lux >= 10_000) return `${Math.round(lux / 10_000)}万`;
  if (lux >= 1_000) return `${Math.round(lux / 1_000)}千`;
  const d = 10 ** Math.max(0, Math.floor(Math.log10(lux)) - 1);
  return String(Math.round(lux / d) * d);
}

/** The axis tag of a felt index: its lux, short enough for the narrow tag ("3万lx", "0.03lx"). */
export const luxTag = (index: number) => {
  const lux = luxOf(index);
  return lux < 1 ? `${Number(lux.toPrecision(1))}lx` : `${luxShort(lux)}lx`;
};

/** How many times brighter a is than b (indices): "2.5倍", "0.4倍", "同じ"; "" when either is missing. */
export function brightnessRatio(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return "";
  const r = luxOf(a) / luxOf(b);
  if (Math.abs(Math.log10(r)) < 0.02) return "同じ";
  return `${r >= 10 ? Math.round(r) : r >= 1 ? r.toFixed(1) : r.toFixed(2)}倍`;
}

/** "とても明るい（約3万lx）". */
export const brightnessText = (index: number | null | undefined) => (index == null ? "—" : `${brightnessLevel(index).label}（${luxText(luxOf(index))}）`);

/** Twilight measurements, clear sky, sun below the horizon: degrees → lux (log-interpolated). Used below −6°. */
const TWILIGHT: [number, number][] = [
  [0, 700],
  [-1, 330],
  [-2, 140],
  [-3, 55],
  [-4, 20],
  [-5, 8],
  [-6, 3.4],
  [-8, 0.45],
  [-10, 0.06],
  [-12, 0.008],
  [-15, 0.0015],
  [-18, 0.001],
];

export function twilightLux(deg: number): number {
  if (deg >= 0) return TWILIGHT[0][1];
  if (deg <= -18) return TWILIGHT.at(-1)![1];
  for (let i = 0; i < TWILIGHT.length - 1; i++) {
    const [d0, l0] = TWILIGHT[i];
    const [d1, l1] = TWILIGHT[i + 1];
    if (deg <= d0 && deg >= d1) return l0 * (l1 / l0) ** ((d0 - deg) / (d0 - d1));
  }
  return TWILIGHT.at(-1)![1];
}

const RAD = Math.PI / 180;

/**
 * The U.S. Naval Observatory's sun illuminance on level ground (Janiczek & DeYoung 1987, the
 * subroutine ATMOS; mean Earth–sun distance): the direct and the scattered light through an air mass
 * that follows the curve of the Earth, so it stays finite at and just below the horizon. At the
 * geometric altitude: the report's refraction (REFR) lifts the sun about 0.5° near the horizon but
 * stops at −5/6°, which makes a step of half a level; without it the light runs smoothly and meets
 * the twilight measurements below the horizon (research/brightness/model-review.md).
 */
export function usnoSunLux(deg: number): number {
  const h = deg;
  const X = 753.66156;
  const u = Math.sin(h * RAD);
  const s = Math.asin((X * Math.cos(h * RAD)) / (X + 1));
  const m = X * (Math.cos(s) - u) + Math.cos(s);
  return 133_775 * (Math.exp(-0.21 * m) * u + 0.0289 * Math.exp(-0.042 * m) * (1 + ((h + 90) * u) / 57.29577951));
}

/** Where the USNO model hands over to the twilight table (degrees): the model above −5°, the table below −6°, blended (log) between. */
const HANDOVER = [-5, -6] as const;

/** Clear sky by the sun's altitude: degrees → lux on level ground, from the sun high up to starlight. */
export function clearSkyLux(deg: number): number {
  if (deg >= HANDOVER[0]) return usnoSunLux(deg);
  if (deg <= HANDOVER[1]) return twilightLux(deg);
  const t = (HANDOVER[0] - deg) / (HANDOVER[0] - HANDOVER[1]);
  return usnoSunLux(deg) ** (1 - t) * twilightLux(deg) ** t;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The part of JMA hour n (n−1 to n o'clock) with the sun up (0–1). */
export function sunUpFraction(date: string, n: number, station: Where): number {
  const e = dayEdges(date, station);
  return Math.max(0, Math.min(n * 60, e.set) - Math.max((n - 1) * 60, e.rise)) / 60;
}

/**
 * The sun's altitude (degrees) below which a clear sky gives no sunshine: 日照 counts only the
 * minutes when the direct sun is 120 W/m² or more (WMO), which a clear sky reaches at about 3° (5° in
 * haze). Kochi 2025-11-01 (clear afternoon): 16–17 o'clock had 0.9 h, the sun fell below 3° at 16:54;
 * 17–18 o'clock, 14 minutes of sun, had 0 (#132). Provisional: to be checked with more clear days.
 */
export const SUNSHINE_ALT = 3;

const sunshineCache = new Map<string, number>();

/**
 * The part of JMA hour n (0–1) that could have had sunshine: the sun above SUNSHINE_ALT. The share of
 * an hour's sunshine is taken against this, not against the sun-up time — or every clear sunrise and
 * sunset hour would read as partly cloudy (#132).
 */
export function sunshineFraction(date: string, n: number, station: Where): number {
  const key = `${typeof station === "object" && station ? `${station.lat},${station.lon}` : (station ?? "")}/${date}/${n}`;
  const hit = sunshineCache.get(key);
  if (hit != null) return hit;
  const c = typeof station === "object" && station ? station : (stationLatLon(station) ?? DEFAULT_LAT_LON);
  let k = 0;
  for (let m = (n - 1) * 60 + 1; m < n * 60; m += 2) if (solarAltitude(date, m, c.lat, c.lon) > SUNSHINE_ALT) k++;
  const v = k / 30;
  if (sunshineCache.size > 20_000) sunshineCache.clear();
  sunshineCache.set(key, v);
  return v;
}

/** The hours of a day that could have had sunshine (the sun above SUNSHINE_ALT). */
export function sunshineDayHours(date: string, station: Where): number {
  let h = 0;
  for (let n = 1; n <= 24; n++) h += sunshineFraction(date, n, station);
  return h;
}

/** Below this much of the hour that could have had sunshine, the sunshine says too little; rain or a neighbour decides. */
const MIN_UP = 0.25;

/** Rain (or snow as water) in an hour that counts as rain (mm): the least a JMA record shows, so a forecast's drizzle below it does not. */
export const RAIN_MM = 0.5;

/**
 * Under rain, how much of the clear sky's light gets through, by the hour's precipitation (mm): dark
 * stratus (CLOUD.rain, 1/10) at the least a record shows (RAIN_MM), darker as the rain gets heavier
 * (thicker cloud): ×(mm / 0.5)^−0.25, so 2 mm 1/14, 5 mm 1/18, 20 mm 1/25, at most 1/40. Continuous, so
 * heavy rain is not drawn as drizzle (review of 2026-11-13). The power is provisional, to be checked (#132).
 */
export function rainFactor(mm: number): number {
  const r = Math.max(RAIN_MM, Number.isFinite(mm) ? mm : RAIN_MM);
  return Math.max(1 / 40, CLOUD.rain * (r / RAIN_MM) ** -0.25);
}

/** All of the sunshine an hour could have had → clear; none → average clouds (rain: rainFactor of `mm`); in between by steps (log). */
export const sunshineFactor = (share: number, rain = false, mm = RAIN_MM) => (rain ? rainFactor(mm) : CLOUD.cloudy) ** (1 - Math.min(1, Math.max(0, share)));

/**
 * How much of the clear sky's light gets through in an hour, or null when the row cannot tell.
 * In daylight from its sunshine against the sunshine it could have had (`up`: sunshineFraction, 0–1);
 * with the sun down or low (under MIN_UP of the hour above SUNSHINE_ALT) only rain tells (dark stratus).
 */
export function cloudFactor(row: WeatherRow, up = 1): number | null {
  const mm = num(row.rain) ?? 0;
  const rain = mm >= RAIN_MM;
  const sun = num(row.sun);
  if (sun != null && up >= MIN_UP) return sunshineFactor(sun / up, rain, mm);
  return rain ? rainFactor(mm) : null;
}

export interface HourLight {
  lux: number;
  index: number;
  /** The cloud factor used (CLOUD). */
  factor: number;
  /** The sun's altitude at the middle of the hour (degrees). */
  altitude: number;
}

/**
 * The light of one hourly row (JMA hour n) at a station. `factor`: the cloud factor when the caller
 * knows it better than the row alone (dayLights fills twilight hours from their neighbours).
 */
export function hourLight(row: WeatherRow, station: string | null | undefined, factor?: number): HourLight {
  const c = stationLatLon(station) ?? DEFAULT_LAT_LON;
  const altitude = solarAltitude(row.date, row.n * 60 - 30, c.lat, c.lon);
  const f = factor ?? cloudFactor(row, sunshineFraction(row.date, row.n, station ?? "")) ?? CLOUD.unknown;
  const lux = Math.max(clearSkyLux(altitude) * f, nightSkyLux(f));
  return { lux, index: brightnessIndex(lux), factor: f, altitude };
}

/** How far (hours) a twilight hour looks for a neighbour that can tell its clouds. */
const NEIGHBOUR_HOURS = 2;

/**
 * The light of a day's hourly rows, with each hour's cloud factor from the row itself or, when the
 * row cannot tell (the sun down and no weather text), from the nearest row within NEIGHBOUR_HOURS
 * that can — the last hour of daylight tells the evening twilight, the first the morning's.
 */
export function dayLights(rows: WeatherRow[], station: string | null | undefined): HourLight[] {
  const where = station ?? "";
  const own = rows.map((r) => cloudFactor(r, sunshineFraction(r.date, r.n, where)));
  return rows.map((r, i) => {
    let f = own[i];
    for (let k = 1; f == null && k <= NEIGHBOUR_HOURS; k++) {
      const near = [rows[i - k], rows[i + k]].map((x, j) => (x && Math.abs(x.n - r.n) === k && x.date === r.date ? own[i + (j ? k : -k)] : null));
      f = near.find((v) => v != null) ?? null;
    }
    return hourLight(r, station, f ?? CLOUD.unknown);
  });
}

/**
 * The day's brightness: the mean felt index over the hours with the sun up (sunrise to sunset), and
 * how many hours were 明るい or brighter (1,000 lx and up). Null without hours.
 */
export function dayBrightness(rows: WeatherRow[], station: string | null | undefined): { daytime: number | null; brightHours: number | null } {
  if (!rows.length) return { daytime: null, brightHours: null };
  const lights = dayLights(rows, station);
  const up = lights.filter((l) => l.altitude > 0);
  return {
    daytime: up.length ? Math.round((up.reduce((s, l) => s + l.index, 0) / up.length) * 100) / 100 : null,
    brightHours: lights.filter((l) => l.lux >= 1_000).length,
  };
}

// ---- adaptation: stepping out of a room ----------------------------------------------------------

/**
 * The eye is adapted to the light it has been in, and judges the outdoors against it (Naka–Rushton:
 * response = I^n / (I^n + σ^n), σ the light it is adapted to). Weather Note is looked at before going
 * out, so the felt brightness on stepping out is judged against a lit room: σ ≈ 500 lx (office and
 * living-room lighting). The eye then adapts — to brighter light within seconds to minutes, to the
 * dark in about 10 minutes (cones) to 30 (rods) — so this is the first impression, not the light
 * after a while outside (the strip's levels are the light itself).
 */
export const INDOOR_LUX = 500;

/** Naka–Rushton response (0–1) of light `lux` to an eye adapted to `adapted` (n = 0.75). */
export const adaptedResponse = (lux: number, adapted = INDOOR_LUX, n = 0.75) => lux ** n / (lux ** n + adapted ** n);

/** The first impression on stepping out of a lit room, by the ratio to the room's light (powers of ten, as the levels). */
export const STEP_OUT = [
  // Six characters at most: the readout's cells are narrow.
  { minRatio: 100, label: "まぶしい" }, // ≥ 5万lx: sunglasses help
  { minRatio: 20, label: "少しまぶしい" }, // 1万–5万lx
  { minRatio: 2, label: "明るい" }, // 1,000–1万lx
  { minRatio: 0.5, label: "室内並み" }, // 250–1,000lx
  { minRatio: 0.05, label: "薄暗い" }, // 25–250lx
  { minRatio: 0, label: "暗い" }, // < 25lx: the eye needs some minutes
] as const;

export function stepOutFeel(index: number | null | undefined): string | null {
  if (index == null) return null;
  const r = luxOf(index) / INDOOR_LUX;
  return STEP_OUT.find((s) => r >= s.minRatio)!.label;
}

// ---- adaptation over days: いつもと比べて ---------------------------------------------------------
//
// A sunny day after a dull week reads brighter than the same light in a sunny week: the eye and the
// mind take recent days as the reference, as the comfort model's 最近の基準 does for temperature.
// The day's mean daylight (sunrise to sunset, from its sunshine) against the geometric mean
// of the USUAL_DAYS before — ratios, as the eye compares them. Beside the levels, never inside them
// or in the comfort model.

const clearDayCache = new Map<string, number>();

/** The mean clear-sky light of a day, sunrise to sunset (lux), sampled every 10 minutes. */
export function clearDaylightLux(date: string, station: Where): number {
  const key = `${typeof station === "object" && station ? `${station.lat},${station.lon}` : station}/${date}`;
  const hit = clearDayCache.get(key);
  if (hit != null) return hit;
  const e = dayEdges(date, station);
  const c = typeof station === "object" && station ? station : (stationLatLon(station) ?? DEFAULT_LAT_LON);
  let sum = 0, n = 0;
  for (let m = e.rise + 5; m < e.set; m += 10) { sum += clearSkyLux(solarAltitude(date, m, c.lat, c.lon)); n++; }
  const v = n ? sum / n : 0;
  clearDayCache.set(key, v);
  return v;
}

/**
 * The mean daylight of a day (lux, sunrise to sunset) from its sunshine (日照, hours in the day): the
 * clear sky's mean, times the cloud factor of the day's share of the sunshine it could have had.
 * Sunshine, not radiation, for the same reason as the hours (records and forecasts alike).
 */
export function daylightLux(sunHours: number | null | undefined, date: string, station: Where): number | null {
  if (sunHours == null || !Number.isFinite(sunHours) || sunHours < 0) return null;
  const hours = sunshineDayHours(date, station); // the sunshine the day could have had (#132)
  return hours > 0 ? clearDaylightLux(date, station) * sunshineFactor(sunHours / hours) : null;
}

/** Days before that make "usual", and how many of them must have a value. */
export const USUAL_DAYS = 7;
export const USUAL_MIN = 4;

/** Today ÷ the geometric mean of the days before; null without today or with fewer than USUAL_MIN days. */
export function usualRatio(today: number | null, before: (number | null)[]): number | null {
  const vs = before.filter((v): v is number => v != null && v > 0);
  if (today == null || today <= 0 || vs.length < USUAL_MIN) return null;
  return Math.exp(Math.log(today) - vs.reduce((s, v) => s + Math.log(v), 0) / vs.length);
}

/** "いつも通り" (within about ±12%), "いつもの2.1倍", "いつもの0.4倍". */
export function usualText(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  if (Math.abs(Math.log10(ratio)) < 0.05) return "いつも通り";
  return `いつもの${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}倍`;
}

/** Short, for a table cell under the graph: "×2.1", "×0.4", "≈". */
export const usualShort = (ratio: number) => (Math.abs(Math.log10(ratio)) < 0.05 ? "≈" : `×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`);

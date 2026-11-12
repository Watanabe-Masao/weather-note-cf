// How bright it is outdoors (照度, lux on open level ground), and how bright that feels.
//
// The eye answers to ratios, not differences (Weber–Fechner): ten times the light reads as one
// step brighter. So the felt brightness is a scale of levels cut by powers of ten, and inside a
// level by the logarithm of the light:
//   暗い < 1 lx ≤ 薄明 < 100 ≤ 薄暗い < 1,000 ≤ 明るい < 1万 ≤ とても明るい < 5万 ≤ まぶしい
// as a continuous index 0–6 (one unit per level), which is what the graphs draw.
//
// The light of an hour:
//   - with the sun up and the hour's global radiation measured or forecast: radiation × luminous
//     efficacy (about 110 lm/W for daylight, direct and scattered together);
//   - with the sun up and no radiation: a clear-sky model from the sun's altitude (IES: direct
//     127,500·e^(−0.21/sin h)·sin h plus diffuse 800 + 15,500·√sin h), times a cloud factor;
//   - in twilight and at night: a clear-sky table by the sun's altitude (published measurements,
//     from about 700 lx at sunrise to starlight 0.001 lx at −18°), times the cloud factor.
// The cloud factor comes from the hour's sunshine (日照, 0–1 h) when there is one, else from its
// weather text (晴 1, 曇 0.35, 雨・雪 0.2), else 0.7. The moon is left out (up to 0.3 lx at full moon).
// The sun's altitude is taken at the middle of the hour (JMA hour n covers n−1 to n o'clock).

import { radiationOf } from "./feel";
import { weatherGroup } from "./similar";
import { DEFAULT_LAT_LON, solarAltitude, stationLatLon } from "./sunTimes";
import type { WeatherRow } from "./types";

export const BRIGHTNESS_LEVELS = [
  { id: "dark", label: "暗い", from: 0.001, example: "月・星明かり" },
  { id: "twilight", label: "薄明", from: 1, example: "日の出前・日没後" },
  { id: "dim", label: "薄暗い", from: 100, example: "厚い雲の夕方" },
  { id: "bright", label: "明るい", from: 1_000, example: "曇りの昼" },
  { id: "veryBright", label: "とても明るい", from: 10_000, example: "晴れの朝夕・冬の昼" },
  { id: "dazzling", label: "まぶしい", from: 50_000, example: "晴れの昼" },
] as const;
/** The top of the scale (index 6): the brightest sun on open ground. */
const TOP = 130_000;
const EDGES = [...BRIGHTNESS_LEVELS.map((l) => l.from), TOP];

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

/** "約3万lx", "約450lx", "1lx未満". */
export function luxText(lux: number): string {
  if (lux < 1) return "1lx未満";
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

/** How many times brighter a is than b (indices): "2.5倍", "0.4倍", "同じ"; "" when either is missing. */
export function brightnessRatio(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return "";
  const r = luxOf(a) / luxOf(b);
  if (Math.abs(Math.log10(r)) < 0.02) return "同じ";
  return `${r >= 10 ? Math.round(r) : r >= 1 ? r.toFixed(1) : r.toFixed(2)}倍`;
}

/** "とても明るい（約3万lx）". */
export const brightnessText = (index: number | null | undefined) => (index == null ? "—" : `${brightnessLevel(index).label}（${luxText(luxOf(index))}）`);

/** Clear sky, sun below the horizon: degrees → lux (log-interpolated). */
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

/** Clear sky, sun above the horizon (IES): degrees → lux on level ground. Joins the twilight table at 0°. */
export function clearSkyLux(deg: number): number {
  if (deg <= 0) return twilightLux(deg);
  const s = Math.sin((deg * Math.PI) / 180);
  const direct = 127_500 * Math.exp(-0.21 / Math.max(s, 0.01)) * s;
  const diffuse = 800 + 15_500 * Math.sqrt(s);
  return Math.max(twilightLux(0), direct + diffuse);
}

/** Daylight per watt of global radiation (lm/W). */
export const LUMINOUS_EFFICACY = 110;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** How much of the clear sky's light gets through, from the hour's sunshine or its weather. */
export function cloudFactor(row: WeatherRow): number {
  const sun = num(row.sun);
  if (sun != null) return 0.3 + 0.7 * Math.min(1, Math.max(0, sun));
  const g = weatherGroup(row.weather);
  return g === "sun" ? 1 : g === "cloud" ? 0.35 : g === "rain" ? 0.2 : 0.7;
}

export interface HourLight {
  lux: number;
  index: number;
  /** "radiation": from the hour's measured or forecast radiation; "sky": from the sun's altitude and the clouds. */
  from: "radiation" | "sky";
  /** The sun's altitude at the middle of the hour (degrees). */
  altitude: number;
}

/** The light of one hourly row (JMA hour n) at a station. */
export function hourLight(row: WeatherRow, station: string | null | undefined): HourLight {
  const c = stationLatLon(station) ?? DEFAULT_LAT_LON;
  const altitude = solarAltitude(row.date, row.n * 60 - 30, c.lat, c.lon);
  const radiation = radiationOf(row);
  let lux: number;
  let from: HourLight["from"];
  if (altitude > 0 && radiation != null && radiation > 0) {
    // Never darker than twilight at the horizon: an hour that straddles sunrise is mostly lit.
    lux = Math.max(radiation * LUMINOUS_EFFICACY, twilightLux(altitude) * cloudFactor(row));
    from = "radiation";
  } else {
    lux = clearSkyLux(altitude) * cloudFactor(row);
    from = "sky";
  }
  return { lux, index: brightnessIndex(lux), from, altitude };
}

/**
 * The day's brightness: the mean felt index over the hours with the sun up (sunrise to sunset), and
 * how many hours were 明るい or brighter (1,000 lx and up). Null without hours.
 */
export function dayBrightness(rows: WeatherRow[], station: string | null | undefined): { daytime: number | null; brightHours: number | null } {
  if (!rows.length) return { daytime: null, brightHours: null };
  const lights = rows.map((r) => hourLight(r, station));
  const up = lights.filter((l) => l.altitude > 0);
  return {
    daytime: up.length ? Math.round((up.reduce((s, l) => s + l.index, 0) / up.length) * 100) / 100 : null,
    brightHours: lights.filter((l) => l.lux >= 1_000).length,
  };
}

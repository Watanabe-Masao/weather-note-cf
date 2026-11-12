// The parts of a day (時間区分): 朝・日中・昼・夕方・夜, by the sun's altitude, not by the clock.
//
// The boundaries are where the sun crosses altitudes that keep their meaning through the year:
//   夜   the sun more than 6° below the horizon (after civil dusk, before civil dawn);
//   朝   from civil dawn until the sun reaches half of the day's highest altitude (dawn included);
//   日中 from there to the sun's highest point (solar noon);
//   昼   from solar noon until the sun is back down to half its highest altitude;
//   夕方 from there until civil dusk (dusk included).
// Half of the day's own highest altitude, not a fixed angle: in Kochi the sun stands 33° at noon in
// December and 80° in June, and a fixed 30° would leave winter almost without 昼. With this rule
// 日中 and 昼 last about 3.5 hours each all year; 朝 and 夕方 are short in winter and long in summer
// (Kochi, December: 6:39 / 8:49 / 12:04 / 15:20 / 17:30; June: 4:27 / 8:22 / 12:07 / 15:54 / 19:48).
// As a band of values (the 肌感 map, the trend), 夜 is the first three hours after dusk, the evening
// people are out in.
//
// Every screen and the model's time bands take the parts from here (decided 2026-11-12, #91).
// The comfort model's own night (comfort-5: no direct sun, sunset to sunrise) is a different
// question and stays as it is; twilight belongs to 朝 and 夕方 here.

import { altitudeCrossing, DEFAULT_LAT_LON, solarAltitude, solarNoon, stationLatLon } from "./sunTimes";

export const PARTS = [
  { id: "morning", label: "朝" },
  { id: "forenoon", label: "日中" },
  { id: "noon", label: "昼" },
  { id: "evening", label: "夕方" },
  { id: "night", label: "夜" },
] as const;

export type PartId = (typeof PARTS)[number]["id"];

/** 夜 as a band of values: this long after dusk (minutes). */
export const NIGHT_BAND_MIN = 180;

export interface PartWindow {
  id: PartId;
  label: string;
  /** Minutes after 0:00 JST of the date, [from, to). */
  from: number;
  to: number;
}

/** Civil twilight: the sun this far below the horizon (degrees). */
export const TWILIGHT_DEG = -6;
/** 朝/日中 and 昼/夕方 meet where the sun stands at this share of the day's highest altitude. */
export const HALF_SHARE = 0.5;

/** A station (its block number), or a place given by its coordinates (checks, other places). */
export type Where = string | null | undefined | { lat: number; lon: number };
const latLonOf = (w: Where) => (w && typeof w === "object" ? w : (stationLatLon(w) ?? DEFAULT_LAT_LON));

/** The boundaries of a day (minutes JST): dawn, sunrise, half-up, noon, half-down, sunset, dusk, and the noon altitude. */
export interface DayEdges {
  dawn: number;
  /** Sunrise and sunset (the sun's upper edge at the horizon, with refraction: −0.833°). */
  rise: number;
  set: number;
  halfUp: number;
  noon: number;
  halfDown: number;
  dusk: number;
  noonAltitude: number;
}

const cache = new Map<string, DayEdges>();

export function dayEdges(date: string, station: Where): DayEdges {
  const key = `${station && typeof station === "object" ? `${station.lat},${station.lon}` : (station ?? "")}/${date}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { lat, lon } = latLonOf(station);
  const noon = solarNoon(date, lon);
  const top = solarAltitude(date, noon, lat, lon);
  // In Japan the sun always crosses all these altitudes. Near the poles it may not (white nights,
  // polar night): a missing crossing falls back to a fixed distance from noon, and the edges are
  // kept in order, so the parts never run backwards (they mean little there).
  const at = (deg: number, rising: boolean, fallback: number) => altitudeCrossing(date, deg, rising, lat, lon) ?? fallback;
  const up = [at(TWILIGHT_DEG, true, noon - 360), at(-0.833, true, noon - 330), at(top * HALF_SHARE, true, noon - 180)];
  const down = [at(top * HALF_SHARE, false, noon + 180), at(-0.833, false, noon + 330), at(TWILIGHT_DEG, false, noon + 360)];
  up[2] = Math.min(up[2], noon);
  for (let i = up.length - 2; i >= 0; i--) up[i] = Math.min(up[i], up[i + 1]);
  down[0] = Math.max(down[0], noon);
  for (let i = 1; i < down.length; i++) down[i] = Math.max(down[i], down[i - 1]);
  const e: DayEdges = { dawn: up[0], rise: up[1], halfUp: up[2], noon, halfDown: down[0], set: down[1], dusk: down[2], noonAltitude: top };
  if (cache.size > 2000) cache.clear();
  cache.set(key, e);
  return e;
}

/** The five parts of a date at a station. */
export function dayParts(date: string, station: Where): PartWindow[] {
  const e = dayEdges(date, station);
  const edges = [e.dawn, e.halfUp, e.noon, e.halfDown, e.dusk, e.dusk + NIGHT_BAND_MIN];
  return PARTS.map((p, i) => ({ id: p.id, label: p.label, from: edges[i], to: edges[i + 1] }));
}

/** The sun's altitude (degrees) through a day at a station, every `stepMin` minutes from 0:00 (for drawing). */
export function altitudeCurve(date: string, station: Where, stepMin = 15): { min: number; deg: number }[] {
  const { lat, lon } = latLonOf(station);
  return Array.from({ length: Math.floor(1440 / stepMin) + 1 }, (_, i) => ({ min: i * stepMin, deg: solarAltitude(date, i * stepMin, lat, lon) }));
}

/** The JMA hours (n = the value at n:00, 1–24) inside a part. */
export const hoursIn = (w: PartWindow): number[] => Array.from({ length: 24 }, (_, i) => i + 1).filter((n) => n * 60 >= w.from && n * 60 < w.to);

/** "7:06" from minutes. */
export const clockOf = (min: number) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * The part a moment (ms) falls in. Any time in the dark — after dusk or before dawn — is 夜 here
 * (for telling moments apart; the band of values keeps its three hours).
 */
export function partAt(at: number, station: string | null | undefined): PartId {
  const iso = new Date(at + 9 * 3_600_000).toISOString();
  const min = +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
  const parts = dayParts(iso.slice(0, 10), station);
  return parts.find((p) => p.id !== "night" && min >= p.from && min < p.to)?.id ?? "night";
}

/** The band (with 夜 as its three hours after dusk) a moment falls in, or null outside every band. */
export function bandAt(at: number, station: string | null | undefined): PartWindow | null {
  const iso = new Date(at + 9 * 3_600_000).toISOString();
  const min = +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
  return dayParts(iso.slice(0, 10), station).find((p) => min >= p.from && min < p.to) ?? null;
}

/**
 * Notification times for the five bands: the middle of each at the equinox (the clock alarm does
 * not move with the season; what a notification is called is read from the sun on the day it rings).
 */
export const BAND_ALARMS = [
  { id: "morning", label: "朝", time: "07:00" },
  { id: "forenoon", label: "日中", time: "10:00" },
  { id: "noon", label: "昼", time: "13:00" },
  { id: "evening", label: "夕方", time: "16:00" },
  { id: "night", label: "夜", time: "19:00" },
] as const;

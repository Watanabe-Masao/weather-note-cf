// Sunrise and sunset for the day detail. They are calculated values that never change,
// so one request per station and day is kept for the whole session (the edge caches past days).

import { addDays, FIRST_DAY, FORECAST_DAYS } from "../../shared/dates";

export interface SunTimes {
  sunrise: string | null;
  sunset: string | null;
}

const known = new Map<string, SunTimes | null>();
const pending = new Map<string, Promise<SunTimes | null>>();

/** The API answers as far as the forecast reaches. */
export const sunAvailable = (date: string, today: string) => date >= FIRST_DAY && date <= addDays(today, FORECAST_DAYS);

export function cachedSun(station: string, date: string): SunTimes | null | undefined {
  return known.get(`${station}/${date}`);
}

export function loadSun(station: string, date: string): Promise<SunTimes | null> {
  const key = `${station}/${date}`;
  if (known.has(key)) return Promise.resolve(known.get(key)!);
  let p = pending.get(key);
  if (!p) {
    p = fetch(`/api/sun?station=${station}&date=${date}`, { signal: AbortSignal.timeout(30_000) })
      .then((r) => (r.ok ? (r.json() as Promise<SunTimes>) : null))
      .then((s) => (s ? { sunrise: s.sunrise ?? null, sunset: s.sunset ?? null } : null))
      .catch(() => null)
      .then((s) => {
        // A failure is not remembered, so opening the day again tries again.
        if (s) known.set(key, s);
        pending.delete(key);
        return s;
      });
    pending.set(key, p);
  }
  return p;
}

/** "2026-11-10T06:38" → 6.63 (hours since midnight), or null. */
export function hourOfDay(iso: string | null): number | null {
  const m = iso?.match(/T(\d{2}):(\d{2})/);
  return m ? +m[1] + +m[2] / 60 : null;
}

export const clock = (iso: string | null) => iso?.match(/T(\d{2}:\d{2})/)?.[1] ?? "—";

/**
 * Sunrise and sunset in hours of the day (6.52 = 6:31): the sun API's when known (the stored ones,
 * as the 時刻 table shows), else calculated (shared/dayParts). One rule for the graph, its weather
 * rows, the readout and the 太陽 sheet (#151).
 */
export function sunHours(sun: SunTimes | null | undefined, edges: { rise: number; set: number }): { rise: number; set: number } {
  return { rise: hourOfDay(sun?.sunrise ?? null) ?? edges.rise / 60, set: hourOfDay(sun?.sunset ?? null) ?? edges.set / 60 };
}

/**
 * Whether a span of the day is night for the weather pictures: its middle (hours) before sunrise
 * or after sunset. An hour's value n covers n−1 to n o'clock, so its middle is n − 0.5.
 */
export const isNightAt = (mid: number, hours: { rise: number; set: number }) => mid < hours.rise || mid > hours.set;

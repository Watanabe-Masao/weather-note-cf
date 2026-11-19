// Sunrise and sunset for the day detail. They are calculated values that never change,
// so one request per station and day is kept for the whole session (the edge caches past days).

import { addDays, FIRST_DAY, FORECAST_DAYS } from "../../shared/dates";
import { clockOf, dayEdges, type Where } from "../../shared/dayParts";
import { altitudeCrossing, DEFAULT_LAT_LON, solarAltitude, solarNoon, stationLatLon } from "../../shared/sunTimes";

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
 * Whether a span of the day is night for the weather pictures: its middle (hours) before sunrise
 * or after sunset. An hour's value n covers n−1 to n o'clock, so its middle is n − 0.5.
 */
export const isNightAt = (mid: number, hours: { rise: number; set: number }) => mid < hours.rise || mid > hours.set;

// ── 画面に出す日の出・日の入り（2026-11-19、レビュー「天文現象は天文計算から」）──────────────────────
// 画面はどこもこの計算の値だけを使う（Open-Meteo の値は β と記録のために取り続けるが、画面には出さない）。
// 定義：太陽の上端が地平線に接する時刻（大気差込みで太陽の中心が −0.833°）。国立天文台の暦と同じ定義で、
// 高知の92日で差は最大 0.61 分（research/sun/verify-results.md）。日の出入りの無い日（白夜・極夜）は null で、
// 代わりの時刻は出さない（1日の区切り shared/dayParts の代わりの値は、区切りの中だけで使う）。

export type ShownSun = {
  /** 分（日本時間の0時から）。その日に無ければ null。 */
  rise: number | null;
  set: number | null;
  /** 日の出入りの無い日：沈まない（白夜）か、昇らない（極夜）か。 */
  none: "白夜" | "極夜" | null;
};

const shownCache = new Map<string, ShownSun>();

export function shownSun(date: string, where: Where): ShownSun {
  const { lat, lon } = where && typeof where === "object" ? where : (stationLatLon(where) ?? DEFAULT_LAT_LON);
  const key = `${lat},${lon}/${date}`;
  const hit = shownCache.get(key);
  if (hit) return hit;
  const rise = altitudeCrossing(date, -0.833, true, lat, lon);
  const set = altitudeCrossing(date, -0.833, false, lat, lon);
  const none = rise == null && set == null ? (solarAltitude(date, solarNoon(date, lon), lat, lon) > -0.833 ? "白夜" : "極夜") : null;
  const s = { rise, set, none } as ShownSun;
  if (shownCache.size > 2000) shownCache.clear();
  shownCache.set(key, s);
  return s;
}

/** 絵を描くための日の出・日の入り（時、6.52 ＝ 6:31）。無い日は1日の区切りの代わりの値で描く（文字には出さない）。 */
export function shownSunHours(date: string, where: Where): { rise: number; set: number } {
  const s = shownSun(date, where);
  const e = dayEdges(date, where);
  return { rise: (s.rise ?? e.rise) / 60, set: (s.set ?? e.set) / 60 };
}

/** 文字に出す時刻（"6:31"）。無い日は「なし」。 */
export const shownClock = (min: number | null) => (min == null ? "なし" : clockOf(min));

/** 昼の長さ（分）：表に出す丸めた時刻どうしの差（6:31〜17:01 は 10時間30分、表と食い違わない）。白夜は 24時間、極夜は 0。 */
export const shownDayLength = (s: ShownSun) => (s.rise != null && s.set != null ? Math.round(s.set) - Math.round(s.rise) : s.none === "白夜" ? 1440 : 0);

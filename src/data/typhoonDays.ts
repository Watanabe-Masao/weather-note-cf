// 台風の日 in one place (#220): for any date at the station, the typhoon whose area held it — past
// days from JMA's best track (shared/typhoon.ts, 強風域・暴風域) and, after its last day, the telegrams kept
// (shared/typhoonRecent.ts), today and ahead from JMA's typhoon
// information now (shared/typhoonForecast.ts, 強風域・暴風域 now and the 暴風警戒域 ahead). The table
// marks those days with the same 台 as the calendar.

import { createContext, useContext, useMemo } from "react";
import { FIRST_DAY } from "../../shared/dates";
import { stationLatLon } from "../../shared/sunTimes";
import { typhoonDaysAt } from "../../shared/typhoon";
import { knownOn, type TyphoonRecord } from "../../shared/typhoonRecent";
import { typhoonForecastDays, type TyphoonDayMark } from "../../shared/typhoonForecast";
import { useTyphoonRecord } from "./typhoon";
import type { TyphoonInfo } from "./typhoonNow";

/**
 * What is known of a date: a typhoon's area held the station (a mark), no typhoon ("none"), or
 * "unknown" — the source for that date could not be read, is still being read, or has not reached it
 * yet (the best track after its last day; today and ahead while JMA's information is not read).
 * "unknown" is never shown as "none" (engineering-principles §2).
 */
export type TyphoonDayState = TyphoonDayMark | "none" | "unknown";
export type TyphoonOn = (date: string) => TyphoonDayState;
export const TyphoonDaysContext = createContext<TyphoonOn>(() => "unknown");
export const useTyphoonOn = () => useContext(TyphoonDaysContext);

export interface TyphoonSources {
  /**
   * Past days from the best track and, after its last day, the telegrams kept; which days they know:
   * null while reading, "none" when the best track could not be read.
   */
  past: Map<string, TyphoonDayMark>;
  pastKnown: ((d: string) => boolean) | null | "none";
  /** Days from JMA's information now, and whether it was read (ok / stale: read; loading / failed: not). */
  ahead: Map<string, TyphoonDayMark>;
  aheadState: TyphoonInfo["state"];
  today: string;
}

/** The lookup over both sources (pure, so it can be tested on its own). */
export function typhoonLookup(x: TyphoonSources): TyphoonOn {
  const aheadRead = x.aheadState === "ok" || x.aheadState === "stale";
  return (d) => {
    const a = x.ahead.get(d);
    if (a) return a;
    if (d >= x.today) return aheadRead ? "none" : "unknown";
    const p = x.past.get(d);
    if (p) return p;
    // A past day no source reaches yet: JMA's word of the day (if read) covers only today.
    if (x.pastKnown == null || x.pastKnown === "none" || !x.pastKnown(d)) return "unknown";
    return "none";
  };
}

/** The lookup for a station: the forecast's days first (they are today's word), then the best track's. */
export function useTyphoonDays(station: string, today: string, info: TyphoonInfo): TyphoonOn {
  const record = useTyphoonRecord();
  const tracks = typeof record === "object" ? record.storms : null;
  const past = useMemo(() => {
    const at = stationLatLon(station);
    if (!tracks || !at) return new Map<string, TyphoonDayMark>();
    const m = new Map<string, TyphoonDayMark>();
    for (const [d, t] of typhoonDaysAt(tracks, at.lat, at.lon, FIRST_DAY, today)) if (t.gale) m.set(d, { number: t.storm.number, area: t.violent ? "storm" : "gale" });
    return m;
  }, [tracks, station, today]);
  const pastKnown = useMemo(() => (record === "loading" ? null : record === "none" ? "none" : (d: string) => knownOn(record as TyphoonRecord, d)), [record]);
  const now = info.typhoons;
  const ahead = useMemo(() => {
    const at = stationLatLon(station);
    const m = new Map<string, TyphoonDayMark>();
    if (!at) return m;
    for (const t of now) for (const [d, x] of typhoonForecastDays(t, at.lat, at.lon)) if (!m.has(d)) m.set(d, x);
    return m;
  }, [now, station]);
  return useMemo(() => typhoonLookup({ past, pastKnown, ahead, aheadState: info.state, today }), [past, pastKnown, ahead, info.state, today]);
}

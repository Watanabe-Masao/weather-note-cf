// 台風の日 in one place (#220): for any date at the station, the typhoon whose area held it — past
// days from JMA's best track (shared/typhoon.ts, 強風域・暴風域), today and ahead from JMA's typhoon
// information now (shared/typhoonForecast.ts, 強風域・暴風域 now and the 暴風警戒域 ahead). The table
// marks those days with the same 台 as the calendar.

import { createContext, useContext, useMemo } from "react";
import { FIRST_DAY } from "../../shared/dates";
import { stationLatLon } from "../../shared/sunTimes";
import { typhoonDaysAt } from "../../shared/typhoon";
import { typhoonForecastDays, type TyphoonDayMark, type TyphoonNow } from "../../shared/typhoonForecast";
import { useTyphoonTracks } from "./typhoon";

export type TyphoonOn = (date: string) => TyphoonDayMark | null;
export const TyphoonDaysContext = createContext<TyphoonOn>(() => null);
export const useTyphoonOn = () => useContext(TyphoonDaysContext);

/** The lookup for a station: the forecast's days first (they are today's word), then the best track's. */
export function useTyphoonDays(station: string, today: string, now: TyphoonNow[]): TyphoonOn {
  const tracks = useTyphoonTracks();
  const past = useMemo(() => {
    const at = stationLatLon(station);
    if (!Array.isArray(tracks) || !at) return new Map<string, TyphoonDayMark>();
    const m = new Map<string, TyphoonDayMark>();
    for (const [d, t] of typhoonDaysAt(tracks, at.lat, at.lon, FIRST_DAY, today)) if (t.gale) m.set(d, { number: t.storm.number, area: t.violent ? "storm" : "gale" });
    return m;
  }, [tracks, station, today]);
  const ahead = useMemo(() => {
    const at = stationLatLon(station);
    const m = new Map<string, TyphoonDayMark>();
    if (!at) return m;
    for (const t of now) for (const [d, x] of typhoonForecastDays(t, at.lat, at.lon)) if (!m.has(d)) m.set(d, x);
    return m;
  }, [now, station]);
  return useMemo(() => (d: string) => ahead.get(d) ?? past.get(d) ?? null, [ahead, past]);
}

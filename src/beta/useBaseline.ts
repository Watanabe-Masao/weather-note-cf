// The baseline for a day, read from the store, and the request for the past days it needs.

import { useEffect, useMemo } from "react";
import type { WeatherStore } from "../data/store";
import { type Baseline, type BaselineState, baselineState, historyDays, pastDay } from "./adaptation";

export function baselineOf(store: WeatherStore | null, station: string, date: string | null, alpha: number): Baseline | null {
  const s = baselineStateOf(store, station, date, alpha);
  return s.state === "ready" ? s.baseline : null;
}

export function baselineStateOf(store: WeatherStore | null, station: string, date: string | null, alpha: number): BaselineState {
  if (!store || !date) return { state: "short" };
  return baselineState(historyOf(store, station, date), alpha);
}

/** The past days behind a day's baseline, newest first; a day not fetched yet is marked loading. */
export function historyOf(store: WeatherStore, station: string, date: string) {
  return historyDays(date).map((d) => {
    const day = store.getDay(station, d);
    return pastDay(day.row, day.state === "empty");
  });
}

/** Ask the store, quietly, for the past days behind the baselines of `dates`. */
export function useBaselineHistory(store: WeatherStore | null, station: string, dates: (string | null)[], owner: string): void {
  const key = dates.join(",");
  const days = useMemo(() => [...new Set(dates.flatMap((d) => (d ? historyDays(d) : [])))], [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    store?.prefetch(station, days, owner);
    return () => store?.prefetch(station, [], owner);
  }, [store, station, days, owner]);
}

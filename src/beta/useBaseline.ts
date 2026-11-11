// The baseline for a day, read from the store, and the request for the past days it needs.

import { useEffect, useMemo } from "react";
import type { WeatherStore } from "../data/store";
import { type Baseline, historyDays, pastDay, runningMean } from "./adaptation";

export function baselineOf(store: WeatherStore | null, station: string, date: string | null, alpha: number): Baseline | null {
  if (!store || !date) return null;
  return runningMean(historyOf(store, station, date).map((p) => p), alpha);
}

/** The past days behind a day's baseline, newest first. */
export function historyOf(store: WeatherStore, station: string, date: string) {
  return historyDays(date).map((d) => pastDay(store.getDay(station, d).row));
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

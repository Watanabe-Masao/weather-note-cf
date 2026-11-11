// The baseline for a day, read from the store, and the request for the past days it needs.

import { useEffect, useMemo } from "react";
import type { WeatherStore } from "../data/store";
import { type AdaptSpeed, alphaOf, type Baseline, historyDays, pastDay, runningMean } from "./adaptation";

export function baselineOf(store: WeatherStore | null, station: string, date: string | null, speed: AdaptSpeed): Baseline | null {
  if (!store || !date) return null;
  return runningMean(
    historyDays(date).map((d) => pastDay(store.getDay(station, d).row)),
    alphaOf(speed),
  );
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

// The baseline for a day, read from the store, and the request for the past days it needs.

import { useEffect, useMemo } from "react";
import type { WeatherStore } from "../data/store";
import { type Baseline, type BaselineState, baselineState, historyDays, pastDay } from "./adaptation";
import { type Drivers, driversFrom } from "./comfort";

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

/**
 * The comfort model's drivers for a day and a place temperature `e`, read from the store:
 * 最近の基準, the 7 days' humidity and spread, and the humidity of the moment (`hNow`).
 */
export function driversOfDay(store: WeatherStore | null, station: string, date: string | null, alpha: number, e: number | null, hNow: number | null): Drivers | null {
  if (!store || !date || e == null) return null;
  const past = historyOf(store, station, date);
  const recent = historyDays(date)
    .slice(0, 7)
    .map((d) => {
      const row = store.getDay(station, d).row;
      return { mean: typeof row?.temp === "number" ? row.temp : null, humidity: typeof row?.humidity === "number" ? row.humidity : null };
    });
  return driversFrom(
    e,
    past.map((p) => p.mean),
    recent,
    hNow,
    alpha,
  );
}

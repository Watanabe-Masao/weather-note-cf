// The 従来版 boundaries of a day (#111): the settings' boundaries moved by the season (shared/season.ts),
// from the 30 days before the day in the store. Days not in yet: no shift is guessed (null), and the
// settings' boundaries are used as they are.

import { useEffect, useMemo } from "react";
import { addDays } from "../shared/dates";
import type { FeelSettings } from "../shared/feel";
import { mean30, SEASON, seasonShift, shifted } from "../shared/season";
import type { WeatherStore } from "./data/store";

const daysBefore = (date: string) => Array.from({ length: SEASON.days }, (_, i) => addDays(date, -(i + 1)));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The season's shift for a date (null while the 30 days are not in). */
export function seasonShiftOf(store: WeatherStore | null, station: string, date: string | null): number | null {
  if (!store || !date) return null;
  const m = mean30(daysBefore(date).map((d) => num(store.getDay(station, d).row?.temp)));
  return m == null ? null : seasonShift(m);
}

/** The feel settings of a date: its boundaries moved by the season. */
export function feelOn(store: WeatherStore | null, station: string, date: string | null, s: FeelSettings): FeelSettings {
  const shift = seasonShiftOf(store, station, date);
  return shift == null ? s : { ...s, thresholds: shifted(s.thresholds, shift) };
}

/** Ask the store, quietly, for the 30 days before each date. */
export function useSeasonDays(store: WeatherStore | null, station: string, dates: (string | null)[], owner: string): void {
  const key = dates.join(",");
  const days = useMemo(() => [...new Set(dates.flatMap((d) => (d ? daysBefore(d) : [])))], [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    store?.prefetch(station, days, owner);
    return () => store?.prefetch(station, [], owner);
  }, [store, station, days, owner]);
}

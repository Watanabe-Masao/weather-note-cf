// A day's daylight against the days before it (順応 over days, shared/brightness.ts), from the
// store's daily rows — the same rows the 最近の基準 reads; days not loaded give no value.

import { addDays } from "../shared/dates";
import { daylightLux, USUAL_DAYS, usualRatio } from "../shared/brightness";
import type { WeatherStore } from "./data/store";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function usualLightOf(store: WeatherStore | null, station: string, date: string | null): number | null {
  if (!store || !date) return null;
  const lux = (d: string) => daylightLux(num(store.getDay(station, d).row?.sun), d, station);
  return usualRatio(lux(date), Array.from({ length: USUAL_DAYS }, (_, i) => lux(addDays(date, -(i + 1)))));
}

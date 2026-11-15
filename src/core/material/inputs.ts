// 材料を推測値の入力に (principles 2): every material as a Value — a number, or why there is none.
// The wind's height is a fact of the source: 10 m for the forecast, the station's anemometer for the
// record. The record's is not in the data, so it comes with the site, and is absent when unknown.

import type { Series, Value } from "../estimate/engine";
import { FORECAST_WIND_HEIGHT } from "./constants";
import type { HourField } from "./fields";
import type { MaterialDay, MaterialHour } from "./material";

/** Facts of the place that the rows do not carry. */
export interface Site {
  /** Height of the station's anemometer (m); null when not known. */
  anemometerHeight: number | null;
}

export type HourInput = HourField | "windHeight";

export function hourInputs(m: MaterialHour, site: Site): Record<HourInput, Value> {
  const out = {} as Record<HourInput, Value>;
  for (const [f, v] of Object.entries(m.values) as [HourField, number | null][]) out[f] = v != null ? { value: v } : { absent: m.absent[f] ?? "notObserved" };
  const height = m.kind === "forecast" ? FORECAST_WIND_HEIGHT : site.anemometerHeight;
  out.windHeight = height != null ? { value: height } : { absent: "notProvided" };
  return out;
}

/**
 * The days' mean temperatures before a day, newest first (index 0 = the day before). A day with no
 * row at all is `noRow` (the fetch failed or it is not loaded: principles 2), never skipped, so the
 * position still says which day it is.
 */
export function dayMeanSeries(days: readonly (MaterialDay | null)[]): Series {
  return {
    series: days.map((d) => (d == null ? { absent: "noRow" } : d.values.temp != null ? { value: d.values.temp } : { absent: d.absent.temp ?? "notObserved" })),
  };
}

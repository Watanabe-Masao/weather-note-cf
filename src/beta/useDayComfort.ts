// β's comfort state for one day (#118): the person's centre, range and outer step for that day, the
// same as the comparison card's (CompareSummary): the day's drivers at noon, the ensemble mixed.
// Today's stays hidden until the day's first report (useCentreVisible), as everywhere else.

import { useContext } from "react";
import { daytimeFeel } from "../../shared/feel";
import type { Thresholds } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { FeelContext } from "../ui/FeelBar";
import { centreUnknown, type Drivers, type Ensemble, ensembleState, type State } from "./comfort";
import { BetaContext } from "./settings";
import { baselineStateOf, driversOfDay, useBaselineHistory } from "./useBaseline";
import { useCentreVisible } from "./useReports";

export interface DayComfortState {
  /** The day's state, or null while it cannot be had (β off, history loading or too short). */
  st: State | null;
  /** Today's, before the day's first report: kept back (the centre is shown after answering). */
  hidden: boolean;
  /** The day's drivers and the ensemble, for なぜ (engine/why.ts). */
  x?: Drivers;
  ens?: Ensemble;
}

/** The seven-level boundaries of a β state, on the 肌感 scale (ascending). */
export const personalThresholds = (st: State): Thresholds => [
  st.mu - st.h - 2 * st.g,
  st.mu - st.h - st.g,
  st.mu - st.h,
  st.mu + st.h,
  st.mu + st.h + st.g,
  st.mu + st.h + 2 * st.g,
];

export function useDayComfortState(store: WeatherStore | null, station: string, date: string | null, rows: WeatherRow[] | undefined, key: string): DayComfortState {
  const beta = useContext(BetaContext);
  const feel = useContext(FeelContext);
  const centreVisible = useCentreVisible();
  useBaselineHistory(store, station, beta.enabled && date ? [date] : [], key);
  // Not learned enough to say where the centre is: nothing of the person's to show (as the comparison card).
  if (!beta.enabled || !date || centreUnknown(beta.learning.state)) return { st: null, hidden: false };
  const base = baselineStateOf(store, station, date, beta.alpha);
  if (base.state !== "ready") return { st: null, hidden: false };
  const list = rows ?? [];
  const sun = daytimeFeel(list, { ...feel, sun: true }, station);
  const shade = daytimeFeel(list, { ...feel, sun: false }, station);
  const day = store?.getDay(station, date).row;
  const hum = typeof day?.humidity === "number" ? day.humidity : null;
  const x = driversOfDay(store, station, date, beta.alpha, sun ?? shade ?? 0, hum, { at: Date.parse(`${date}T12:00:00+09:00`) });
  if (!x) return { st: null, hidden: false };
  return { st: ensembleState(beta.ens, x), hidden: !centreVisible(date), x, ens: beta.ens };
}

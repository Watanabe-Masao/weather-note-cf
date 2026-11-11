// The comparison the screen shows: target day, comparison day, and how they move together.
//
// Linked: the comparison day follows the target day by the chosen rule (or a fixed custom offset).
// Independent: each side moves on its own. Switching back to linked keeps the current pair by
// turning the gap into a custom offset (spec decision).

import { useCallback, useEffect, useState } from "react";
import { addDays, FIRST_DAY, jstToday } from "../shared/dates";
import { clampDay, type CompareMode, matchDate, offsetOf, targetBounds } from "./compare";
import { lastDay } from "./data/plan";
import { knownMetric, type MetricId } from "./metrics";

export interface ViewState {
  station: string;
  target: string;
  /** Only used when not linked. */
  compare: string;
  linked: boolean;
  mode: CompareMode;
  offset: number;
  metric: MetricId;
  /** Feel in the sun (radiation counted) or in the shade. */
  sun: boolean;
}

const SAVED = "weather-note:view";
const DEFAULTS: Omit<ViewState, "target" | "compare"> = {
  station: "47893",
  linked: true,
  mode: "sameDate",
  offset: -364,
  metric: "temp",
  sun: true,
};

function load(today: string): ViewState {
  let saved: Partial<ViewState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(SAVED) ?? "{}");
  } catch {
    // Storage blocked or corrupt: start from defaults.
  }
  const base = { ...DEFAULTS, ...saved };
  base.metric = knownMetric(base.metric);
  return { ...base, target: today, compare: matchDate(today, base.mode, base.offset) ?? addDays(today, -364) };
}

export function useViewState() {
  const [today] = useState(jstToday);
  const [view, setView] = useState<ViewState>(() => load(today));
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);

  useEffect(() => {
    const { station, linked, mode, offset, metric, sun } = view;
    try {
      localStorage.setItem(SAVED, JSON.stringify({ station, linked, mode, offset, metric, sun }));
    } catch {
      // Not saving preferences is harmless.
    }
  }, [view]);

  const last = lastDay(jstToday());
  const bounds = view.linked ? targetBounds(view.mode, view.offset, last) : { min: FIRST_DAY, max: last };
  const compareDate = view.linked ? matchDate(view.target, view.mode, view.offset) : view.compare;

  const moveTarget = useCallback(
    (next: string) => {
      setView((v) => {
        const b = v.linked ? targetBounds(v.mode, v.offset, lastDay(jstToday())) : { min: FIRST_DAY, max: lastDay(jstToday()) };
        const t = clampDay(next, b.min, b.max);
        if (t !== v.target) setDirection(t < v.target ? -1 : 1);
        return { ...v, target: t };
      });
    },
    [],
  );

  /** Moving the comparison day: linked moves both by the same number of days. */
  const moveCompare = useCallback((next: string) => {
    setView((v) => {
      if (v.linked) {
        const current = matchDate(v.target, v.mode, v.offset) ?? v.target;
        const delta = offsetOf(current, next);
        const b = targetBounds(v.mode, v.offset, lastDay(jstToday()));
        const t = clampDay(addDays(v.target, delta), b.min, b.max);
        if (t !== v.target) setDirection(t < v.target ? -1 : 1);
        return { ...v, target: t };
      }
      const c = clampDay(next, FIRST_DAY, lastDay(jstToday()));
      if (c !== v.compare) setDirection(c < v.compare ? -1 : 1);
      return { ...v, compare: c };
    });
  }, []);

  const setLinked = useCallback((linked: boolean) => {
    setView((v) => {
      if (linked === v.linked) return v;
      if (linked) return { ...v, linked, mode: "custom", offset: offsetOf(v.target, v.compare) };
      return { ...v, linked, compare: matchDate(v.target, v.mode, v.offset) ?? addDays(v.target, -364) };
    });
  }, []);

  /** Make `date` the comparison day (from the similar-day list). Linked: a custom offset keeps the pair. */
  const pickCompare = useCallback((date: string) => {
    setView((v) => (v.linked ? { ...v, mode: "custom", offset: offsetOf(v.target, date) } : { ...v, compare: date }));
  }, []);

  const setMode = useCallback((mode: CompareMode) => {
    setView((v) => {
      // Switching to カスタム keeps the pair on screen: the interval is taken from the comparison day
      // shown now (前日 → −1 day, 前年同曜日 → −364 …), never from an older custom setting.
      const shown = v.linked ? (matchDate(v.target, v.mode, v.offset) ?? v.compare) : v.compare;
      const offset = mode === "custom" ? offsetOf(v.target, shown) : v.offset;
      const compare = matchDate(v.target, mode, offset) ?? v.compare;
      return { ...v, mode, offset, compare };
    });
  }, []);

  const set = useCallback(<K extends keyof ViewState>(key: K, value: ViewState[K]) => {
    setView((v) => ({ ...v, [key]: value }));
  }, []);

  return { view, today, last, bounds, compareDate, direction, moveTarget, moveCompare, setLinked, setMode, pickCompare, set };
}

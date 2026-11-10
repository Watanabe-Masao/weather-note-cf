// The table's small feel bar: five segments from hourly data, or a three-segment estimate
// (dashed outline) from the daily row until hourly data arrives.

import { type Band, DEFAULT_FEEL, describe, estimatedBands, type FeelSettings, hourlyBands, LEVELS } from "../../shared/feel";
import type { WeatherStore } from "../data/store";

export const LEVEL_COLORS = ["#5b8fd6", "#a9cdf2", "#a8d08d", "#f2c46d", "#ef8a6f"] as const;

/** Exact bands when hourly data covers the day, otherwise the estimate, otherwise null. */
export function bandsFor(
  store: WeatherStore | null,
  station: string,
  date: string,
  s: FeelSettings = DEFAULT_FEEL,
): { bands: Band[]; exact: boolean } | null {
  const hours = store?.getHours(station, date);
  if (hours?.state === "ready" && hours.rows.length) {
    const bands = hourlyBands(hours.rows, s);
    if (bands.every((b) => b.level != null)) return { bands, exact: true };
  }
  const day = store?.getDay(station, date);
  const estimate = day?.state === "ready" ? estimatedBands(day.row, s) : null;
  return estimate ? { bands: estimate, exact: false } : null;
}

export function FeelBar({ store, station, date }: { store: WeatherStore | null; station: string; date: string }) {
  const found = bandsFor(store, station, date);
  if (!found) {
    const state = store?.getDay(station, date).state;
    return state === "empty" ? <span className="skeleton" /> : <span className="feel-none">—</span>;
  }
  const { bands, exact } = found;
  const title = [
    describe(bands) ?? "",
    ...bands.map((b) => `${b.label} ${b.level == null ? "—" : LEVELS[b.level]}${b.feel == null ? "" : ` ${b.feel.toFixed(0)}℃`}`),
    exact ? "" : "（日別の値からの目安）",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={exact ? "feel-bar" : "feel-bar estimate"}
      style={{ gridTemplateColumns: exact ? "repeat(5, 1fr)" : "1fr 1.4fr 1fr" }}
      title={title}
      role="img"
      aria-label={title}
    >
      {bands.map((b, i) => (
        <i
          key={i}
          className={b.source === "actual" ? undefined : "forecast"}
          style={{ background: b.level == null ? "var(--line)" : LEVEL_COLORS[b.level] }}
        />
      ))}
    </span>
  );
}

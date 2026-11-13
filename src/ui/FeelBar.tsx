// The table's small feel bar: five time bands (each coloured by its step on the chosen scale) from hourly data, or a three-segment estimate
// (dashed outline) from the daily row until hourly data arrives.

import { createContext, useContext } from "react";
import {
  type Band,
  DEFAULT_FEEL,
  describe,
  estimatedBands,
  type FeelSettings,
  hourlyBands,
  type Level,
  SCALE_STEPS,
  type Scale,
  scaleThresholds,
  stepOf,
  type Thresholds,
} from "../../shared/feel";
import type { WeatherStore } from "../data/store";
import { feelOn } from "../feelSeason";
import { FEEL_LEVELS, FEEL_SCALE_COLORS } from "../design/tokens";

/** Feel settings for everything below (sun or shade, thresholds, wind). */
export const FeelContext = createContext<FeelSettings>(DEFAULT_FEEL);

/** The seven 肌感 level colours (design tokens). */
export const LEVEL_COLORS = FEEL_LEVELS;

/** A seven-step level shown on the chosen scale: its colour and its name. */
export const levelColor = (level: Level, scale: Scale = 7) => FEEL_SCALE_COLORS[scale][stepOf(level, scale)];
export const levelName = (level: Level, scale: Scale = 7) => SCALE_STEPS[scale][stepOf(level, scale)].label;
/** The legend of a scale: each step's name and colour. */
export const legendOf = (scale: Scale = 7) => SCALE_STEPS[scale].map((st, i) => ({ label: st.label, color: FEEL_SCALE_COLORS[scale][i] }));
/** Coloured ranges behind a graph for a scale: [from, to) per step, ℃. */
export function levelRanges(t: Thresholds, scale: Scale = 7): { from: number; to: number; color: string }[] {
  const edges = [-Infinity, ...scaleThresholds(t, scale), Infinity];
  return edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1], color: FEEL_SCALE_COLORS[scale][i] }));
}

/** Exact bands when hourly data covers the day, otherwise the estimate, otherwise null. */
export function bandsFor(
  store: WeatherStore | null,
  station: string,
  date: string,
  s: FeelSettings = DEFAULT_FEEL,
): { bands: Band[]; exact: boolean } | null {
  const hours = store?.getHours(station, date);
  if (hours?.state === "ready" && hours.rows.length) {
    const bands = hourlyBands(hours.rows, s, station);
    if (bands.every((b) => b.level != null)) return { bands, exact: true };
  }
  const day = store?.getDay(station, date);
  const estimate = day?.state === "ready" ? estimatedBands(day.row, s) : null;
  return estimate ? { bands: estimate, exact: false } : null;
}

export function FeelBar({ store, station, date }: { store: WeatherStore | null; station: string; date: string }) {
  // The day's boundaries move with the season (#111).
  const settings = feelOn(store, station, date, useContext(FeelContext));
  const found = bandsFor(store, station, date, settings);
  if (!found) {
    const state = store?.getDay(station, date).state;
    return state === "empty" ? <span className="skeleton" /> : <span className="feel-none">—</span>;
  }
  const { bands, exact } = found;
  // The number is called 肌感（日なた） (sunshine counted) or 肌感（日かげ） (none), to keep it apart from
  // the general term 体感温度: it is this app's own combination of formulas.
  const name = exact && settings.sun && bands.some((b) => b.sunCounted) ? "肌感（日なた）" : "肌感（日かげ）";
  const title = [
    describe(bands) ?? "",
    `${name}${exact ? "" : "（日別の値からの目安）"}`,
    ...bands.map((b) => `${b.label} ${b.level == null ? "—" : levelName(b.level, settings.scale)}${b.feel == null ? "" : ` ${b.feel.toFixed(0)}`}`),
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
          style={{ background: b.level == null ? "var(--line-strong)" : levelColor(b.level, settings.scale) }}
        />
      ))}
    </span>
  );
}

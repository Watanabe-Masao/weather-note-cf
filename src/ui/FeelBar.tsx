// The table's small feel bar: five time bands (each coloured by its step on the chosen scale) from hourly data, or a three-segment estimate
// (dashed outline) from the daily row until hourly data arrives. One soft strip: the colours blend at
// the borders under a thin divider; forecast bands hatched; today's band now ringed (FEEL_BAND).

import { createContext, useContext, useEffect, useState } from "react";
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
import { FEEL_BAND, FEEL_LEVELS, FEEL_SCALE_COLORS } from "../design/tokens";

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

/** Minutes after 0:00 JST now, kept fresh each minute while `on` (today's band ring moves with it). */
function useNowMinute(on: boolean): number {
  const read = () => {
    const d = new Date(Date.now() + JST_OFFSET_MS);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    if (!on) return;
    setNow(read());
    const id = window.setInterval(() => setNow(read()), 60_000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}
const JST_OFFSET_MS = 9 * 3_600_000;

/**
 * The bands as one strip (design-system.md 2, tokens.ts FEEL_BAND): each band's colour holds over its
 * middle and blends into the next over `blur` of a band's width at the border, under a thin divider.
 */
function bandGradient(colors: string[], widths: number[]): string {
  const total = widths.reduce((a, b) => a + b, 0);
  const edges = widths.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + (w / total) * 100], [0]);
  const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
  const stops = colors.flatMap((c, i) => {
    const soft = ((edges[i + 1] - edges[i]) * FEEL_BAND.blur) / 2;
    return [`${c} ${pct(i === 0 ? 0 : edges[i] + soft)}`, `${c} ${pct(i === colors.length - 1 ? 100 : edges[i + 1] - soft)}`];
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function FeelBar({ store, station, date, today }: { store: WeatherStore | null; station: string; date: string; today?: string }) {
  // The day's boundaries move with the season (#111).
  const settings = feelOn(store, station, date, useContext(FeelContext));
  const found = bandsFor(store, station, date, settings);
  const isToday = date === today;
  const nowMin = useNowMinute(isToday && !!found?.exact);
  if (!found) {
    const state = store?.getDay(station, date).state;
    return state === "empty" ? <span className="skeleton" /> : <span className="feel-none">—</span>;
  }
  const { bands, exact } = found;
  // The number is called 肌感（日なた） (sunshine counted) or 肌感（日かげ） (none), to keep it apart from
  // the general term 体感温度: it is this app's own combination of formulas.
  const name = exact && settings.sun && bands.some((b) => b.sunCounted) ? "肌感（日なた）" : "肌感（日かげ）";
  // Today, the band the time is in now is ringed (only with the hourly bands: an estimate has no times).
  const now = isToday && exact ? bands.findIndex((b) => b.window && nowMin >= b.window.from && nowMin < b.window.to) : -1;
  const title = [
    describe(bands) ?? "",
    `${name}${exact ? "" : "（日別の値からの目安）"}`,
    ...bands.map((b, i) => `${b.label} ${b.level == null ? "—" : levelName(b.level, settings.scale)}${b.feel == null ? "" : ` ${b.feel.toFixed(0)}`}${i === now ? "（今）" : ""}`),
  ]
    .filter(Boolean)
    .join("\n");
  const widths = exact ? bands.map(() => 1) : ESTIMATE_WIDTHS;
  return (
    <span
      className={exact ? "feel-bar" : "feel-bar estimate"}
      style={{
        gridTemplateColumns: widths.map((w) => `${w}fr`).join(" "),
        backgroundImage: bandGradient(
          bands.map((b) => (b.level == null ? "var(--line-strong)" : levelColor(b.level, settings.scale))),
          widths,
        ),
      }}
      title={title}
      role="img"
      aria-label={title}
    >
      {bands.map((b, i) => (
        <i key={i} className={[b.source === "actual" ? "" : "forecast", i === now ? "now" : ""].filter(Boolean).join(" ") || undefined} />
      ))}
    </span>
  );
}

/** The estimate's three bands (朝・日中・夜 from the daily row): the day's middle a little wider. */
const ESTIMATE_WIDTHS = [1, 1.4, 1];

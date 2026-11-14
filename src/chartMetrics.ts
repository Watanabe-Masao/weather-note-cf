// What the table and the comparison graph can show: one value (or two) per day, for the
// target days and their partner days. One chip row chooses it for both.

import { daytimeFeel, type FeelSettings, MJ_PER_HOUR_TO_W, radiationOf } from "../shared/feel";
import type { WeatherRow } from "../shared/types";
import type { DataColor } from "./design/tokens";
import { dayBrightness, usualShort } from "../shared/brightness";

export type ChartMetricId =
  | "temp"
  | "rain"
  | "radiation"
  | "light"
  | "humidity"
  | "wind"
  | "pressure";

export interface ChartSeries {
  key: string;
  label: string;
  /** Data colour (design tokens): one colour, one meaning, everywhere. */
  tone: DataColor;
  /** The day's value; `hours` is that day's hourly rows (empty until loaded). */
  /** `station`: whose sun divides the day (the 肌感 bands, shared/dayParts.ts). */
  value: (row: WeatherRow | null | undefined, hours: WeatherRow[] | null, feel: FeelSettings, station: string | null) => number | null;
  /** β: the value needs the days before (the 最近の基準); the chart reads it through the store. */
  history?: "baseline" | "usualLight";
  /** Only a row of numbers under the graph (neither a line nor a table row). */
  underOnly?: boolean;
  /** Shorter name for the narrow table label column. */
  tableLabel?: string;
  /** Drawn in the graph only, not given a row in the table. */
  graphOnly?: boolean;
  /** A thin line without dots (a reference, such as the mean). */
  thin?: boolean;
  /** A table row only (the graph shows it another way, such as the spread band). */
  tableOnly?: boolean;
  /** A secondary table row, set smaller. */
  minor?: boolean;
  /** Unit when it differs from the item's (snow in cm under rain in mm). */
  unit?: string;
  /** Only forecasts have it: past days leave the cell empty instead of "—". */
  forecastOnly?: boolean;
}

export interface ChartMetric {
  id: ChartMetricId;
  /** The chip's name (about three characters: seven chips share the row). */
  label: string;
  /** The full name for headings when the chip's is short (日照 → 日照時間と明るさ). */
  title?: string;
  unit: string;
  chart: "line" | "bar";
  /** The axis starts at zero. */
  zero: boolean;
  /** Fixed top of the axis (percentages of a chance go to 100). */
  max?: number;
  series: ChartSeries[];
  /** Daily values come from the hourly rows (JMA's daily table has no such column). */
  needsHours?: boolean;
  /** Only forecasts have it: the comparison days (past) never do. */
  forecastOnly?: boolean;
  /** Shown when nothing in the seven days has a value above zero. */
  emptyNote?: string;
  /** Shade between the first two series and print their difference under each day (寒暖差). */
  spread?: string;
  /** Series (and the spread, key "spread") hidden until turned on in the legend. */
  hiddenByDefault?: string[];
  /** Small rows of numbers under the graph, from table-only series (rain chance, snowfall). */
  under?: UnderRow[];
}

export interface UnderRow {
  key: string;
  label: string;
  format: (v: number) => string;
  /** Also a muted row for the comparison days. */
  compare?: boolean;
  /** Left out entirely unless one of the days has a value above zero. */
  onlyWhenAny?: boolean;
}

/** Rows the table shows for an item. `past`: the comparison side, whose days have no forecast-only values. */
export const tableSeries = (m: ChartMetric, past = false) => m.series.filter((s) => !s.graphOnly && !s.underOnly && !(past && s.forecastOnly));

/** Lines the graph draws for an item. */
export const graphSeries = (m: ChartMetric) => m.series.filter((s) => !s.tableOnly && !s.underOnly);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const field =
  (key: string) =>
  (row: WeatherRow | null | undefined): number | null =>
    num(row?.[key]);

/** Hours a day needs before its highest/lowest hourly value is shown (a partial day would mislead). */
export const EXTREME_MIN_HOURS = 20;

/**
 * The day's highest or lowest hourly value of `key` (JMA publishes only the mean sea-level pressure
 * per day, so its extremes come from the hours). Null until enough hours exist.
 */
export function hourlyExtreme(hours: WeatherRow[] | null, key: string, pick: "max" | "min"): number | null {
  const values = (hours ?? []).map((h) => num(h[key])).filter((v): v is number => v != null);
  if (values.length < EXTREME_MIN_HOURS) return null;
  return Math.round((pick === "max" ? Math.max(...values) : Math.min(...values)) * 10) / 10;
}

/** Daily 全天日射量 (MJ/㎡): the forecast row has it; for observations, the 24 hours added up. */
export function dailyRadiation(row: WeatherRow | null | undefined, hours: WeatherRow[] | null): number | null {
  const own = num(row?.radiation);
  if (own != null) return own;
  if (!hours || hours.length < 24) return null;
  // Night hours are blank (no sunshine), so a missing hour counts as zero once the day is complete.
  const total = hours.reduce((sum, h) => sum + (radiationOf(h) ?? 0) / MJ_PER_HOUR_TO_W, 0);
  return hours.some((h) => radiationOf(h) != null) ? Math.round(total * 100) / 100 : null;
}

export const CHART_METRICS: ChartMetric[] = [
  {
    id: "temp",
    label: "気温",
    unit: "℃",
    chart: "line",
    zero: false,
    series: [
      { key: "max", label: "最高", tone: "hot", value: field("max") },
      { key: "min", label: "最低", tone: "cold", value: field("min") },
      { key: "temp", label: "平均", tone: "mean", value: field("temp"), thin: true, minor: true },
      {
        key: "range",
        label: "寒暖差",
        tone: "mean",
        value: (r) => {
          const max = num(r?.max);
          const min = num(r?.min);
          return max == null || min == null ? null : Math.round((max - min) * 10) / 10;
        },
        tableOnly: true,
        minor: true,
      },
      // 肌感 for the day: mean of the 日中・昼・夕方 band values (肌感（日なた） or 肌感（日かげ）).
      { key: "feel", label: "肌感", tone: "feel", value: (_r, hours, feel, station) => daytimeFeel(hours ?? [], feel, station), graphOnly: true },
      // β: the running mean of past daily means (src/beta/adaptation.ts), a thin reference line.
      { key: "baseline", label: "最近の基準β", tone: "mean", value: () => null, history: "baseline", graphOnly: true, thin: true },
    ],
    spread: "寒暖差",
    hiddenByDefault: ["temp"],
  },
  {
    id: "rain",
    label: "降水",
    unit: "mm",
    chart: "bar",
    zero: true,
    series: [
      { key: "rain", label: "降水量", tone: "rain", value: field("rain") },
      // Snow is in cm and rain chance in %: table rows and marks under the graph, never stacked on the bars.
      { key: "snow", label: "降雪", tone: "snow", value: field("snow"), tableOnly: true, minor: true, unit: "cm" },
      {
        key: "probability",
        label: "確率",
        tone: "rain",
        value: (r) => (r?.type === "forecast" ? num(r.probability) : null),
        tableOnly: true,
        minor: true,
        unit: "%",
        forecastOnly: true,
      },
    ],
    under: [
      { key: "probability", label: "確率", format: (v) => `${Math.round(v)}%` },
      { key: "snow", label: "雪", format: (v) => (v > 0 ? `❄${v}` : ""), compare: true, onlyWhenAny: true },
    ],
  },
  {
    // 日差し: 全天日射量, the sun's warming power (what 肌感（日なた） uses). 日照 and 明るさ are their own item.
    id: "radiation",
    label: "日差し",
    unit: "MJ/㎡",
    chart: "bar",
    zero: true,
    needsHours: true,
    series: [
      { key: "radiation", label: "日射量", tone: "radiation", value: dailyRadiation },
    ],
  },
  {
    // 日照時間と明るさ: what the eye gets. 日照 (how long the sun shone) as the bars — the light is
    // computed from it (shared/brightness.ts: the same inputs for records and forecasts) — with
    // 明るさ under them: the hours that were 明るい or brighter (1,000 lx and up), and the day's
    // daylight against the 7 days before (順応 over days; the chart reads it through the store).
    id: "light",
    label: "日照",
    title: "日照と明るさ",
    unit: "h",
    chart: "bar",
    zero: true,
    needsHours: true,
    series: [
      { key: "sun", label: "日照", tone: "sun", value: field("sun") },
      { key: "usualLight", label: "いつも比", tone: "sun", value: () => null, history: "usualLight", underOnly: true },
      { key: "brightHours", label: "明るい時間", tableLabel: "明るい", tone: "sun", value: (_r, h, _f, station) => (h?.length ? dayBrightness(h, station).brightHours : null), tableOnly: true, minor: true, unit: "時間" },
    ],
    under: [
      { key: "brightHours", label: "明るい", format: (v) => `${v}h`, compare: true },
      { key: "usualLight", label: "いつも比", format: usualShort, compare: true },
    ],
  },
  {
    id: "humidity",
    label: "湿度",
    unit: "%",
    chart: "line",
    zero: false,
    series: [
      { key: "humidity", label: "平均", tone: "humidity", value: field("humidity") },
      { key: "humidityMin", label: "最小", tone: "humidityLow", value: field("humidityMin") },
    ],
  },
  {
    // The mean wind is what you feel through the day, so it gets the axis; the strongest gust
    // (several times larger) would flatten it, so it is a row of numbers under the graph instead.
    id: "wind",
    label: "風速",
    unit: "m/s",
    chart: "line",
    zero: true,
    series: [
      { key: "wind", label: "平均", tone: "wind", value: field("wind") },
      { key: "gust", label: "最大瞬間", tableLabel: "瞬間", tone: "gust", value: field("gust"), tableOnly: true, minor: true },
    ],
    under: [{ key: "gust", label: "瞬間", format: (v) => v.toFixed(1), compare: true }],
  },
  {
    // Like temperature: the day's highest and lowest (from the hours) with the mean as a thin line.
    id: "pressure",
    label: "気圧",
    unit: "hPa",
    chart: "line",
    zero: false,
    needsHours: true,
    series: [
      { key: "pressureMax", label: "最高", tone: "pressureHigh", value: (_r, h) => hourlyExtreme(h, "pressure", "max") },
      { key: "pressureMin", label: "最低", tone: "pressureLow", value: (_r, h) => hourlyExtreme(h, "pressure", "min") },
      { key: "pressure", label: "平均", tone: "mean", value: field("pressure"), thin: true, minor: true },
    ],
  },
];

export const chartMetricById = (id: ChartMetricId) => CHART_METRICS.find((m) => m.id === id)!;

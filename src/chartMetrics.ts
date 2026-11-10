// What the table and the comparison graph can show: one value (or two) per day, for the
// target days and their partner days. One chip row chooses it for both.

import { daytimeFeel, type FeelSettings, MJ_PER_HOUR_TO_W, radiationOf } from "../shared/feel";
import type { WeatherRow } from "../shared/types";

export type ChartMetricId =
  | "temp"
  | "rain"
  | "radiation"
  | "humidity"
  | "wind"
  | "pressure";

export interface ChartSeries {
  key: string;
  label: string;
  tone: "hot" | "cold" | "rain" | "plain" | "feel";
  /** The day's value; `hours` is that day's hourly rows (empty until loaded). */
  value: (row: WeatherRow | null | undefined, hours: WeatherRow[] | null, feel: FeelSettings) => number | null;
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
  label: string;
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
export const tableSeries = (m: ChartMetric, past = false) => m.series.filter((s) => !s.graphOnly && !(past && s.forecastOnly));

/** Lines the graph draws for an item. */
export const graphSeries = (m: ChartMetric) => m.series.filter((s) => !s.tableOnly);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const field =
  (key: string) =>
  (row: WeatherRow | null | undefined): number | null =>
    num(row?.[key]);

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
      { key: "temp", label: "平均", tone: "plain", value: field("temp"), thin: true, minor: true },
      {
        key: "range",
        label: "寒暖差",
        tone: "plain",
        value: (r) => {
          const max = num(r?.max);
          const min = num(r?.min);
          return max == null || min == null ? null : Math.round((max - min) * 10) / 10;
        },
        tableOnly: true,
        minor: true,
      },
      // 肌感 for the day: mean of the 日中・昼・夕方 band values (日なた温度 or 日かげ温度).
      { key: "feel", label: "肌感", tone: "feel", value: (_r, hours, feel) => daytimeFeel(hours ?? [], feel), graphOnly: true },
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
      { key: "snow", label: "降雪cm", tone: "cold", value: field("snow"), tableOnly: true, minor: true, unit: "cm" },
      {
        key: "probability",
        label: "確率%",
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
    // 日差し: 全天日射量 (the sun's warming power, used by 日なた温度) as the bars,
    // 日照時間 (how long it was sunny) as numbers under them. Two scales never share one axis.
    id: "radiation",
    label: "日差し",
    unit: "MJ/㎡",
    chart: "bar",
    zero: true,
    needsHours: true,
    series: [
      { key: "radiation", label: "日射量", tone: "hot", value: dailyRadiation },
      { key: "sun", label: "日照h", tone: "hot", value: field("sun"), tableOnly: true, minor: true, unit: "h" },
    ],
    under: [{ key: "sun", label: "日照", format: (v) => `${v.toFixed(1)}h`, compare: true }],
  },
  {
    id: "humidity",
    label: "湿度",
    unit: "%",
    chart: "line",
    zero: false,
    series: [
      { key: "humidity", label: "平均", tone: "plain", value: field("humidity") },
      { key: "humidityMin", label: "最小", tone: "cold", value: field("humidityMin") },
    ],
  },
  {
    // Same unit, so one axis: the day's mean wind and its strongest gust as two lines.
    id: "wind",
    label: "風速",
    unit: "m/s",
    chart: "line",
    zero: true,
    series: [
      { key: "gust", label: "最大瞬間", tableLabel: "瞬間", tone: "hot", value: field("gust") },
      { key: "wind", label: "平均", tone: "plain", value: field("wind") },
    ],
  },
  { id: "pressure", label: "気圧", unit: "hPa", chart: "line", zero: false, series: [{ key: "pressure", label: "気圧", tone: "plain", value: field("pressure") }] },
];

export const chartMetricById = (id: ChartMetricId) => CHART_METRICS.find((m) => m.id === id)!;

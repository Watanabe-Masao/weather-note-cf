// What each metric chip shows in the table and the graph.

export type MetricId = "temp" | "rain" | "humidity" | "wind";

export interface Series {
  key: string;
  label: string;
  tone: "hot" | "cold" | "rain" | "plain";
}

export interface Metric {
  id: MetricId;
  label: string;
  unit: string;
  series: Series[];
  /** Bars start at zero; lines fit the data. */
  chart: "line" | "bar";
}

export const METRICS: Metric[] = [
  {
    id: "temp",
    label: "気温",
    unit: "℃",
    chart: "line",
    series: [
      { key: "max", label: "最高", tone: "hot" },
      { key: "min", label: "最低", tone: "cold" },
    ],
  },
  { id: "rain", label: "降水量", unit: "mm", chart: "bar", series: [{ key: "rain", label: "降水量", tone: "rain" }] },
  { id: "humidity", label: "湿度", unit: "%", chart: "line", series: [{ key: "humidity", label: "湿度", tone: "plain" }] },
  { id: "wind", label: "風速", unit: "m/s", chart: "line", series: [{ key: "wind", label: "風速", tone: "plain" }] },
];

export const metricById = (id: MetricId) => METRICS.find((m) => m.id === id)!;

export const formatValue = (v: unknown, unit: string) =>
  typeof v === "number" && Number.isFinite(v) ? (unit === "%" ? Math.round(v).toString() : v.toFixed(1)) : "—";

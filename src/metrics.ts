// The items one chip row chooses for both the table and the comparison graph.

import { CHART_METRICS, type ChartMetric, type ChartMetricId, chartMetricById } from "./chartMetrics";

export type MetricId = ChartMetricId;
export type Metric = ChartMetric;
export const METRICS = CHART_METRICS;
export const metricById = chartMetricById;

/** A saved item that no longer exists falls back to temperature. */
export const knownMetric = (id: unknown): MetricId =>
  METRICS.some((m) => m.id === id) ? (id as MetricId) : id === "snow" || id === "probability" ? "rain" : id === "sun" ? "radiation" : id === "gust" ? "wind" : "temp";

/** Table and axis values: the design rule for digits per unit. */
export { formatValue } from "./design/format";

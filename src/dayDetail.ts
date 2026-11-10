// Day detail: the 24 hourly values of one day next to its partner day.
//
// Two views: 実測 (the published values: temperature, rain, humidity, wind, sunshine) and
// 肌感 (this app's 日なた温度 / 日かげ温度, with the five feel levels behind it).

import { type FeelSettings, feelOf, MJ_PER_HOUR_TO_W, radiationOf } from "../shared/feel";
import type { WeatherRow } from "../shared/types";
import type { MetricId } from "./metrics";

export type DetailView = "measured" | "feel";
export type DetailMetricId = "temp" | "rain" | "snow" | "probability" | "humidity" | "wind" | "radiation" | "sun" | "feel";

export interface DetailMetric {
  id: DetailMetricId;
  label: string;
  unit: string;
  chart: "line" | "bar";
  /** Lowest value the axis must include (bars and amounts start at zero). */
  floor?: number;
  /** Fixed top of the axis, when the value has one (sunshine is at most one hour). */
  ceiling?: number;
  /** Offered only when one of the two days has a value above zero (snow, forecast probability). */
  onlyWhenPresent?: boolean;
}

export const MEASURED: DetailMetric[] = [
  { id: "temp", label: "気温", unit: "℃", chart: "line" },
  { id: "rain", label: "降水量", unit: "mm", chart: "bar", floor: 0 },
  { id: "snow", label: "降雪", unit: "cm", chart: "bar", floor: 0, onlyWhenPresent: true },
  { id: "probability", label: "降水確率", unit: "%", chart: "bar", floor: 0, ceiling: 100, onlyWhenPresent: true },
  { id: "humidity", label: "湿度", unit: "%", chart: "line" },
  { id: "wind", label: "風速", unit: "m/s", chart: "line", floor: 0 },
  // 全天日射量: the sun's warming power (direct plus scattered light); what 日なた温度 uses.
  { id: "radiation", label: "日射量", unit: "MJ/㎡", chart: "bar", floor: 0 },
  // 日照時間: minutes of direct sunshine in the hour — a record of "was it sunny".
  { id: "sun", label: "日照", unit: "h", chart: "bar", floor: 0, ceiling: 1 },
];

export const FEEL_METRIC: DetailMetric = { id: "feel", label: "肌感", unit: "℃", chart: "line" };

export const detailMetric = (id: DetailMetricId) => (id === "feel" ? FEEL_METRIC : MEASURED.find((m) => m.id === id)!);

/** The detail opens on what the table was showing. */
export const initialDetailMetric = (metric: MetricId): DetailMetricId => metric;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface HourPoint {
  /** Hour 1–24 (JMA style: the value at the end of the hour). */
  hour: number;
  v: number | null;
  forecast: boolean;
}

/** Twenty-four points for one day; missing hours are null (the line breaks, never interpolated). */
export function hourSeries(rows: WeatherRow[], id: DetailMetricId, s: FeelSettings): HourPoint[] {
  const byHour = new Map(rows.map((r) => [r.n, r]));
  return Array.from({ length: 24 }, (_, i) => {
    const hour = i + 1;
    const r = byHour.get(hour);
    if (!r) return { hour, v: null, forecast: false };
    const forecast = r.type === "forecast";
    const radiation = radiationOf(r);
    const v =
      id === "feel"
        ? feelOf(r.temp, r.humidity, r.wind, forecast, s, radiation)
        : id === "radiation"
          ? // JMA gives MJ/㎡ per hour, the forecast W/㎡: shown in JMA's unit.
            radiation == null
            ? null
            : +(radiation / MJ_PER_HOUR_TO_W).toFixed(2)
          : num((r as Record<string, unknown>)[id]);
    return { hour, v, forecast };
  });
}

/** The measured items worth offering for these two days. */
export function offeredMetrics(main: WeatherRow[], other: WeatherRow[], s: FeelSettings): DetailMetric[] {
  return MEASURED.filter(
    (m) => !m.onlyWhenPresent || [main, other].some((rows) => hourSeries(rows, m.id, s).some((p) => p.v != null && p.v > 0)),
  );
}

/** The hour to point at first: the latest observed hour today, otherwise the warmest hour. */
export function initialHour(points: HourPoint[], isToday: boolean, nowHour: number): number {
  if (isToday) return Math.min(24, Math.max(1, nowHour));
  let best: HourPoint | null = null;
  for (const p of points) if (p.v != null && (best == null || p.v > best.v!)) best = p;
  return best?.hour ?? 14;
}

/** Value range for the axis, padded so lines never touch the edges. */
export function axisRange(values: number[], m: DetailMetric): { lo: number; hi: number } {
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (m.floor != null) lo = Math.min(lo, m.floor);
  if (m.ceiling != null) hi = Math.max(hi, m.ceiling);
  const pad = Math.max((hi - lo) * 0.12, m.unit === "℃" ? 1 : m.unit === "h" ? 0 : m.unit === "MJ/㎡" ? 0.1 : 0.5);
  if (m.floor == null || lo < m.floor) lo -= pad;
  if (m.ceiling == null) hi += pad;
  if (hi <= lo) hi = lo + 1;
  return { lo, hi };
}

export function formatDetail(v: number | null, m: DetailMetric): string {
  if (v == null) return "—";
  if (m.unit === "%") return Math.round(v).toString();
  if (m.unit === "h") return `${Math.round(v * 60)}分`;
  if (m.unit === "MJ/㎡") return v.toFixed(2);
  return v.toFixed(1);
}

/** Signed difference "+1.2" / "−0.4" / "±0", or "" when either side is missing. */
export function signedDiff(a: unknown, b: unknown, digits = 1): string {
  const x = num(a);
  const y = num(b);
  if (x == null || y == null) return "";
  const d = +(x - y).toFixed(digits);
  return d === 0 ? "±0" : d > 0 ? `+${d.toFixed(digits)}` : `−${Math.abs(d).toFixed(digits)}`;
}

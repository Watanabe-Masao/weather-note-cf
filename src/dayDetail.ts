// Day detail: the 24 hourly values of one day next to its partner day.
//
// Two views: 実測 (the published values: temperature, rain, humidity, wind, sunshine) and
// 肌感 (this app's 日なた温度 / 日かげ温度, with the five feel levels behind it).

import { type FeelSettings, feelOf, MJ_PER_HOUR_TO_W, radiationOf } from "../shared/feel";
import type { WeatherRow } from "../shared/types";
import type { MetricId } from "./metrics";
import { BRIGHTNESS_UNIT, formatValue, sunshineMinutes } from "./design/format";
import { brightnessLevel, hourLight } from "../shared/brightness";

export type DetailView = "measured" | "feel";
export type DetailMetricId = "temp" | "rain" | "snow" | "probability" | "humidity" | "wind" | "radiation" | "sun" | "brightness" | "pressure" | "feel";

export interface DetailMetric {
  id: DetailMetricId;
  label: string;
  unit: string;
  chart: "line" | "bar";
  /** Lowest value the axis must include (bars and amounts start at zero). */
  floor?: number;
  /** Fixed top of the axis, when the value has one (sunshine is at most one hour). */
  ceiling?: number;
}

export const MEASURED: DetailMetric[] = [
  { id: "temp", label: "気温", unit: "℃", chart: "line" },
  { id: "rain", label: "降水量", unit: "mm", chart: "bar", floor: 0 },
  { id: "snow", label: "降雪", unit: "cm", chart: "bar", floor: 0 },
  { id: "probability", label: "降水確率", unit: "%", chart: "bar", floor: 0, ceiling: 100 },
  { id: "humidity", label: "湿度", unit: "%", chart: "line" },
  { id: "wind", label: "風速", unit: "m/s", chart: "line", floor: 0 },
  // 全天日射量: the sun's warming power (direct plus scattered light); what 日なた温度 uses.
  { id: "radiation", label: "日差し", unit: "MJ/㎡", chart: "bar", floor: 0 },
  // 日照時間: minutes of direct sunshine in the hour — a record of "was it sunny".
  // 日照 is read out next to 日射量 under 日差し (no shared axis).
  { id: "sun", label: "日照", unit: "h", chart: "bar", floor: 0, ceiling: 1 },
  // 明るさ: the felt brightness (shared/brightness.ts), an index of six levels drawn as bands.
  { id: "brightness", label: "明るさ", unit: BRIGHTNESS_UNIT, chart: "line", floor: 0, ceiling: 6 },
  { id: "pressure", label: "気圧", unit: "hPa", chart: "line" },
];

export const FEEL_METRIC: DetailMetric = { id: "feel", label: "肌感", unit: "℃", chart: "line" };

export const detailMetric = (id: DetailMetricId) => (id === "feel" ? FEEL_METRIC : MEASURED.find((m) => m.id === id)!);

/** The detail opens on what the table was showing (its nearest hourly item). */
export function initialDetailMetric(metric: MetricId): DetailMetricId {
  switch (metric) {
    case "rain":
    case "radiation":
    case "humidity":
    case "wind":
    case "pressure":
    case "brightness":
      return metric;
    default:
      return "temp";
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface HourPoint {
  /** Hour 1–24 (JMA style: the value at the end of the hour). */
  hour: number;
  v: number | null;
  forecast: boolean;
}

/** Twenty-four points for one day; missing hours are null (the line breaks, never interpolated). */
export function hourSeries(rows: WeatherRow[], id: DetailMetricId, s: FeelSettings, station: string | null = null): HourPoint[] {
  const byHour = new Map(rows.map((r) => [r.n, r]));
  return Array.from({ length: 24 }, (_, i) => {
    const hour = i + 1;
    const r = byHour.get(hour);
    if (!r) return { hour, v: null, forecast: false };
    const forecast = r.type === "forecast";
    const radiation = radiationOf(r);
    const v =
      id === "brightness"
        ? +hourLight(r, station).index.toFixed(2)
        : id === "feel"
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


/** The hour to point at first: the latest observed hour today, otherwise the warmest hour. */
export function initialHour(points: HourPoint[], isToday: boolean, nowHour: number): number {
  if (isToday) return Math.min(24, Math.max(1, nowHour));
  let best: HourPoint | null = null;
  for (const p of points) if (p.v != null && (best == null || p.v > best.v!)) best = p;
  return best?.hour ?? 14;
}

/** Value range for the axis, padded so lines never touch the edges. */
export function axisRange(values: number[], m: DetailMetric): { lo: number; hi: number } {
  // The brightness levels are the axis: always all six.
  if (m.unit === BRIGHTNESS_UNIT) return { lo: 0, hi: 6 };
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

/** Hourly values: sunshine in minutes, radiation with two decimals, the rest by the unit's rule. */
export function formatDetail(v: number | null, m: DetailMetric): string {
  if (m.unit === "h") return sunshineMinutes(v);
  if (m.unit === BRIGHTNESS_UNIT) return v == null ? "—" : brightnessLevel(v).label;
  return formatValue(v, m.unit, true);
}


export { signedDiff } from "./design/format";

// Day detail: the 24 hourly values of one day next to its partner day.
//
// Two views: 実測 (the published values: temperature, rain, humidity, wind, sunshine) and
// 肌感 (this app's 肌感（日なた） / 肌感（日かげ）, with the five feel levels behind it).

import { type FeelSettings, feelOf, MJ_PER_HOUR_TO_W, radiationOf } from "../shared/feel";
import { sunshineRadiation } from "../shared/mrt";
import type { WeatherRow } from "../shared/types";
import type { MetricId } from "./metrics";
import { formatValue, signedDiff, sunshineMinutes } from "./design/format";

export type DetailView = "measured" | "feel";
export type DetailMetricId = "temp" | "rain" | "snow" | "probability" | "humidity" | "visibility" | "wind" | "radiation" | "sun" | "pressure" | "feel";

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
  // 視程（見通しの距離）：気象台の視程計（高知など）と予報（モデル）。どちらも 20 km で止まる（それより遠くは 20）。
  { id: "visibility", label: "視程", unit: "km", chart: "line", floor: 0, ceiling: 20 },
  { id: "wind", label: "風速", unit: "m/s", chart: "line", floor: 0 },
  // 全天日射量: the sun's warming power (direct plus scattered light); what 肌感（日なた） uses.
  { id: "radiation", label: "日差し", unit: "MJ/㎡", chart: "bar", floor: 0 },
  // 日照時間: minutes of direct sunshine in the hour — a record of "was it sunny". The item 日照
  // (日照時間と明るさ) shows it with the hour's 明るさ, which is computed from it.
  { id: "sun", label: "日照", unit: "h", chart: "bar", floor: 0, ceiling: 1 },
  { id: "pressure", label: "気圧", unit: "hPa", chart: "line" },
];

// 肌感 is an index on a ℃-wide scale, not a temperature (D18): its axis says 肌感, its values have no ℃.
export const FEEL_METRIC: DetailMetric = { id: "feel", label: "肌感", unit: "肌感", chart: "line" };

/** 視程の上限（km）：観測（視程計）も予報（画面）もここで止まる。 */
export const VISIBILITY_TOP = 20;

/**
 * a − b for 視程, when a value may be the cap (20 = "20 km or more"): both at the cap → unknown (""),
 * b at the cap → a − b is at most a − 20 ("…以下"), a at the cap → at least 20 − b ("…以上").
 */
export function visibilityDiff(a: number | null, b: number | null): string {
  if (a == null || b == null) return "";
  const capA = a >= VISIBILITY_TOP;
  const capB = b >= VISIBILITY_TOP;
  if (capA && capB) return "";
  const d = signedDiff(Math.min(a, VISIBILITY_TOP), Math.min(b, VISIBILITY_TOP), "km");
  return capB ? `${d}以下` : capA ? `${d}以上` : d;
}

export const detailMetric = (id: DetailMetricId) => (id === "feel" ? FEEL_METRIC : MEASURED.find((m) => m.id === id)!);

/** The detail opens on what the table was showing (its nearest hourly item). */
export function initialDetailMetric(metric: MetricId): DetailMetricId {
  switch (metric) {
    case "rain":
    case "radiation":
    case "humidity":
    case "visibility":
    case "wind":
    case "pressure":
      return metric;
    case "light":
      return "sun";
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
  /** For a value made from several days (手前の平均・中央値): how many days had a value at this hour. */
  n?: number;
}

/** Twenty-four points for one day; missing hours are null (the line breaks, never interpolated). */
/** `station`: where the sun is, for 日なた's radiation from sunshine (#103). */
export function hourSeries(rows: WeatherRow[], id: DetailMetricId, s: FeelSettings, station: string | null = null): HourPoint[] {
  const byHour = new Map(rows.map((r) => [r.n, r]));
  return Array.from({ length: 24 }, (_, i) => {
    const hour = i + 1;
    const r = byHour.get(hour);
    if (!r) return { hour, v: null, forecast: false };
    const forecast = r.type === "forecast";
    const radiation = radiationOf(r);
    const v =
      id === "feel"
        ? feelOf(r.temp, r.humidity, r.wind, forecast, s, sunshineRadiation(r, station))
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
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (m.floor != null) lo = Math.min(lo, m.floor);
  if (m.ceiling != null) hi = Math.max(hi, m.ceiling);
  const pad = Math.max((hi - lo) * 0.12, m.unit === "℃" || m.unit === "肌感" ? 1 : m.unit === "h" ? 0 : m.unit === "MJ/㎡" ? 0.1 : 0.5);
  if (m.floor == null || lo < m.floor) lo -= pad;
  if (m.ceiling == null) hi += pad;
  if (hi <= lo) hi = lo + 1;
  return { lo, hi };
}

/** Hourly values: sunshine in minutes, radiation with two decimals, the rest by the unit's rule. */
export function formatDetail(v: number | null, m: DetailMetric): string {
  if (m.unit === "h") return sunshineMinutes(v);
  // 視程の 20 は「20 km 以上」（視程計の上限で止まった値）：実際の 20 と区別して「20.0+」。
  if (m.id === "visibility" && v != null && v >= VISIBILITY_TOP) return `${VISIBILITY_TOP.toFixed(1)}+`;
  return formatValue(v, m.unit, true);
}


export { signedDiff } from "./design/format";

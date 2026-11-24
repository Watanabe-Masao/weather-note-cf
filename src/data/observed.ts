// 今日の最高・最低は観測を優先する（2026-11-24 渡辺さん「観測を優先します」）。
//
// 今日の行は予報（気象庁の値が重なった行、src/data/official.ts）。でも、ここまでの観測（アメダス）が
// 予報の最高より高く（最低より低く）なったら、それはもう起きた事実：日の最高（最低）はその観測の値にする。
// 予報の値を足したり平均したりはしない（混ぜない）：どちらか一方をそのまま使い、使った方を出どころに残す。
//   - observed：観測に替えた項目と、その時刻（ⓘ の出典と札に使う、src/sourceTag.ts）
//   - jmaSources：替えた項目は気象庁の出どころから外す（気象庁の値ではなくなったので）
// 日の記録には保存しない（getDay が今日に重ねるだけ）。過ぎた日は観測の行そのものなので要らない。
import type { WeatherRow } from "../../shared/types";
import type { JmaSources } from "./official";

/** 観測に替えた項目：値とその時刻（1〜24）。 */
export type Observed = Partial<Record<"max" | "min", { v: number; n: number }>>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ここまでの観測の最高・最低（時間の行のうち予報でないもの）。 */
export function observedExtremes(hours: WeatherRow[]): Observed {
  const out: Observed = {};
  for (const r of hours) {
    if (r.type === "forecast") continue;
    const t = num(r.temp);
    if (t == null) continue;
    if (!out.max || t > out.max.v) out.max = { v: t, n: r.n };
    if (!out.min || t < out.min.v) out.min = { v: t, n: r.n };
  }
  return out;
}

/** 今日の予報の行に、予報を超えた観測を重ねる。替えるものが無ければ同じ行。 */
export function overlayObserved(row: WeatherRow | null, hours: WeatherRow[]): WeatherRow | null {
  if (!row || row.type !== "forecast" || !hours.length) return row;
  const seen = observedExtremes(hours);
  const max = num(row.max);
  const min = num(row.min);
  const take: Observed = {};
  if (seen.max && (max == null || seen.max.v > max)) take.max = seen.max;
  if (seen.min && (min == null || seen.min.v < min)) take.min = seen.min;
  if (!take.max && !take.min) return row;
  const out: WeatherRow = { ...row, raw: { ...row.raw }, quality: { ...row.quality }, origin: { ...((row.origin as object) ?? {}) } };
  const origin = out.origin as Record<string, string>;
  const sources = row.jmaSources && typeof row.jmaSources === "object" ? { ...(row.jmaSources as JmaSources) } : null;
  for (const field of ["max", "min"] as const) {
    const o = take[field];
    if (!o) continue;
    out[field] = o.v;
    out.raw[field] = String(o.v);
    out.quality[field] = "normal";
    origin[field] = "observed";
    if (sources) delete sources[field];
  }
  if (sources) out.jmaSources = sources;
  out.observed = take;
  return out;
}

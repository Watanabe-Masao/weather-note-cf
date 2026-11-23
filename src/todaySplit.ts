// 今日の「ここまで（観測）／このあと（予報）」の値の分け方（画面は src/ui/TodaySplit.tsx）。
// 値は日の値にそろえる（withDay、2026-11-24 渡辺さん「揃えてください」）。テストから読めるように .ts に分けた。
import type { WeatherRow } from "../shared/types";

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface Part {
  from: number;
  to: number;
  hours: number[];
  max: { v: number; n: number } | null;
  min: { v: number; n: number } | null;
  rain: number | null;
  wind: { v: number; n: number } | null;
}

function part(rows: WeatherRow[]): Part | null {
  if (!rows.length) return null;
  let max: Part["max"] = null;
  let min: Part["min"] = null;
  let rain: number | null = null;
  let wind: Part["wind"] = null;
  for (const r of rows) {
    const t = num(r.temp);
    if (t != null && (!max || t > max.v)) max = { v: t, n: r.n };
    if (t != null && (!min || t < min.v)) min = { v: t, n: r.n };
    const p = num(r.rain);
    if (p != null) rain = (rain ?? 0) + p;
    const w = num(r.wind);
    if (w != null && (!wind || w > wind.v)) wind = { v: w, n: r.n };
  }
  return { from: rows[0].n - 1, to: rows[rows.length - 1].n, hours: rows.map((r) => r.n), max, min, rain, wind };
}

/** The day split at the last observed hour. Null unless the day has both observed and forecast hours. */
export function splitToday(rows: WeatherRow[] | null) {
  if (!rows?.length) return null;
  const sorted = [...rows].sort((a, b) => a.n - b.n);
  const obs = part(sorted.filter((r) => r.type !== "forecast"));
  const fc = part(sorted.filter((r) => r.type === "forecast"));
  if (!obs || !fc) return null;
  const pick = (a: Part["max"], b: Part["max"], hi: boolean) => (!a ? b : !b ? a : (hi ? a.v >= b.v : a.v <= b.v) ? a : b);
  return { rows: sorted, obs, fc, max: pick(obs.max, fc.max, true), min: pick(obs.min, fc.min, false) };
}

/** 出す値：n はその時刻（日の行の値に置きかえたときは null：気象庁の日の値には時刻が無い）。 */
export type Fig = { v: number; n: number | null };
/** 出す区切り：最高・最低は Fig。 */
export type Shown = Omit<Part, "max" | "min"> & { max: Fig | null; min: Fig | null };
export type Split = NonNullable<ReturnType<typeof splitToday>>;

export const t1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
/** 時間の値は小数1桁、日の行の値（時刻なし＝気象庁の日の値など）は表と同じ書き方（整数のまま）。 */
export const fig = (m: { v: number; n: number | null }) => (m.n == null && Number.isInteger(m.v) ? String(m.v) : m.v.toFixed(1));

/**
 * 「このあと」の最高・最低を、その日の値（表と同じ日の行、2026-11-24 渡辺さん「揃えてください」）にそろえる：
 * その日の最高がまだ来ていない（ここまでの観測より高い）なら、このあとの最高は日の最高。最低も同じ。
 * もう過ぎていれば時間の値のまま（観測は事実）。時間ごとの線（Curve）は時間の値のまま。
 */
export function withDay(s: Split, day: { max: number | null; min: number | null }): Omit<Split, "fc"> & { fc: Shown } {
  const max: Fig | null = day.max != null && (!s.obs.max || day.max > s.obs.max.v) ? { v: day.max, n: null } : s.fc.max;
  const min: Fig | null = day.min != null && (!s.obs.min || day.min < s.obs.min.v) ? { v: day.min, n: null } : s.fc.min;
  return { ...s, fc: { ...s.fc, max, min } };
}

/** One line about the rest of the day: has the high already been, will it get colder or wetter. */
export function restWord(s: { obs: Part; fc: Shown }): string {
  const out: string[] = [];
  if (s.obs.max && s.fc.max) {
    if (s.obs.max.v >= s.fc.max.v) out.push(`今日の最高は${s.obs.max.n}時の ${s.obs.max.v.toFixed(1)}℃ で、もう過ぎました`);
    else out.push(`最高はこのあと${s.fc.max.n != null ? ` ${s.fc.max.n}時ごろ` : ""} ${fig(s.fc.max)}℃ の見込み`);
  }
  if (s.fc.min && s.obs.min && s.fc.min.v < s.obs.min.v) out.push(s.fc.min.n != null ? `夜は ${fig(s.fc.min)}℃ まで下がりそう` : `このあと ${fig(s.fc.min)}℃ まで下がりそう`);
  if ((s.fc.rain ?? 0) >= 0.5) out.push(`このあと雨 ${(s.fc.rain ?? 0).toFixed(1)}mm の予報`);
  else if ((s.obs.rain ?? 0) >= 0.5) out.push("このあと雨の予報はありません");
  return out.join("。") + (out.length ? "。" : "");
}


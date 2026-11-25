// 空気の質の「ふだん」（2026-11-25 渡辺さん：内訳はヒートマップ、色はふだんと比べた多さ）。Weather Note の集計。
//
// ふだん＝その地点・その項目の、見る日の手前30日（今日と先の日は昨日までの30日）の1時間値。分位で5段に分ける：
//   少ない（10% 未満）／ふだん（75% 以下）／やや多い（90% 以下）／多い（98% 以下）／とても多い（それより上）。
// 同じ値が並ぶ項目（SO2 のように 0.001 が続く）でも、同じ値は「ふだん」になるよう境目は「以下」で比べる。
// 手前の時間が 7日分（168時間）に届かない項目は比べない（null）。

export const USUAL_DAYS = 30;
export const USUAL_MIN_HOURS = 7 * 24;
/** 段の境目の分位（10%・75%・90%・98%）。 */
export const USUAL_PCT = [0.1, 0.75, 0.9, 0.98] as const;
export const USUAL_WORDS = ["少ない", "ふだん", "やや多い", "多い", "とても多い"] as const;

export interface UsualItem {
  /** 比べた時間の数。 */
  n: number;
  /** 10%・75%・90%・98% の値。 */
  q: [number, number, number, number];
}

export interface Usual {
  /** 比べた期間（日本時間の日付、両端を含む）。 */
  from: string;
  to: string;
  items: Record<string, UsualItem | null>;
  /**
   * 1日の値のふだん（2026-11-25 渡辺さん OK、research/air-usual の結果）：同じ30日の、1日の値（PM2.5 は日平均、黄砂は日最大）の
   * 90% の値。ひとことの「ふだんより多い日」はこれと比べる（1時間でも超えたら、だと2日に1日ほど出ていた）。前の答えには無い。
   */
  days?: Record<string, DayUsual | null>;
}

export interface DayUsual {
  /** 比べた日の数。 */
  n: number;
  /** 1日の値の 90% の値。 */
  p90: number;
}

/** 1日の値を出すのに要る時間の数（1日の値は、20時間以上ある日だけ）。 */
export const DAY_MIN_HOURS = 20;
/** 1日の値のふだんを出すのに要る日の数。 */
export const DAY_USUAL_MIN = 7;

/** 1日の値：PM2.5 は平均、黄砂は最大。時間が足りなければ null。 */
export function dayValue(values: (number | null | undefined)[], how: "mean" | "max"): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < DAY_MIN_HOURS) return null;
  return how === "mean" ? v.reduce((a, b) => a + b, 0) / v.length : Math.max(...v);
}

/** 日ごとの1時間値（日 → 値）から、1日の値のふだん。日が足りなければ null。 */
export function dayUsual(byDay: Map<string, (number | null)[]>, how: "mean" | "max"): DayUsual | null {
  const days = [...byDay.values()].map((v) => dayValue(v, how)).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (days.length < DAY_USUAL_MIN) return null;
  return { n: days.length, p90: quantile(days, 0.9) };
}

/** 行（日と値）を日ごとにまとめる。 */
export function groupByDay<T>(rows: T[], day: (r: T) => string, value: (r: T) => number | null): Map<string, (number | null)[]> {
  const m = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const d = day(r);
    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(value(r));
  }
  return m;
}

/** 分位（並べた値の線形補間）。 */
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function usualItem(values: number[]): UsualItem | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < USUAL_MIN_HOURS) return null;
  const q = USUAL_PCT.map((p) => quantile(v, p)) as UsualItem["q"];
  return { n: v.length, q };
}

/** 段（0 少ない 〜 4 とても多い）。値が無ければ -1、ふだんが無ければ null。 */
export function usualLevel(v: number | null | undefined, u: UsualItem | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return -1;
  if (!u) return null;
  const [p10, p75, p90, p98] = u.q;
  if (v < p10) return 0;
  if (v <= p75) return 1;
  if (v <= p90) return 2;
  if (v <= p98) return 3;
  return 4;
}

// 風向のまとめ（2026-11-22 渡辺さん承認の設計）：向きは平均できない（350° と 10° の算術平均は 180° になる）。
// 主な表示は16方位の最頻値、補助に円周平均（ベクトルで足した向き）と平均合成ベクトル長 R（0〜1、向きの
// まとまり。北風と南風が同じだけ吹くと 0 に近く、円周平均は当てにならない）。静穏は向きに数えず別に数える。
//
// 出どころ：過去の気象データの表は「北北西」「静穏」などの文字、アメダスは角度と静穏の印（calm）、予報は角度。

import type { WeatherRow } from "./types";

export const SECTORS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"] as const;

/** 行の風向：角度（北 0°、時計回り）、静穏、または分からない（null）。 */
export function windOf(r: WeatherRow): number | "calm" | null {
  if (r.calm === true) return "calm";
  const d = r.direction;
  if (typeof d === "number" && Number.isFinite(d)) return ((d % 360) + 360) % 360;
  if (typeof d === "string") {
    const t = d.replace(/[\s)\]）]/g, "");
    if (t === "静穏") return "calm";
    const i = SECTORS.indexOf(t as (typeof SECTORS)[number]);
    return i >= 0 ? i * 22.5 : null;
  }
  return null;
}

/** 角度 → 16方位の番号（北 0、北北東 1 …）。 */
export const sectorOf = (deg: number) => Math.round(deg / 22.5) % 16;

export interface WindSummary {
  /** 向きのあった時間の数（静穏は入れない）。 */
  n: number;
  calm: number;
  /** 16方位ごとの時間の数。 */
  counts: number[];
  /** 最頻の方位の番号。同じ数が並んだら、その方位の風速の合計が大きい方、それも同じなら null。 */
  mode: number | null;
  /** 円周平均（°）。R が小さいときは当てにならない。 */
  mean: number | null;
  /** 平均合成ベクトル長（0〜1）。 */
  r: number | null;
}

export function windSummary(rows: WeatherRow[]): WindSummary {
  const counts = Array(16).fill(0);
  const speed = Array(16).fill(0);
  let calm = 0;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const r of rows) {
    const w = windOf(r);
    if (w === "calm") {
      calm++;
      continue;
    }
    if (w == null) continue;
    const s = sectorOf(w);
    counts[s]++;
    speed[s] += typeof r.wind === "number" ? r.wind : 0;
    sx += Math.sin((w * Math.PI) / 180);
    sy += Math.cos((w * Math.PI) / 180);
    n++;
  }
  if (!n) return { n, calm, counts, mode: null, mean: null, r: null };
  const top = Math.max(...counts);
  const tied = counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0);
  let mode: number | null = tied[0];
  if (tied.length > 1) {
    const best = Math.max(...tied.map((i) => speed[i]));
    const strong = tied.filter((i) => speed[i] === best);
    mode = strong.length === 1 ? strong[0] : null;
  }
  const r = Math.hypot(sx, sy) / n;
  const mean = r < 1e-9 ? null : ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
  return { n, calm, counts, mode, mean: mean == null ? null : Math.round(mean), r: Math.round(r * 100) / 100 };
}

/** R の言葉（向きのまとまり）。 */
export const steadiness = (r: number | null) => (r == null ? null : r >= 0.7 ? "そろっている" : r >= 0.4 ? "ややばらつく" : "定まらない");

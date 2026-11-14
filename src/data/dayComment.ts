// その日の要約の一言 (#176): the day's values put into two or three short sentences, read beside the
// numbers: how warm against the comparison day, rain, sunshine, and wind (with the hour it peaked).
// Rules only, no model: every sentence comes from a value on the card, so the words never say more
// than the numbers do.

import { STORM, stormLevel } from "../../shared/storm";
import type { WeatherRow } from "../../shared/types";
import { num } from "../design/format";

const f1 = (v: number) => v.toFixed(1);

/** The hour (1–24) of the strongest hourly mean wind, when the hours have one worth naming. */
export function windPeakHour(hours: WeatherRow[] | null | undefined): number | null {
  let best: { n: number; w: number } | null = null;
  for (const r of hours ?? []) {
    const w = num(r.wind);
    if (w != null && (!best || w > best.w)) best = { n: r.n, w };
  }
  return best && best.w > 0 ? best.n : null;
}

export function dayComment({
  row,
  other,
  otherName,
  hours,
}: {
  row: WeatherRow | null;
  other: WeatherRow | null;
  /** How the comparison day is named in the sentence ("'25/11/8"). */
  otherName: string | null;
  hours?: WeatherRow[] | null;
}): string[] {
  if (!row) return [];
  const out: string[] = [];
  const max = num(row.max);
  const min = num(row.min);
  const rain = num(row.rain);
  const sun = num(row.sun);
  const forecast = row.type === "forecast";

  // 1. Warmth: against the comparison day by the 最高, else the day's own range.
  const omax = num(other?.max);
  if (max != null && omax != null && otherName) {
    const d = +(+max.toFixed(1) - +omax.toFixed(1)).toFixed(1);
    if (Math.abs(d) < 1) out.push(`最高気温は${otherName}とほぼ同じ（${d === 0 ? "±0" : d > 0 ? `+${f1(d)}` : `−${f1(-d)}`}℃）。`);
    else out.push(`${otherName}より最高気温が${f1(Math.abs(d))}℃${d > 0 ? "高く" : "低く"}、${Math.abs(d) >= 3 ? (d > 0 ? "かなり暖かい" : "かなり寒い") : d > 0 ? "暖かい" : "寒い"}${forecast ? "見込み" : "一日"}。`);
  }
  if (max != null && min != null && max - min >= 10) out.push(`朝晩と日中の差が${f1(max - min)}℃と大きめ。`);

  // 2. Rain and sunshine: one sentence, the one that stands out.
  if (rain != null && rain >= 30) out.push(`まとまった雨（${f1(rain)}mm）。`);
  else if (rain != null && rain >= 1) out.push(`雨が${f1(rain)}mm${sun != null && sun >= 5 ? "、晴れ間もあり" : ""}。`);
  else if (sun != null && sun >= 8) out.push(`日差しがたっぷり（日照${f1(sun)}時間）。`);
  else if (sun != null && sun < 1) out.push(`日差しはほとんどなし。`);

  // 3. Wind: a 強風／暴風 day says how strong and, from the hours, when.
  const level = stormLevel(num(row.windMax) ?? num(row.wind), num(row.gust));
  if (level) {
    const gust = num(row.gust);
    const peak = windPeakHour(hours);
    const when = peak != null ? `${peak}時ごろ` : "";
    out.push(`${when}${when ? "に" : ""}${STORM[level].label}${gust != null ? `（最大瞬間${f1(gust)}m/s）` : ""}${forecast ? "の見込み" : ""}。`);
  }
  return out.slice(0, 3);
}

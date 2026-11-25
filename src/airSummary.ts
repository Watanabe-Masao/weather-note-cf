// 空気質の読み方（2026-11-25 渡辺さん「大気質の UI」）。数字はモデルの値（CAMS）か、実測（そらまめくん、管理者だけ）。
//
// 決まり（design-system 4.0a）：どれが誰の値かを文に書く。CAMS は「予測」（今日と先の日）または「モデルの値」（過ぎた日）。
// 環境省の基準（PM2.5 の環境基準 1日平均 35 µg/m³ 以下、注意喚起の暫定的な指針 1日平均 70 µg/m³ を超えるとき）は日平均の値なので、
// 日平均とだけ並べる（1時間ごとの値とは比べない）。黄砂には気象庁の µg/m³ の目安が無いので、多い・少ないは言わず、
// いちばん多い時刻と値だけを言う。1日の時間がそろっていなければ「取得できた範囲」と添える（thread-rules）。
// PM2.5 の時間がそろっていない日は「日平均」と言わず「取得できた N時間の平均」と書き、基準の内側・外側も言わない
// （基準は参考として並べるだけ。11/25 レビュー）。
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import type { Usual } from "../shared/airUsual";
import { dustHighHours, hourSpans, usualLine } from "./airVerdict";

/** 1日の時間の数。 */
const DAY_HOURS = 24;

/** 環境省の PM2.5 の環境基準（1日平均、µg/m³ 以下）と、注意喚起の暫定的な指針（1日平均がこれを超えるとき）。 */
export const PM25_STANDARD = 35;
export const PM25_ALERT = 70;

export interface AirDay {
  /** PM2.5 の日平均（値のある時間の平均、無ければ null）と、その時間の数。 */
  pmMean: number | null;
  pmHours: number;
  /** 黄砂のいちばん多い時刻と値（値が無ければ null）。 */
  dustMax: { h: number; v: number } | null;
  dustHours: number;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function airDay(hours: AirHour[]): AirDay {
  const pm = hours.filter((x) => finite(x.pm2_5));
  const dust = hours.filter((x) => finite(x.dust));
  const top = dust.reduce<AirHour | null>((a, x) => (a == null || x.dust! > a.dust! ? x : a), null);
  return {
    pmMean: pm.length ? pm.reduce((a, x) => a + x.pm2_5!, 0) / pm.length : null,
    pmHours: pm.length,
    dustMax: top ? { h: top.h, v: top.dust! } : null,
    dustHours: dust.length,
  };
}

/** 「予測」（今日と先の日）か「モデルの値」（過ぎた日）。 */
export const camsWord = (kind: "past" | "forecast") => (kind === "forecast" ? "CAMS の予測" : "CAMS のモデルの値");

const part = (n: number) => (n < DAY_HOURS ? "、取得できた範囲" : "");

/**
 * まとめの大気の行に足す1文（値が1時間も無い・読み込み中なら null：無いことを「少ない」とは言わない）。
 * 例：「PM2.5 日平均 13・黄砂 最大 15 µg/m³（CAMS の予測）」
 */
export function airSummaryText(r: { kind: "past" | "forecast"; hours: AirHour[]; usual?: Usual } | null): string | null {
  if (!r || !r.hours.length) return null;
  const d = airDay(r.hours);
  // 基準値も添える（11/25 渡辺さん「ふだんより多いだけではなく基準値が欲しい」）。PM2.5 は環境省の環境基準（日平均 35 以下）を、
  // 24時間そろった日平均にだけ（1時間ごと・途中の平均とは比べない）。黄砂には環境省・気象庁の µg/m³ の基準が無いので、
  // 「ふだんより多い」の境目（ふだんの 90% の値、Weather Note の集計）を「ふだんの目安」として、超えた時と並べる。
  const pm = d.pmMean != null ? `PM2.5 ${d.pmHours < DAY_HOURS ? "平均" : "日平均"} ${Math.round(d.pmMean)} µg/m³${d.pmHours < DAY_HOURS ? "" : `（環境基準は ${PM25_STANDARD} 以下）`}` : null;
  const hi = dustHighHours(r.hours, r.usual);
  const du = r.usual?.items?.dust;
  const dust = d.dustMax ? `黄砂 最大 ${Math.round(d.dustMax.v)} µg/m³${du ? `（ふだんの目安 ${usualLine(du)}${hi.length ? `、超えたのは ${hourSpans(hi)}` : ""}）` : ""}` : null;
  const parts = [pm, dust].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join("・")}。${camsWord(r.kind)}${part(Math.min(d.pmHours || DAY_HOURS, d.dustHours || DAY_HOURS))}`;
}

/** その時刻の値（無ければ null）。 */
export const airAt = (hours: AirHour[], h: number): AirHour | null => hours.find((x) => x.h === h) ?? null;

/** PM2.5 の日平均の読み方（環境省の基準と並べる）。1日そろっていなければ、取得できた時間の平均として基準は参考にとどめる。 */
export function pmReading(d: AirDay, kind: "past" | "forecast"): string | null {
  if (d.pmMean == null) return null;
  const v = Math.round(d.pmMean);
  const about = kind === "forecast" ? " くらい" : "";
  if (d.pmHours < DAY_HOURS)
    return `${camsWord(kind)}で、取得できた ${d.pmHours}時間の平均 ${v} µg/m³${about}。1日分そろっていないので日平均ではなく、環境省の基準（日平均 35 以下）は参考です。`;
  const where = d.pmMean > PM25_ALERT ? "注意喚起の目安（日平均 70 を超える）に当たる値" : d.pmMean > PM25_STANDARD ? "環境基準（日平均 35 以下）を超える値" : "環境基準（日平均 35 以下）の内側";
  return `${camsWord(kind)}で日平均 ${v} µg/m³${about}。環境省の${where}です。`;
}

/** 黄砂の読み方：いちばん多い時刻と値だけ（多い・少ないは言わない）。 */
export function dustReading(d: AirDay, kind: "past" | "forecast"): string | null {
  if (!d.dustMax) return null;
  return `${camsWord(kind)}で、いちばん多いのは ${d.dustMax.h}時ごろ ${Math.round(d.dustMax.v)} µg/m³${d.dustHours < DAY_HOURS ? "（取得できた範囲）" : ""}`;
}

/** 実測：いちばん新しい PM2.5 のある時間（その1時間の終わりの時）と値。 */
export function latestMeasured(hours: MeasuredHour[]): MeasuredHour | null {
  return [...hours].reverse().find((x) => finite(x.pm2_5)) ?? null;
}

/** 実測の PM2.5 の日平均（値のある時間）と、その時間の数。 */
export function measuredMean(hours: MeasuredHour[]): { mean: number; n: number } | null {
  const v = hours.map((x) => x.pm2_5).filter(finite);
  return v.length ? { mean: v.reduce((a, x) => a + x, 0) / v.length, n: v.length } : null;
}

/** "YYYY-MM-DD HH"（HH はその1時間の終わり）を「11/24 21時台」に。 */
export function outLabel(newest: string): string {
  const [d, h] = newest.split(" ");
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${Number(h) - 1}時台`;
}

/**
 * 実測の無い日の言い方（11/25 ルールの見直し：「まだ出ていない」と「無い」を分ける）。速報値は遅れて出るので、
 * いちばん新しい取得で出ていた最後の時がその日より前なら「まだ出ていない」、そうでなければ「無い」。
 */
export function measuredMissing(date: string, newestOut: string | null | undefined): string {
  if (newestOut && newestOut.slice(0, 10) < date) return `まだ出ていません（介良局の速報値は ${outLabel(newestOut)}まで）`;
  if (newestOut && newestOut.slice(0, 10) === date) return `この日はまだ途中です（${outLabel(newestOut)}まで）`;
  return "この日の実測はありません";
}

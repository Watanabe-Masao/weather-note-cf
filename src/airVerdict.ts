// 空気のひとこと（2026-11-25 渡辺さん「空気の質と視程を統合」「分かりやすいか」）：その日の空気で、ふだんと違うところだけを1文に。
// Weather Note の判定（design-system 4.0a）。材料ごとに誰の値かを添える。
//
// - 黄砂・PM2.5：その項目のふだん（手前30日の1時間値、shared/airUsual.ts）の 90% を超える時間（段 3 以上＝「多い」）を拾う。
//   PM2.5 は介良局の実測があれば実測で（その1時間の平均、「h時台」）、無ければ CAMS で。黄砂は CAMS だけ（高知に黄砂の実測は無い）。
//   11/25 の外部レビュー：実測で比べるのは、介良局のふだんがあるときだけ。実測の無い時間（まだ出ていない後の時間など）は CAMS で見て、
//   どちらの値か・どの時間かを分けて書く（1時間でも実測があると1日全部を実測で見たように読めていた）。
// - 視程：気象庁の黄砂観測の見通しの区分で 5km 未満の時間（観測だけ、予報は入れない）。
// - 何も無いときに「ふだんと大きな違いはありません」と言うのは、PM2.5（実測か CAMS のどちらかで比べられた時間）と黄砂（CAMS）が
//   それぞれ 20時間以上あるときだけ（データがそろわないのに「違いは無い」と言わない、thread-rules）。そうでなければ「比べる値がそろっていません」。
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import { type Usual, type UsualItem, usualLevel } from "../shared/airUsual";
import type { WeatherRow } from "../shared/types";

const MANY = 3;
const ENOUGH_HOURS = 20;

/** 続いた時を「13〜16時」のようにまとめる（1時間だけなら「13時」）。suffix は「時」か「時台」。 */
export function hourSpans(hours: number[], suffix = "時"): string {
  const hs = [...new Set(hours)].sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (const h of hs) {
    const last = spans[spans.length - 1];
    if (last && h === last[1] + 1) last[1] = h;
    else spans.push([h, h]);
  }
  return spans.map(([a, b]) => (a === b ? `${a}${suffix}` : `${a}〜${b}${suffix}`)).join("・");
}

/** 黄砂がふだんより多い（ふだんの 90% を超える＝段 3 以上）時。ふだんが無ければ空。まとめの空気の行（airSummary.ts）も使う。 */
export const dustHighHours = (hours: AirHour[], usual?: Usual): number[] => hours.filter((h) => (usualLevel(h.dust, usual?.items?.dust) ?? 0) >= MANY).map((h) => h.h);

/**
 * 「ふだんより多い」の境目（ふだんの 90% の値、Weather Note の集計）を数字で（11/25 渡辺さん「基準値が欲しい」）。
 * 環境省の基準ではないので「ふだんの目安」と書く（design-system 4.0a）。
 */
export const usualLine = (u: UsualItem | null | undefined): string => (u ? String(Math.round(u.q[2])) : "—");

export interface AirFact {
  key: "dust" | "pm" | "pmCams" | "vis";
  text: string;
  /** 誰の値か。 */
  who: string;
}

export interface AirVerdict {
  /** ふだんと違うところ（無ければ空）。 */
  facts: AirFact[];
  /** facts が無いときの1文（そろっていれば「違いはありません」、そろっていなければそう言う）。 */
  quiet: string | null;
}

export function airVerdict(cams: { hours: AirHour[]; usual?: Usual } | null, measured: { hours: MeasuredHour[]; usual?: Usual } | null, visRows: WeatherRow[] | null): AirVerdict {
  const facts: AirFact[] = [];
  const ch = cams?.hours ?? [];
  const cu = cams?.usual?.items;
  const dustHi = dustHighHours(ch, cams?.usual);
  if (dustHi.length) facts.push({ key: "dust", text: `黄砂がふだんより多い（${hourSpans(dustHi)}）`, who: `CAMS・ふだんの目安 ${usualLine(cu?.dust)} µg/m³` });
  const mh = measured?.hours ?? [];
  const mu = measured?.usual?.items;
  // 実測は、介良局のふだんがあるときだけ比べる（ふだんが無ければ、実測があっても CAMS で見る）。実測の h 時台は CAMS の h 時と同じ1時間。
  const measPm = mu?.pm2_5 ? mh.filter((h) => h.pm2_5 != null) : [];
  const measured_ = new Set(measPm.map((h) => h.hour - 1));
  const hiM = measPm.filter((h) => (usualLevel(h.pm2_5, mu?.pm2_5) ?? 0) >= MANY).map((h) => h.hour - 1);
  if (hiM.length) facts.push({ key: "pm", text: `PM2.5 がふだんより多い（${hourSpans(hiM, "時台")}）`, who: `介良局の実測・ふだんの目安 ${usualLine(mu?.pm2_5)} µg/m³` });
  const camsPm = cu?.pm2_5 ? ch.filter((h) => h.pm2_5 != null && !measured_.has(h.h)) : [];
  const hiC = camsPm.filter((h) => (usualLevel(h.pm2_5, cu?.pm2_5) ?? 0) >= MANY).map((h) => h.h);
  if (hiC.length)
    facts.push({
      key: measPm.length ? "pmCams" : "pm",
      text: `PM2.5 がふだんより多い（${hourSpans(hiC)}）`,
      who: `${measPm.length ? "CAMS（実測の無い時間）" : "CAMS"}・ふだんの目安 ${usualLine(cu?.pm2_5)} µg/m³`,
    });
  const low = (visRows ?? []).filter((r) => r.type === "actual" && typeof r.visibility === "number" && r.visibility < 5 && r.n >= 0 && r.n < 24).map((r) => r.n);
  if (low.length) facts.push({ key: "vis", text: `見通しが 5km 未満（${hourSpans(low)}）`, who: "気象台の観測" });
  if (facts.length) return { facts, quiet: null };
  const pmHours = measPm.length + camsPm.length;
  const dustHours = cu?.dust ? ch.filter((h) => h.dust != null).length : 0;
  const enough = pmHours >= ENOUGH_HOURS && dustHours >= ENOUGH_HOURS;
  return { facts, quiet: enough ? "ふだんと大きな違いはありません" : "ふだんと比べる値がそろっていません" };
}

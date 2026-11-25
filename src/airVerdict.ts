// 空気のひとこと（2026-11-25 渡辺さん「空気の質と視程を統合」「分かりやすいか」）：その日の空気で、ふだんと違うところだけを1文に。
// Weather Note の判定（design-system 4.0a）。材料ごとに誰の値かを添える。
//
// - 黄砂・PM2.5：その項目のふだん（手前30日の1時間値、shared/airUsual.ts）の 90% を超える時間（段 3 以上＝「多い」）を拾う。
//   PM2.5 は介良局の実測があれば実測で（その1時間の平均、「h時台」）、無ければ CAMS で。黄砂は CAMS だけ（高知に黄砂の実測は無い）。
// - 視程：気象庁の黄砂観測の見通しの区分で 5km 未満の時間（観測だけ、予報は入れない）。
// - 何も無いときに「ふだんと大きな違いはありません」と言うのは、CAMS の時間が 20時間以上あり、PM2.5 と黄砂のふだんがあるときだけ
//   （データがそろわないのに「違いは無い」と言わない、thread-rules）。そうでなければ「比べる値がそろっていません」。
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import { type Usual, usualLevel } from "../shared/airUsual";
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

export interface AirFact {
  key: "dust" | "pm" | "vis";
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
  const dustHi = ch.filter((h) => (usualLevel(h.dust, cu?.dust) ?? 0) >= MANY).map((h) => h.h);
  if (dustHi.length) facts.push({ key: "dust", text: `黄砂がふだんより多い（${hourSpans(dustHi)}）`, who: "CAMS" });
  const mh = measured?.hours ?? [];
  const mu = measured?.usual?.items;
  const measPm = mh.filter((h) => h.pm2_5 != null);
  if (measPm.length) {
    const hi = measPm.filter((h) => (usualLevel(h.pm2_5, mu?.pm2_5) ?? 0) >= MANY).map((h) => h.hour - 1);
    if (hi.length) facts.push({ key: "pm", text: `PM2.5 がふだんより多い（${hourSpans(hi, "時台")}）`, who: "介良局の実測" });
  } else {
    const hi = ch.filter((h) => (usualLevel(h.pm2_5, cu?.pm2_5) ?? 0) >= MANY).map((h) => h.h);
    if (hi.length) facts.push({ key: "pm", text: `PM2.5 がふだんより多い（${hourSpans(hi)}）`, who: "CAMS" });
  }
  const low = (visRows ?? []).filter((r) => r.type === "actual" && typeof r.visibility === "number" && r.visibility < 5 && r.n >= 0 && r.n < 24).map((r) => r.n);
  if (low.length) facts.push({ key: "vis", text: `見通しが 5km 未満（${hourSpans(low)}）`, who: "気象台の観測" });
  if (facts.length) return { facts, quiet: null };
  const enough = ch.filter((h) => h.pm2_5 != null && h.dust != null).length >= ENOUGH_HOURS && !!cu?.pm2_5 && !!cu?.dust;
  return { facts, quiet: enough ? "ふだんと大きな違いはありません" : "ふだんと比べる値がそろっていません" };
}

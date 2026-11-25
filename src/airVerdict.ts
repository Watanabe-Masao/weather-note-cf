// 空気のひとこと（2026-11-25 渡辺さん「空気の質と視程を統合」「分かりやすいか」）：その日の空気で、ふだんと違うところだけを1文に。
// Weather Note の判定（design-system 4.0a）。材料ごとに誰の値かを添える。
//
// - 2026-11-25（渡辺さん OK、research/air-usual の結果）：黄砂・PM2.5 は「ふだんより多い日」かを1日の値で決める（PM2.5 は日平均、
//   黄砂は日最大を、手前30日の1日の値の 90% と比べる）。1時間でも 90% を超えたら、だと2日に1日ほど出ていた（1日の値なら約1割）。
//   多い日だけ、1時間の目安（手前30日の1時間値の 90%）を超えた時間を添える。以下は 11/25 までの書き方（参考）：
// - 黄砂・PM2.5：その項目のふだん（手前30日の1時間値、shared/airUsual.ts）の 90% を超える時間（段 3 以上＝「多い」）を拾う。
//   PM2.5 は介良局の実測があれば実測で（その1時間の平均、「h時台」）、無ければ CAMS で。黄砂は CAMS だけ（高知に黄砂の実測は無い）。
//   11/25 の外部レビュー：実測で比べるのは、介良局のふだんがあるときだけ。実測の無い時間（まだ出ていない後の時間など）は CAMS で見て、
//   どちらの値か・どの時間かを分けて書く（1時間でも実測があると1日全部を実測で見たように読めていた）。
// - 視程：気象庁の黄砂観測の見通しの区分で 5km 未満の時間（観測だけ、予報は入れない）。
// - 何も無いときに「ふだんと大きな違いはありません」と言うのは、PM2.5（実測か CAMS のどちらかで比べられた時間）と黄砂（CAMS）が
//   それぞれ 20時間以上あるときだけ（データがそろわないのに「違いは無い」と言わない、thread-rules）。そうでなければ「比べる値がそろっていません」。
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import { dayValue, type Usual, type UsualItem, usualLevel } from "../shared/airUsual";
import type { WeatherRow } from "../shared/types";

const MANY = 3;

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
  const cd = cams?.usual?.days;
  const r0 = (v: number) => String(Math.round(v));
  const many = (hs: number[], suffix = "時") => (hs.length ? `（多いのは ${hourSpans(hs, suffix)}）` : "");
  // 黄砂（CAMS）：その日の最大を、手前30日の日最大の 90% と比べる。多い日だけ、1時間の目安を超えた時間を添える。
  const dustDay = dayValue(ch.map((h) => h.dust), "max");
  const dustOk = dustDay != null && !!cd?.dust;
  if (dustOk && dustDay > cd!.dust!.p90)
    facts.push({ key: "dust", text: `黄砂がふだんより多い日${many(dustHighHours(ch, cams?.usual))}`, who: `CAMS・日最大 ${r0(dustDay)} µg/m³（ふだんの目安 ${r0(cd!.dust!.p90)}）` });
  // PM2.5：介良局の実測が 20時間以上あり、介良局の1日のふだんがあれば、実測の日平均で。そうでなければ CAMS の日平均で。
  const mh = measured?.hours ?? [];
  const md = measured?.usual?.days?.pm2_5;
  const mu = measured?.usual?.items?.pm2_5;
  const measDay = dayValue(mh.map((h) => h.pm2_5), "mean");
  let pmOk = false;
  if (measDay != null && md) {
    pmOk = true;
    if (measDay > md.p90) {
      const hi = mh.filter((h) => (usualLevel(h.pm2_5, mu) ?? 0) >= MANY).map((h) => h.hour - 1);
      facts.push({ key: "pm", text: `PM2.5 がふだんより多い日${many(hi, "時台")}`, who: `介良局の実測・日平均 ${r0(measDay)} µg/m³（ふだんの目安 ${r0(md.p90)}）` });
    }
  } else {
    const camsDay = dayValue(ch.map((h) => h.pm2_5), "mean");
    if (camsDay != null && cd?.pm2_5) {
      pmOk = true;
      if (camsDay > cd.pm2_5.p90) {
        const hi = ch.filter((h) => (usualLevel(h.pm2_5, cams?.usual?.items?.pm2_5) ?? 0) >= MANY).map((h) => h.h);
        const last = latestMeasuredHour(mh);
        facts.push({
          key: "pm",
          text: `PM2.5 がふだんより多い日${many(hi)}`,
          who: `${last != null ? `CAMS（介良局の実測は ${last}時台まで）` : "CAMS"}・日平均 ${r0(camsDay)} µg/m³（ふだんの目安 ${r0(cd.pm2_5.p90)}）`,
        });
      }
    }
  }
  const low = (visRows ?? []).filter((r) => r.type === "actual" && typeof r.visibility === "number" && r.visibility < 5 && r.n >= 0 && r.n < 24).map((r) => r.n);
  if (low.length) facts.push({ key: "vis", text: `見通しが 5km 未満（${hourSpans(low)}）`, who: "気象台の観測" });
  if (facts.length) return { facts, quiet: null };
  return { facts, quiet: pmOk && dustOk ? "ふだんと大きな違いはありません" : "ふだんと比べる値がそろっていません" };
}

/** 介良局の実測の、値のある最後の「時台」（無ければ null）。 */
const latestMeasuredHour = (mh: MeasuredHour[]) => {
  const hs = mh.filter((h) => h.pm2_5 != null).map((h) => h.hour - 1);
  return hs.length ? Math.max(...hs) : null;
};

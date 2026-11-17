// 「暫定」の説明 (2026-11-18 渡辺さん「暫定ではユーザーは分かりにくい」)：まだ確定していない実績の日に、
//   いまの値の出どころ・何を待っているか・いつごろ確定に変わるか、を言葉にする。
// 確定の決まりは shared/fixed.ts の1つだけ（3日たち、気象庁の日の表に天気概況とすべての値がそろう）。ここは
// その決まりを言い直すだけで、別の決まりを作らない。出どころは行の provider：
//   JMA-recent：気象庁の日の表がまだ出ていない日。アメダスの10分ごとの観測から計算した値（worker/src/amedas.ts）
//   JMA：気象庁「過去の気象データ」の日の表（まだ出ていない値＝unpublished）
// 時刻は、気象庁が表を出す時刻を約束していないため書かない。アプリが読み直すのは開いたとき。

import { addDays } from "./dates";
import { FIXED_AFTER_DAYS } from "./fixed";
import type { WeatherRow } from "./types";

/** 日の表の列の呼び方（worker/src/jma-tables.ts の日の列）。 */
const COLUMN_NAMES: Record<string, string> = {
  temp: "平均気温",
  max: "最高気温",
  min: "最低気温",
  rain: "降水量",
  humidity: "平均湿度",
  humidityMin: "最小湿度",
  wind: "平均風速",
  windMax: "最大風速",
  gust: "最大瞬間風速",
  sun: "日照時間",
  pressure: "気圧",
  rainHour: "1時間の最大降水量",
  snow: "降雪",
  snowDepth: "積雪",
  dayWeather: "天気概況（昼）",
  nightWeather: "天気概況（夜）",
};

export interface ProvisionalNote {
  /** いまの値の出どころ。 */
  source: string;
  /** 何を待っているか（1つ以上）。 */
  waiting: string[];
  /** いつごろ確定に変わるか。 */
  when: string;
}

const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;

/** 暫定の日の説明。実績でない行（予報）や、すでに確定の日には null。 */
export function provisionalNote(row: WeatherRow | null, date: string, today: string, fixed: boolean): ProvisionalNote | null {
  if (!row || row.type !== "actual" || fixed) return null;
  const fixedFrom = addDays(date, FIXED_AFTER_DAYS);
  const recent = row.provider === "JMA-recent" || row.provider === "JMA-amedas" || (row.provisional === true && row.provider !== "JMA");
  const source = recent ? "アメダスの速報（10分ごとの観測から計算した値）" : "気象庁「過去の気象データ」の日の表（確定前の値）";
  const waiting: string[] = [];
  if (date >= today) waiting.push("今日の観測が終わること");
  if (recent) waiting.push("気象庁の日の表（まだ出ていません）");
  else {
    const missing = [...new Set([...(row.unpublished ?? []), ...(row.dayWeather ? [] : ["dayWeather"])])].map((k) => COLUMN_NAMES[k] ?? k);
    if (missing.length) waiting.push(`日の表のまだ出ていない値：${missing.join("・")}`);
  }
  if (today < fixedFrom) waiting.push(`${FIXED_AFTER_DAYS}日たつこと（アプリは${FIXED_AFTER_DAYS}日たった日だけを確定にします）`);
  const when =
    today < fixedFrom
      ? `${md(fixedFrom)}以降、アプリを開いたときに気象庁の表を読み直して、値がそろっていれば確定に変わります`
      : "気象庁がまだ出していない値が出たら、アプリを開いたときに確定に変わります";
  return { source, waiting, when };
}

// 日ごとの値の出どころの札（2026-11-23 渡辺さん「実績も何の実績、暫定も同様」「一つ一つデータの出典が分かるように」）。
//
//   確定：気象庁 過去の気象データ（確定値）       暫定：気象庁 過去の気象データ（暫定値）
//   速報：気象庁 アメダスの速報（表に載る前）     府県・週間：気象庁の府県・週間天気予報（src/data/official.ts）
//   補完：Open-Meteo（気象庁の予報が無い日）
// 気象庁の予報の日でも、気象庁に無い項目（平均・雨の量 …）は Open-Meteo：その値だけ印を付ける（omValue）。
// 札は短く、説明はふだん隠して ⓘ で出す（同じ日、2026-11-23「こういう部分は基本的に隠して必要に応じて取り出せるように」）。

import type { JmaSource, JmaSources } from "./data/official";
import type { WeatherRow } from "../shared/types";

export type SourceTag = "確定" | "暫定" | "速報" | "府県" | "週間" | "補完";

export const SOURCE_TAGS: SourceTag[] = ["確定", "暫定", "速報", "府県", "週間", "補完"];

/** 札の説明（ⓘ の中）。 */
export const SOURCE_TEXT: Record<SourceTag, string> = {
  確定: "気象庁 過去の気象データ（確定値）",
  暫定: "気象庁 過去の気象データ（暫定値。あとで直ることがある）",
  速報: "気象庁 アメダスの速報（過去の気象データに載る前の直近の日）",
  府県: "気象庁 府県天気予報（いちばん新しい発表）",
  週間: "気象庁 週間天気予報（いちばん新しい発表）。A・B・C は気象庁の信頼度",
  補完: "Open-Meteo（気象庁の予報が無い日：8日先から、11時の発表までの7日先）。A・B・C は計算のばらつき",
};

/** 予報の札か（信頼度を添える札）。 */
export const isForecastTag = (t: SourceTag | "" | null | undefined) => t === "府県" || t === "週間" || t === "補完";

const sourcesOf = (row: WeatherRow | null | undefined): JmaSources | null =>
  row?.type === "forecast" && row.jmaSources && typeof row.jmaSources === "object" ? (row.jmaSources as JmaSources) : null;

/** 気象庁の予報の値が重なった予報の日か。 */
export const isJmaForecastDay = (row: WeatherRow | null | undefined) => {
  const s = sourcesOf(row);
  return !!s && Object.keys(s).length > 0;
};

/**
 * 1日の札。実績は provider と確定かどうかで、予報は重なった気象庁の値の発表の種類で（気温の出どころを先に：
 * 明後日は天気が府県天気予報、気温が週間天気予報で、表の数字は気温だから）。
 */
export function sourceTag(row: WeatherRow | null | undefined, kind: "fixed" | "variable" | null | undefined): SourceTag | "" {
  if (!row) return "";
  if (row.type === "forecast") {
    const s = sourcesOf(row);
    const lead = s?.max ?? s?.min ?? s?.dayWeather ?? s?.probability;
    if (!lead) return "補完";
    return lead.kind === "VPFD51" ? "府県" : "週間";
  }
  if (kind === "fixed") return "確定";
  const recent = row.provider === "JMA-recent" || row.provider === "JMA-amedas" || (row.provisional === true && row.provider !== "JMA");
  return recent ? "速報" : "暫定";
}

/** 表の行（系列の key）が、気象庁の予報のどの項目から来るか。無い行は Open-Meteo。 */
const JMA_FIELDS: Record<string, (keyof JmaSources)[]> = {
  max: ["max"],
  min: ["min"],
  range: ["max", "min"],
  probability: ["probability"],
};

/** 気象庁の予報の日に、この行の値だけ Open-Meteo か（点線の印）。補完の日（日ぜんぶ Open-Meteo）は札で分かるので false。 */
export function omValue(row: WeatherRow | null | undefined, key: string): boolean {
  const s = sourcesOf(row);
  if (!s || !Object.keys(s).length) return false;
  const fields = JMA_FIELDS[key];
  return !fields || fields.some((f) => !s[f]);
}

const md = (iso: string) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
const hour = (iso: string) => `${+iso.slice(11, 13)}時`;

/** 気象庁の発表の名前（「気象庁 週間天気予報 11/22 17時発表・高知」）。 */
export function issueText(s: JmaSource): string {
  const kind = s.kind === "VPFD51" ? "府県天気予報" : "週間天気予報";
  return `気象庁 ${kind} ${md(s.issuedAt)} ${hour(s.issuedAt)}発表・${s.placeName}`;
}

/** 日の表の1つの項目の出典（ⓘ で出す1行）。予報でない行は null（札で足りる）。 */
export function valueSource(row: WeatherRow | null | undefined, field: keyof JmaSources | string): string | null {
  if (row?.type !== "forecast") return null;
  const s = sourcesOf(row);
  const fields = JMA_FIELDS[field] ?? (field === "dayWeather" || field === "confidence" ? [field as keyof JmaSources] : null);
  const from = fields?.map((f) => s?.[f]).filter((x): x is JmaSource => !!x) ?? [];
  if (fields && from.length === fields.length && from.length) {
    const one = from[0];
    if (one.pop6?.length) return `${issueText(one)}（6時間降水確率のいちばん高い区切り）`;
    return [...new Set(from.map(issueText))].join("／");
  }
  return isJmaForecastDay(row) ? "Open-Meteo（気象庁の予報に無い値）" : "Open-Meteo（気象庁の予報がまだ無い日）";
}

/** 表の行の値が気象庁の予報の値か（気象庁の値は整数：小数を付けて出さない）。 */
export function jmaValue(row: WeatherRow | null | undefined, key: string): boolean {
  const s = sourcesOf(row);
  const fields = JMA_FIELDS[key];
  return !!s && !!fields && fields.every((f) => !!s[f]);
}

/** 気象庁の値の書き方：整数のまま（「20.0」を「20」に）。 */
export const jmaText = (text: string) => text.replace(/\.0(?=\D*$)/, "");

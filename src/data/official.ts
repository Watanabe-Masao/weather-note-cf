// 予報の日に、気象庁の値を重ねる（予報の出典、2026-11-23）。
//
// Open-Meteo の日ごとの予報の行に、気象庁のいちばん新しい発表の値（/api/forecast-official、shared/jmaOfficial.ts）を
// 項目ごとに上書きする。気象庁が出している項目は気象庁、出していない項目（平均・雨の量・日照・湿度 …）と、どの
// 発表もまだ言っていない日は Open-Meteo のまま。値は混ぜ合わせない（気象庁の値をそのまま置く）。
// 上書きした項目は `origin` に "jma-forecast"、どの発表の値かは `jmaSources` に残す（画面の札と ⓘ が読む）。
// 純粋な関数：保存も通信もしない。保存はしない（開くたびに取り直す、店の getDay が重ねる）。

import type { OfficialDay, OfficialSource } from "../../shared/jmaOfficial";
import type { WeatherRow } from "../../shared/types";
import { weatherCodeText } from "../../shared/weatherCode";

/** 1つの項目の出どころ（気象庁の発表）。降水確率が府県天気予報の6時間ごとから来たときは、その区切りすべて。 */
export interface JmaSource extends OfficialSource {
  lower?: number | null;
  upper?: number | null;
  /** 降水確率：府県天気予報の6時間降水確率のいちばん高い区切りから（区切りぜんぶ。`hour` は区切りの始まりの時）。 */
  pop6?: { hour: number; v: number; issuedAt: string }[];
}

export type JmaSources = Partial<Record<"dayWeather" | "max" | "min" | "probability" | "confidence", JmaSource>>;

/** 気象庁の値がその日に1つでもあるか。 */
export const hasOfficial = (d: OfficialDay | undefined): d is OfficialDay =>
  !!d && !!(d.weather || d.max || d.min || d.popDay || d.reliability || d.pop6.some((p) => p));

/**
 * 予報の行 `row` に、その日の気象庁の値 `day` を重ねた行。予報でない行（観測）や、気象庁の値が無い日は `row` のまま。
 *  - 天気：天気予報用テロップ番号の言葉（気象庁の表のまま「晴時々曇」）。Open-Meteo の天気の番号は外す（食い違うので）。
 *  - 最高・最低：気象庁の値（整数）。週間の幅は出どころに。
 *  - 降水確率：週間の日降水確率。無ければ府県天気予報の6時間降水確率のいちばん高い区切り（1日の降水確率の
 *    代わり。Open-Meteo の降水確率も1日のいちばん高い時間の値）。
 *  - 信頼度：週間の信頼度（A・B・C）。気象庁の値がある日に信頼度が無ければ（府県天気予報の日）付けない。
 */
export function overlayOfficial(row: WeatherRow, day: OfficialDay | undefined): WeatherRow {
  if (row.type !== "forecast" || !hasOfficial(day)) return row;
  const out: WeatherRow = { ...row, raw: { ...row.raw }, quality: { ...row.quality }, origin: { ...((row.origin as object) ?? {}) } };
  const origin = out.origin as Record<string, string>;
  const sources: JmaSources = {};
  const set = (field: string, v: unknown) => {
    out[field] = v;
    out.raw[field] = v == null ? "" : String(v);
    out.quality[field] = "normal";
    origin[field] = "jma-forecast";
  };
  const src = (o: { from: OfficialSource; lower?: number | null; upper?: number | null }): JmaSource => ({
    ...o.from,
    ...(o.lower != null || o.upper != null ? { lower: o.lower ?? null, upper: o.upper ?? null } : {}),
  });
  if (day.weather) {
    const text = weatherCodeText(day.weather.v.code);
    if (text) {
      set("dayWeather", text);
      out.weatherCode = null;
      delete out.raw.weatherCode;
      origin.weatherCode = "jma-forecast";
      out.jmaWeatherCode = day.weather.v.code;
      sources.dayWeather = src(day.weather);
    }
  }
  if (day.max) {
    set("max", day.max.v);
    sources.max = src(day.max);
  }
  if (day.min) {
    set("min", day.min.v);
    sources.min = src(day.min);
  }
  if (day.popDay) {
    set("probability", day.popDay.v);
    sources.probability = src(day.popDay);
  } else {
    const slots = day.pop6.map((p, k) => (p ? { hour: k * 6, v: p.v, issuedAt: p.from.issuedAt, from: p.from } : null)).filter((p) => p != null);
    if (slots.length) {
      const top = slots.reduce((a, b) => (b.v > a.v ? b : a));
      set("probability", top.v);
      sources.probability = { ...top.from, pop6: slots.map(({ hour, v, issuedAt }) => ({ hour, v, issuedAt })) };
    }
  }
  // 信頼度：気象庁の値の日は気象庁の信頼度だけ（Open-Meteo のばらつきから出した A・B・C と混ぜない）。
  out.confidence = day.reliability?.v ?? null;
  origin.confidence = "jma-forecast";
  if (day.reliability) sources.confidence = src(day.reliability);
  out.jmaSources = sources;
  return out;
}

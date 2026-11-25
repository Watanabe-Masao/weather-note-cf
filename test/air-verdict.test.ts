// 空気のひとこと（src/airVerdict.ts、11/25）：ふだんより多い時間・見通し 5km 未満だけを拾う。そろわなければ「違いは無い」と言わない。
import { describe, expect, it } from "vitest";
import { airVerdict, hourSpans } from "../src/airVerdict";
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import type { WeatherRow } from "../shared/types";

const usual = {
  from: "2026-10-26",
  to: "2026-11-24",
  items: { pm2_5: { n: 720, q: [3, 10, 14, 18] as [number, number, number, number] }, dust: { n: 720, q: [0, 2, 5, 10] as [number, number, number, number] } },
  // 1日の値のふだん（11/25）：日平均 PM2.5 の 90% が 12、日最大の黄砂の 90% が 6。
  days: { pm2_5: { n: 30, p90: 12 }, dust: { n: 30, p90: 6 } },
};
const hours = (f: (h: number) => Partial<AirHour>): AirHour[] => Array.from({ length: 24 }, (_, h) => ({ h, pm2_5: 8, pm10: 10, dust: 1, aod: 0.1, ...f(h) }));
const vis = (f: (n: number) => number, type: "actual" | "forecast" = "actual"): WeatherRow[] =>
  Array.from({ length: 24 }, (_, i) => ({ date: "2026-11-25", n: i + 1, type, provider: "JMA", raw: {}, quality: {}, visibility: f(i + 1) }));

describe("空気のひとこと（1日の値で「ふだんより多い日」、11/25）", () => {
  it("spans of hours", () => {
    expect(hourSpans([13, 14, 15, 9])).toBe("9時・13〜15時");
    expect(hourSpans([8, 9], "時台")).toBe("8〜9時台");
  });
  it("黄砂：日最大が日最大の目安を超えた日だけ、1時間の目安を超えた時間を添える（CAMS）", () => {
    const v = airVerdict({ hours: hours((h) => ({ dust: h >= 13 && h <= 15 ? 8 : 1 })), usual }, null, null);
    expect(v.facts).toEqual([{ key: "dust", text: "黄砂がふだんより多い日（多いのは 13〜15時）", who: "CAMS・日最大 8 µg/m³（ふだんの目安 6）" }]);
    // 1時間の目安（5）は超えても、日最大（5.5）が日の目安（6）以下なら出さない（1時間でも、だと出すぎた）。
    expect(airVerdict({ hours: hours((h) => ({ dust: h === 13 ? 5.5 : 1 })), usual }, null, null).facts).toEqual([]);
  });
  it("PM2.5：介良局の実測が20時間以上あれば実測の日平均で、時台を添える", () => {
    const m: MeasuredHour[] = Array.from({ length: 24 }, (_, i) => ({ hour: i + 1, pm2_5: i === 8 || i === 9 ? 30 : 11, ox: null, spm: null, no2: null, so2: null, wd: null, ws: null, fetchedAt: "x" }));
    const v = airVerdict({ hours: hours(() => ({})), usual }, { hours: m, usual }, null);
    expect(v.facts).toEqual([{ key: "pm", text: "PM2.5 がふだんより多い日（多いのは 8〜9時台）", who: "介良局の実測・日平均 13 µg/m³（ふだんの目安 12）" }]);
  });
  it("PM2.5：実測が途中（20時間に届かない）なら CAMS の日平均で、実測がどこまでかを添える", () => {
    const m: MeasuredHour[] = [1, 2, 3].map((hour) => ({ hour, pm2_5: 50, ox: null, spm: null, no2: null, so2: null, wd: null, ws: null, fetchedAt: "x" }));
    const v = airVerdict({ hours: hours((h) => ({ pm2_5: h < 6 ? 30 : 8 })), usual }, { hours: m, usual }, null);
    expect(v.facts).toEqual([{ key: "pm", text: "PM2.5 がふだんより多い日（多いのは 0〜5時）", who: "CAMS（介良局の実測は 2時台まで）・日平均 14 µg/m³（ふだんの目安 12）" }]);
  });
  it("visibility under 5 km, observed hours only", () => {
    expect(airVerdict(null, null, vis((n) => (n === 10 || n === 11 ? 3 : 20))).facts).toEqual([{ key: "vis", text: "見通しが 5km 未満（10〜11時）", who: "気象台の観測" }]);
    expect(airVerdict(null, null, vis(() => 3, "forecast")).facts).toEqual([]);
  });
  it("「違いは無い」は PM2.5 と黄砂の両方を1日の値で比べられたときだけ", () => {
    expect(airVerdict({ hours: hours(() => ({})), usual }, null, null).quiet).toBe("ふだんと大きな違いはありません");
    expect(airVerdict({ hours: hours(() => ({})).slice(0, 10), usual }, null, null).quiet).toBe("ふだんと比べる値がそろっていません");
    // 1日の値のふだんが無い（前の答え）：比べない。
    expect(airVerdict({ hours: hours(() => ({})), usual: { ...usual, days: undefined } }, null, null).quiet).toBe("ふだんと比べる値がそろっていません");
  });
});

// 空気のひとこと（src/airVerdict.ts、11/25）：ふだんより多い時間・見通し 5km 未満だけを拾う。そろわなければ「違いは無い」と言わない。
import { describe, expect, it } from "vitest";
import { airVerdict, hourSpans } from "../src/airVerdict";
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import type { WeatherRow } from "../shared/types";

const usual = { from: "2026-10-26", to: "2026-11-24", items: { pm2_5: { n: 720, q: [3, 10, 14, 18] as [number, number, number, number] }, dust: { n: 720, q: [0, 2, 5, 10] as [number, number, number, number] } } };
const hours = (f: (h: number) => Partial<AirHour>): AirHour[] => Array.from({ length: 24 }, (_, h) => ({ h, pm2_5: 8, pm10: 10, dust: 1, aod: 0.1, ...f(h) }));
const vis = (f: (n: number) => number, type: "actual" | "forecast" = "actual"): WeatherRow[] =>
  Array.from({ length: 24 }, (_, i) => ({ date: "2026-11-25", n: i + 1, type, provider: "JMA", raw: {}, quality: {}, visibility: f(i + 1) }));

describe("空気のひとこと", () => {
  it("spans of hours", () => {
    expect(hourSpans([13, 14, 15, 9])).toBe("9時・13〜15時");
    expect(hourSpans([8, 9], "時台")).toBe("8〜9時台");
  });
  it("dust above 90% of the usual, from CAMS", () => {
    const v = airVerdict({ hours: hours((h) => ({ dust: h >= 13 && h <= 15 ? 8 : 1 })), usual }, null, null);
    expect(v.facts).toEqual([{ key: "dust", text: "黄砂がふだんより多い（13〜15時）", who: "CAMS・ふだんの目安 5 µg/m³" }]);
  });
  it("PM2.5 from the measured hours when there are some, else CAMS", () => {
    const m: MeasuredHour[] = [9, 10].map((hour) => ({ hour, pm2_5: 20, ox: null, spm: null, no2: null, so2: null, wd: null, ws: null, fetchedAt: "x" }));
    const v = airVerdict({ hours: hours((h) => ({ pm2_5: h === 3 ? 30 : 8 })), usual }, { hours: m, usual }, null);
    // 実測のある時間は実測で、実測の無い時間（3時）は CAMS で、どちらの値かを分けて書く（11/25 外部レビュー）。
    expect(v.facts).toEqual([
      { key: "pm", text: "PM2.5 がふだんより多い（8〜9時台）", who: "介良局の実測・ふだんの目安 14 µg/m³" },
      { key: "pmCams", text: "PM2.5 がふだんより多い（3時）", who: "CAMS（実測の無い時間）・ふだんの目安 14 µg/m³" },
    ]);
    expect(airVerdict({ hours: hours((h) => ({ pm2_5: h === 3 ? 30 : 8 })), usual }, null, null).facts[0]).toMatchObject({ text: "PM2.5 がふだんより多い（3時）", who: "CAMS・ふだんの目安 14 µg/m³" });
  });
  it("measured hours without Kaira's usual are not judged by them: CAMS is (11/25 review)", () => {
    const m: MeasuredHour[] = [9, 10].map((hour) => ({ hour, pm2_5: 20, ox: null, spm: null, no2: null, so2: null, wd: null, ws: null, fetchedAt: "x" }));
    const v = airVerdict({ hours: hours(() => ({})), usual }, { hours: m }, null);
    expect(v.facts).toEqual([]);
    expect(v.quiet).toBe("ふだんと大きな違いはありません");
  });
  it("says nothing differs only when PM2.5 and dust were each compared for 20 hours (11/25 review)", () => {
    // CAMS の PM2.5 のふだんが無く、実測（ふだんあり）が 10時間だけ：PM2.5 を比べられたのは 10時間なので言わない。
    const m: MeasuredHour[] = Array.from({ length: 10 }, (_, i) => ({ hour: i + 1, pm2_5: 5, ox: null, spm: null, no2: null, so2: null, wd: null, ws: null, fetchedAt: "x" }));
    const noCamsPm = { ...usual, items: { dust: usual.items.dust } };
    expect(airVerdict({ hours: hours(() => ({})), usual: noCamsPm }, { hours: m, usual }, null).quiet).toBe("ふだんと比べる値がそろっていません");
    // 実測 10時間＋残りを CAMS で比べれば 24時間：言える。
    expect(airVerdict({ hours: hours(() => ({})), usual }, { hours: m, usual }, null).quiet).toBe("ふだんと大きな違いはありません");
  });
  it("visibility under 5 km, observed hours only", () => {
    expect(airVerdict(null, null, vis((n) => (n === 10 || n === 11 ? 3 : 20))).facts).toEqual([{ key: "vis", text: "見通しが 5km 未満（10〜11時）", who: "気象台の観測" }]);
    expect(airVerdict(null, null, vis(() => 3, "forecast")).facts).toEqual([]);
  });
  it("says nothing differs only when the day is there and the usual is known", () => {
    expect(airVerdict({ hours: hours(() => ({})), usual }, null, null).quiet).toBe("ふだんと大きな違いはありません");
    expect(airVerdict({ hours: hours(() => ({})).slice(0, 10), usual }, null, null).quiet).toBe("ふだんと比べる値がそろっていません");
    expect(airVerdict({ hours: hours(() => ({})) }, null, null).quiet).toBe("ふだんと比べる値がそろっていません");
  });
});

// 空気質の読み方（src/airSummary.ts、2026-11-25）：誰の値かを書く（CAMS の予測／モデルの値）、環境省の基準は日平均とだけ、
// 黄砂は多い・少ないを言わない、時間がそろっていなければ「取得できた範囲」、値が無ければまとめに何も足さない。
import { describe, expect, it } from "vitest";
import { airDay, airSummaryText, dustReading, latestMeasured, measuredMean, pmReading } from "../../src/airSummary";
import { summaryLines } from "../../src/daySummaryLines";
import type { AirHour, MeasuredHour } from "../../shared/airQuality";

const day = (pm: (h: number) => number | null, dust: (h: number) => number | null = (h) => h): AirHour[] =>
  Array.from({ length: 24 }, (_, h) => ({ h, pm2_5: pm(h), pm10: null, dust: dust(h), aod: null }));

describe("空気質：まとめの1文", () => {
  it("PM2.5 の日平均と黄砂の最大、CAMS の予測かモデルの値か", () => {
    expect(airSummaryText({ kind: "forecast", hours: day(() => 12.6) })).toBe("PM2.5 日平均 13・黄砂 最大 23 µg/m³（CAMS の予測）");
    expect(airSummaryText({ kind: "past", hours: day(() => 8) })).toBe("PM2.5 日平均 8・黄砂 最大 23 µg/m³（CAMS のモデルの値）");
  });
  it("時間がそろっていなければ「取得できた範囲」、値が無ければ null（少ないとは言わない）", () => {
    expect(airSummaryText({ kind: "forecast", hours: day(() => 10).slice(0, 12) })).toBe("PM2.5 平均 10・黄砂 最大 11 µg/m³（CAMS の予測、取得できた範囲）");
    expect(airSummaryText({ kind: "forecast", hours: [] })).toBeNull();
    expect(airSummaryText(null)).toBeNull();
    expect(airSummaryText({ kind: "forecast", hours: day(() => null, () => null) })).toBeNull();
  });
  it("まとめの「空気」の行に、見通しのあとへ足す（大気の行には入れない）。持っていない日は見通しだけ", () => {
    const base = { row: { date: "2026-11-25", type: "forecast", humidity: 62 } as never, hours: null, feelWord: null, nextMin: null, sun: { rise: "6:45", set: "17:05" }, past: false };
    const l = summaryLines({ ...base, air: "PM2.5 日平均 13・黄砂 最大 15 µg/m³（CAMS の予測）" });
    expect(l.find((x) => x.label === "大気")!.text).toBe("湿度 平均 62%");
    expect(l.at(-1)).toEqual({ group: "airq", label: "空気", text: "PM2.5 日平均 13・黄砂 最大 15 µg/m³（CAMS の予測）" });
    const vis = Array.from({ length: 24 }, (_, i) => ({ date: "2026-11-25", n: i + 1, type: "forecast", visibility: 20 - i / 10 }) as never);
    expect(summaryLines({ ...base, hours: vis, air: "PM2.5 日平均 13 µg/m³（CAMS の予測）" }).at(-1)!.text).toBe("見通しの最小 17.7km。PM2.5 日平均 13 µg/m³（CAMS の予測）");
    expect(summaryLines({ ...base, air: null }).at(-1)!.text).toBe("—");
  });
});

describe("空気質：画面の読み方", () => {
  it("PM2.5 は日平均と環境省の基準を並べる（1時間ごとの値とは比べない）", () => {
    expect(pmReading(airDay(day(() => 13)), "forecast")).toBe("CAMS の予測で日平均 13 µg/m³ くらい。環境省の環境基準（日平均 35 以下）の内側です。");
    expect(pmReading(airDay(day(() => 40)), "past")).toBe("CAMS のモデルの値で日平均 40 µg/m³。環境省の環境基準（日平均 35 以下）を超える値です。");
    expect(pmReading(airDay(day(() => 75)), "forecast")).toContain("注意喚起の目安（日平均 70 を超える）に当たる値");
    // ちょうど 70 は「超える」に当たらない
    expect(pmReading(airDay(day(() => 70)), "past")).toContain("環境基準（日平均 35 以下）を超える値");
    // 1日そろっていなければ日平均と言わず、基準の内側・外側も言わない
    expect(pmReading(airDay(day(() => 13).slice(0, 6)), "forecast")).toBe(
      "CAMS の予測で、取得できた 6時間の平均 13 µg/m³ くらい。1日分そろっていないので日平均ではなく、環境省の基準（日平均 35 以下）は参考です。",
    );
    expect(pmReading(airDay(day(() => 50).slice(0, 23)), "past")).not.toMatch(/超える|内側/);
    expect(pmReading(airDay(day(() => null)), "forecast")).toBeNull();
  });
  it("黄砂はいちばん多い時刻と値だけ", () => {
    expect(dustReading(airDay(day(() => 5, (h) => (h === 13 ? 15.2 : 3))), "forecast")).toBe("CAMS の予測で、いちばん多いのは 13時ごろ 15 µg/m³");
  });
  it("実測：いちばん新しい値のある時間と、日平均（時間の数つき）", () => {
    const m = (hour: number, pm: number | null): MeasuredHour => ({ hour, pm2_5: pm, ox: null, spm: null, no2: null, so2: null, wd: null, ws: null, fetchedAt: "" });
    expect(latestMeasured([m(1, 9), m(2, 12), m(3, null)])?.hour).toBe(2);
    expect(measuredMean([m(1, 9), m(2, 12), m(3, null)])).toEqual({ mean: 10.5, n: 2 });
    expect(measuredMean([m(1, null)])).toBeNull();
  });
});

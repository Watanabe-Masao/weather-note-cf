import { describe, expect, it } from "vitest";
import { dayComment, windPeakHour } from "../../src/data/dayComment";
import type { WeatherRow } from "../../shared/types";

const r = (v: Record<string, unknown>): WeatherRow => ({ date: "2026-11-08", n: 8, type: "actual", provider: "JMA", raw: {}, quality: {}, ...v });

describe("dayComment (#176)", () => {
  it("says warmth against the comparison day, rain, and a storm with its hour", () => {
    const hours = [r({ n: 13, wind: 9 }), r({ n: 14, wind: 13.2 }), r({ n: 15, wind: 8 })];
    expect(dayComment({ row: r({ max: 21.6, min: 13.4, rain: 10.9, sun: 1.4, windMax: 14.4, gust: 24.8 }), other: r({ max: 19.4 }), otherName: "’25/11/8", hours })).toEqual([
      "’25/11/8より最高気温が2.2℃高く、暖かい一日。",
      "雨が10.9mm。",
      "14時ごろに強風（最大瞬間24.8m/s）。",
    ]);
  });
  it("near-equal warmth, a wide range, and sunshine; a forecast says 見込み", () => {
    expect(dayComment({ row: r({ type: "forecast", max: 20.3, min: 9.1, rain: 0, sun: 9.6 }), other: r({ max: 20.0 }), otherName: "11/9" })).toEqual([
      "最高気温は11/9とほぼ同じ（+0.3℃）。",
      "朝晩と日中の差が11.2℃と大きめ。",
      "日差しがたっぷり（日照9.6時間）。",
    ]);
    expect(dayComment({ row: r({ type: "forecast", max: 15, min: 12, windMax: 21, gust: 33 }), other: r({ max: 19 }), otherName: "x" })).toEqual([
      "xより最高気温が4.0℃低く、かなり寒い見込み。",
      "暴風（最大瞬間33.0m/s）の見込み。",
    ]);
  });
  it("no row, no words; the peak hour needs some wind", () => {
    expect(dayComment({ row: null, other: null, otherName: null })).toEqual([]);
    expect(windPeakHour([r({ n: 3, wind: 0 })])).toBeNull();
  });

  it("says the typhoon first, as the 台 on the picture does (#220)", () => {
    const row = r({ max: 28.3, min: 24.4, rain: 106.5, sun: 0 });
    expect(dayComment({ row, other: null, otherName: null, typhoon: { number: 15, area: "gale" } })[0]).toBe("台風15号の強風域に入った日。");
    expect(dayComment({ row, other: null, otherName: null, typhoon: { number: 15, area: "storm" } })[0]).toBe("台風15号の暴風域に入った日。");
    expect(dayComment({ row, other: null, otherName: null, typhoon: { number: 30, area: "warning" } })[0]).toBe("台風30号の暴風警戒域に入る予報（気象庁）。");
    expect(dayComment({ row, other: null, otherName: null })[0]).toBe("まとまった雨（106.5mm）。");
  });
});

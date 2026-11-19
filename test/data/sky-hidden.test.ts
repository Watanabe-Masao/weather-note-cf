// 雲で見えにくい（2026-11-20 渡辺さん「雲の多い時間に、月を「雲で見えにくい」と出す」）。
import { describe, expect, it } from "vitest";
import { hidesSky, skyHidden } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";

const hour = (n: number, over: Partial<WeatherRow> = {}): WeatherRow => ({ date: "2026-11-11", n, type: "actual", provider: "JMA", raw: {}, quality: {}, ...over }) as WeatherRow;

describe("sky hidden by clouds", () => {
  it("曇り・霧・雨・雪・雷で晴れの入らない天気だけ", () => {
    for (const t of ["曇", "くもり", "曇一時雨", "雨", "霧", "雪", "雷"]) expect(hidesSky(t), t).toBe(true);
    for (const t of ["晴", "晴れ", "曇時々晴", "晴時々曇", null, ""]) expect(hidesSky(t), String(t)).toBe(false);
  });

  it("その時間の天気の文、無ければ前後2時間の天気から。分からなければ null", () => {
    // 21時台（n=22）：文が無く、雨も無い夜。前後2時間にも無ければ分からない。
    expect(skyHidden([hour(22, { rain: 0 })], 22, "47893")).toBeNull();
    expect(skyHidden([hour(22, { weather: "くもり" })], 22, "47893")).toEqual({ hidden: true, text: "くもり", hour: 22 });
    expect(skyHidden([hour(22, { rain: 0 }), hour(21, { weather: "晴れ" })], 22, "47893")).toEqual({ hidden: false, text: "晴れ", hour: 21 });
    expect(skyHidden([hour(22, { rain: 2 })], 22, "47893")?.hidden).toBe(true); // 雨の記録
    // 3時間離れた天気は借りない。
    expect(skyHidden([hour(22, { rain: 0 }), hour(19, { weather: "くもり" })], 22, "47893")).toBeNull();
  });
});

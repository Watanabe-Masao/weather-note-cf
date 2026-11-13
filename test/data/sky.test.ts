import { describe, expect, it } from "vitest";
import { CLOUD, sunUpFraction } from "../../shared/brightness";
import { cloudiness, daySky, luminanceText, SKY_STEPS, skyAt, skyGlow, stepTime } from "../../shared/sky";
import type { WeatherRow } from "../../shared/types";

const KOCHI = "47893";
const DATE = "2026-11-13";
const row = (n: number, over: Partial<WeatherRow> = {}): WeatherRow => ({ date: DATE, n, type: "actual", provider: "test", raw: {}, quality: {}, ...over }) as WeatherRow;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const grey = (h: string) => {
  const [r, g, b] = rgb(h);
  return Math.max(r, g, b) - Math.min(r, g, b);
};
const light = (h: string) => rgb(h).reduce((a, b) => a + b, 0);
/** A clear day: every hour has all the sunshine it could have had. */
const clearDay = () => Array.from({ length: 24 }, (_, i) => row(i + 1, { sun: sunUpFraction(DATE, i + 1, KOCHI), rain: 0 }));

describe("空の色（模式）", () => {
  it("晴れた昼は青、曇りは灰色、雨は曇りより暗い", () => {
    const clear = skyAt(38, CLOUD.clear, false, false);
    const cloudy = skyAt(38, CLOUD.cloudy, false, false);
    const rain = skyAt(38, CLOUD.rain, true, false);
    const [r, , b] = rgb(clear.zenith);
    expect(b).toBeGreaterThan(r + 40);
    expect(clear.word).toBe("青空");
    expect(grey(cloudy.zenith)).toBeLessThan(6);
    expect(cloudy.word).toBe("白い曇り空");
    expect(light(rain.zenith)).toBeLessThan(light(cloudy.zenith));
    expect(rain.word).toBe("雨空");
  });

  it("晴れの天頂は地平より暗い（昼）", () => {
    const s = skyAt(38, CLOUD.clear, false, false);
    expect(light(s.zenith)).toBeLessThan(light(s.horizon));
  });

  it("雲の度合いは明るさの雲の係数から：晴れ 0、普通の雲 1", () => {
    expect(cloudiness(CLOUD.clear)).toBe(0);
    expect(cloudiness(CLOUD.cloudy)).toBeCloseTo(1, 6);
    expect(cloudiness(CLOUD.rain)).toBe(1);
  });

  it("晴れた日の日の出・日の入りの時間は灰色にならない（明るさと同じ雲の扱い）", () => {
    const sky = daySky(clearDay(), KOCHI);
    // 11/13 Kochi: sunrise about 6:31, sunset about 17:12 → hours 7 and 18.
    for (const n of [7, 18]) {
      const words = sky[n - 1].steps.map((s) => s.word);
      expect(words.some((w) => w === "日の出前後の空" || w === "夕方の空" || w === "薄明の青")).toBe(true);
      expect(words).not.toContain("灰色の空");
      expect(words).not.toContain("暗い曇り空");
    }
  });

  it("1時間を10分ごとに：日の入りの時間の中で夕方の空から薄明の青へ移る", () => {
    const steps = daySky(clearDay(), KOCHI)[17].steps;
    expect(steps).toHaveLength(SKY_STEPS);
    expect(steps[0].word).toBe("夕方の空");
    expect(steps[SKY_STEPS - 1].word).toBe("薄明の青");
    expect(steps[0].altitude).toBeGreaterThan(steps[SKY_STEPS - 1].altitude);
  });

  it("夜のマスも画面の背景（#0a1420）に溶けない", () => {
    const night = skyAt(-60, CLOUD.clear, false, true);
    expect(light(night.zenith)).toBeGreaterThan(light("#0a1420") + 20);
    expect(night.word).toBe("夜空");
  });

  it("暗いほど鮮やかさを落とす（薄明の青は昼の青より彩度が低い）", () => {
    const day = skyAt(38, CLOUD.clear, false, false);
    const dusk = skyAt(-8, CLOUD.clear, false, true);
    expect(grey(dusk.zenith)).toBeLessThan(grey(day.zenith));
  });

  it("強い光ほど色が鮮やか（ハント効果）：晴れた昼の天頂は朝の天頂より彩度が高い", () => {
    const noon = skyAt(38, CLOUD.clear, false, false);
    const morning = skyAt(8, CLOUD.clear, false, false);
    expect(grey(noon.zenith)).toBeGreaterThan(grey(morning.zenith) + 30);
    // 曇りは強い光でも灰色のまま。
    expect(grey(skyAt(38, CLOUD.cloudy, false, false).zenith)).toBeLessThan(6);
  });

  it("夜空の見かけの明るさは周りの様子で変わる：市街地の曇りの夜は開けた場所の晴れの夜より明るく暖色（地上の明るさの段は変えない）", () => {
    const open = skyAt(-30, CLOUD.clear, false, true, 0.14);
    const city = skyAt(-30, CLOUD.cloudy, false, true, 0.3);
    expect(city.skyLuminance / open.skyLuminance).toBeGreaterThan(20); // Kyba 2011: 26 vs 0.43 mcd/m²
    expect(light(city.zenith)).toBeGreaterThan(light(open.zenith) + 40);
    const [r, , b] = rgb(city.zenith);
    expect(r).toBeGreaterThan(b); // the town's light is warm
    expect(skyAt(-30, CLOUD.clear, false, true, 0.4).index).toBe(open.index);
    expect(skyGlow(0.3, 0)).toBeCloseTo(0.0024, 6);
    expect(skyGlow(0.3, 1)).toBeCloseTo(0.026, 6);
  });

  it("輝度の書き方", () => {
    expect(luminanceText(0.0024)).toBe("約2.4 mcd/m²");
    expect(luminanceText(21000)).toBe("約21,000 cd/m²");
  });

  it("時刻の書き方：18時台の2つ目 → 17:10", () => {
    expect(stepTime(18, 1)).toBe("17:10");
    expect(stepTime(1, 0)).toBe("0:00");
  });
});

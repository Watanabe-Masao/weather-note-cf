// The felt brightness (shared/brightness.ts): lux from the sun and the sky, and its six levels.

import { describe, expect, it } from "vitest";
import { BRIGHTNESS_LEVELS, NIGHT_SKY, brightnessIndex, brightnessLevel, brightnessText, clearSkyLux, cloudFactor, dayBrightness, hourLight, luxOf, luxText, twilightLux } from "../../shared/brightness";
import type { WeatherRow } from "../../shared/types";

const row = (n: number, over: Partial<WeatherRow> = {}): WeatherRow => ({ date: "2026-06-21", n, type: "actual", provider: "test", raw: {}, quality: {}, ...over }) as WeatherRow;

describe("the scale", () => {
  it("puts one level per power of ten (ten times the light, one step brighter)", () => {
    expect(BRIGHTNESS_LEVELS.map((l) => l.label)).toEqual(["暗い", "薄明", "薄暗い", "明るい", "とても明るい", "まぶしい"]);
    expect(brightnessIndex(1)).toBeCloseTo(1, 9);
    expect(brightnessIndex(100)).toBeCloseTo(2, 9);
    expect(brightnessIndex(1_000)).toBeCloseTo(3, 9);
    expect(brightnessIndex(10_000)).toBeCloseTo(4, 9);
    expect(brightnessIndex(50_000)).toBeCloseTo(5, 9);
    expect(brightnessIndex(10)).toBeCloseTo(1.5, 9); // halfway in log
    expect(brightnessIndex(0.0001)).toBe(0); // true darkness: the bottom
    expect(brightnessIndex(0.01)).toBeCloseTo(0.5, 9); // 暗い spans 0.0001–1 lx
    expect(brightnessIndex(1e-9)).toBe(0);
    expect(brightnessIndex(1e9)).toBe(6);
  });
  it("turns back into lux, and reads in words", () => {
    for (const lux of [0.01, 3, 450, 7_000, 30_000, 100_000]) expect(luxOf(brightnessIndex(lux))).toBeCloseTo(lux, 6);
    expect(brightnessLevel(4.3).label).toBe("とても明るい");
    expect(luxText(0.03)).toBe("約0.03lx");
    expect(luxText(0.00005)).toBe("0.001lx未満");
    expect(luxText(453)).toBe("約450lx");
    expect(luxText(31_000)).toBe("約3万lx");
    expect(brightnessText(brightnessIndex(31_000))).toBe("とても明るい（約3万lx）");
  });
});

describe("light from the sun and the sky", () => {
  it("follows published clear-sky values: ~700 lx at sunrise, ~3 lx at −6°, starlight at −18°, ~100,000 lx high sun", () => {
    expect(twilightLux(0)).toBe(700);
    expect(twilightLux(-6)).toBeCloseTo(3.4, 6);
    expect(twilightLux(-30)).toBe(0.001);
    expect(clearSkyLux(80)).toBeGreaterThan(90_000);
    expect(clearSkyLux(80)).toBeLessThan(140_000);
    expect(clearSkyLux(30)).toBeGreaterThan(40_000);
    expect(clearSkyLux(30)).toBeLessThan(80_000);
    // Never darker just above the horizon than at it.
    expect(clearSkyLux(0.5)).toBeGreaterThanOrEqual(700);
  });
  it("dims with clouds: by the hour's sunshine, else its weather", () => {
    expect(cloudFactor(row(12, { sun: 1 }))).toBe(1);
    expect(cloudFactor(row(12, { sun: 0 }))).toBe(0.3);
    expect(cloudFactor(row(12, { weather: "曇" }))).toBe(0.35);
    expect(cloudFactor(row(12, { weather: "雨" }))).toBe(0.2);
    expect(cloudFactor(row(12))).toBe(0.7);
  });
  it("uses the hour's radiation when the sun is up, the sky model otherwise", () => {
    const noon = hourLight(row(13, { radiation: 3.2 }), "47893"); // 3.2 MJ/㎡ in the hour ≈ 890 W/㎡
    expect(noon.from).toBe("radiation");
    expect(noon.lux).toBeCloseTo(3.2 * (1e6 / 3600) * 110, 0);
    expect(brightnessLevel(noon.index).label).toBe("まぶしい");
    const night = hourLight(row(23, { weather: "晴" }), "47893");
    expect(night.from).toBe("sky");
    expect(brightnessLevel(night.index).label).toBe("暗い");
    // Not pitch black: the night sky over a town, inside the 暗い band, brighter under cloud.
    expect(night.lux).toBeCloseTo(NIGHT_SKY.clear, 6);
    expect(night.index).toBeGreaterThan(0.3);
    const cloudy = hourLight(row(23, { weather: "曇" }), "47893");
    expect(cloudy.lux).toBeCloseTo(NIGHT_SKY.overcast, 6);
    expect(cloudy.index).toBeGreaterThan(night.index);
    // Kochi, 21 June, 19時 (18:30, the sun about 6° up): 薄暗い or brighter even under cloud.
    expect(hourLight(row(19, { weather: "曇" }), "47893").lux).toBeGreaterThan(100);
  });
  it("gives the day's mean level with the sun up and its bright hours", () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, { sun: 1, radiation: i + 1 >= 6 && i + 1 <= 19 ? 2 : 0 }));
    const d = dayBrightness(rows, "47893");
    expect(d.daytime!).toBeGreaterThan(4);
    expect(d.brightHours).toBeGreaterThanOrEqual(13);
    expect(dayBrightness([], "47893")).toEqual({ daytime: null, brightHours: null });
  });
});

describe("stepping out of a lit room (adaptation)", () => {
  it("judges the outdoors against about 500 lx: sun dazzles, dusk is dim, night is dark", async () => {
    const { INDOOR_LUX, adaptedResponse, stepOutFeel } = await import("../../shared/brightness");
    expect(adaptedResponse(INDOOR_LUX)).toBeCloseTo(0.5, 9); // half response at the adapted light
    expect(adaptedResponse(50_000)).toBeGreaterThan(0.9);
    expect(stepOutFeel(brightnessIndex(80_000))).toBe("まぶしい");
    expect(stepOutFeel(brightnessIndex(20_000))).toBe("少しまぶしい");
    expect(stepOutFeel(brightnessIndex(3_000))).toBe("明るい");
    expect(stepOutFeel(brightnessIndex(500))).toBe("室内並み");
    expect(stepOutFeel(brightnessIndex(60))).toBe("薄暗い");
    expect(stepOutFeel(brightnessIndex(0.03))).toBe("暗い");
    expect(stepOutFeel(null)).toBeNull();
  });
});

// The felt brightness (shared/brightness.ts): lux from the sun and the sky, and its six levels.

import { describe, expect, it } from "vitest";
import { BRIGHTNESS_LEVELS, CLOUD, SKY_GLOW, brightnessIndex, brightnessLevel, brightnessText, clearSkyLux, rainFactor, cloudFactor, dayBrightness, dayLights, hourLight, luxOf, luxText, nightSkyLux, sunshineDayHours, sunshineFraction, sunUpFraction, twilightLux, usnoSunLux } from "../../shared/brightness";
import type { WeatherRow } from "../../shared/types";
import { dayLengthHours } from "../../shared/dayWeather";

const row = (n: number, over: Partial<WeatherRow> = {}): WeatherRow => ({ date: "2026-06-21", n, type: "actual", provider: "test", raw: {}, quality: {}, ...over }) as WeatherRow;

describe("the scale", () => {
  it("puts one level per power of ten (ten times the light, one step brighter)", () => {
    expect(BRIGHTNESS_LEVELS.map((l) => l.label)).toEqual(["暗い", "薄明", "薄暗い", "明るい", "とても明るい", "日差しの明るさ"]);
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
  it("follows the USNO clear sky (Janiczek & DeYoung 1987): ~750 lx at the horizon, ~3 lx at −6°, starlight at −18°, ~100,000 lx high sun", () => {
    expect(usnoSunLux(0)).toBeGreaterThan(700);
    expect(usnoSunLux(0)).toBeLessThan(850);
    expect(clearSkyLux(60)).toBeGreaterThan(95_000);
    expect(clearSkyLux(60)).toBeLessThan(110_000);
    expect(clearSkyLux(10)).toBeGreaterThan(10_000);
    expect(clearSkyLux(10)).toBeLessThan(12_500);
    expect(clearSkyLux(-6)).toBeCloseTo(twilightLux(-6), 9);
    expect(clearSkyLux(-18)).toBe(0.001);
    expect(clearSkyLux(-30)).toBe(0.001);
  });
  it("runs smoothly and keeps rising from starlight to the high sun (no step at the horizon or the handover)", () => {
    let prev = clearSkyLux(-20);
    for (let d = -19.9; d <= 90; d += 0.1) {
      const v = clearSkyLux(d);
      expect(v).toBeGreaterThanOrEqual(prev * 0.999);
      // At most about one level (×10) per degree near the horizon, far less higher up: never a jump.
      expect(v / prev).toBeLessThan(1.3);
      prev = v;
    }
  });
  it("agrees with the twilight measurements to within a quarter where both exist (−1° to −6°)", () => {
    for (const d of [-1, -2, -3, -4, -5, -6]) expect(Math.abs(Math.log(clearSkyLux(d) / twilightLux(d)))).toBeLessThan(Math.log(1.25));
  });
  it("dims with clouds by the report's sky conditions: from the sunshine in daylight, from rain alone with the sun down", () => {
    expect(cloudFactor(row(12, { sun: 1 }))).toBe(CLOUD.clear);
    expect(cloudFactor(row(12, { sun: 0 }))).toBeCloseTo(CLOUD.cloudy, 9);
    // Half the sunshine: share^0.7 between (Kochi 2025 measured 0.72 of the clear sky).
    expect(cloudFactor(row(12, { sun: 0.5 }))).toBeCloseTo(CLOUD.unknown, 9);
    expect(CLOUD.unknown).toBeGreaterThan(0.7);
    expect(CLOUD.unknown).toBeLessThan(0.76);
    expect(cloudFactor(row(12, { sun: 0, rain: 0.5 }))).toBeCloseTo(CLOUD.rain, 9); // the least rain a record shows
    expect(cloudFactor(row(12, { sun: 0, rain: 2 }))).toBeCloseTo(rainFactor(2), 9); // heavier rain, thicker cloud (darker)
    expect(rainFactor(2)).toBeLessThan(CLOUD.rain);
    // An hour with the sun up for 30 minutes and 0.5 h of sunshine was all sunny.
    expect(cloudFactor(row(19, { sun: 0.5 }), 0.5)).toBe(CLOUD.clear);
    // With the sun down the sunshine is always 0 and says nothing: no factor (a neighbour decides), unless it rains.
    expect(cloudFactor(row(21, { sun: 0 }), 0)).toBeNull();
    expect(cloudFactor(row(21, { sun: 0, rain: 1 }), 0)).toBeCloseTo(rainFactor(1), 9);
  });
  it("uses only what records and forecasts both have: weather text, radiation and drizzle under 0.5 mm change nothing", () => {
    const base = row(13, { sun: 0.4, rain: 0 });
    const plain = hourLight(base, "47893").lux;
    expect(hourLight({ ...base, weather: "雨", radiation: 3.2, solar: 900 } as WeatherRow, "47893").lux).toBe(plain);
    expect(hourLight({ ...base, rain: 0.1 } as WeatherRow, "47893").lux).toBe(plain);
    expect(hourLight({ ...base, rain: 0.5 } as WeatherRow, "47893").lux).toBeLessThan(plain);
  });
  it("takes a twilight hour's clouds from the nearest hour of daylight", () => {
    // Kochi, 21 June: sunset about 19:30. Hour 20 (19–20時, mostly after sunset) and 21 have no sunshine to tell.
    const day = (share: number) => Array.from({ length: 24 }, (_, i) => row(i + 1, { sun: share * sunUpFraction("2026-06-21", i + 1, "47893"), rain: 0 }));
    const sunny = dayLights(day(1), "47893"), dull = dayLights(day(0), "47893");
    expect(sunny[20].factor).toBe(CLOUD.clear); // 21時: from 19時, two hours before
    expect(dull[20].factor).toBeCloseTo(CLOUD.cloudy, 9);
    // Far from daylight: unknown.
    expect(sunny[0].factor).toBeCloseTo(CLOUD.unknown, 9);
  });
  it("keeps the night sky over a town as the floor: 暗い, brighter under cloud", () => {
    const night = hourLight(row(23), "47893", CLOUD.clear);
    expect(brightnessLevel(night.index).label).toBe("暗い");
    // Without a setting: 住宅地, π × the sky's glow (a uniform sky): about 0.003 lx clear, 0.02 overcast.
    const home = SKY_GLOW.find((g) => g.label === "住宅地")!;
    expect(night.lux).toBeCloseTo(Math.PI * home.clear, 6);
    expect(night.lux).toBeGreaterThan(0.0025);
    expect(night.lux).toBeLessThan(0.0035);
    expect(night.index).toBeGreaterThan(0.3);
    const cloudy = hourLight(row(23), "47893", CLOUD.cloudy);
    expect(cloudy.lux).toBeCloseTo(Math.PI * home.overcast, 6);
    expect(nightSkyLux(CLOUD.rain)).toBeCloseTo(Math.PI * home.overcast, 9);
    // The surroundings move the ground's night with the sky's: 市街地 overcast ≈ 0.08 lx, 開けた場所 ≈ 0.004.
    expect(nightSkyLux(CLOUD.cloudy, 0.3)).toBeCloseTo(Math.PI * 0.026, 6);
    expect(nightSkyLux(CLOUD.cloudy, 0.14)).toBeCloseTo(Math.PI * 0.0014, 6);
    expect(hourLight(row(23), "47893", CLOUD.cloudy, 0.3).lux).toBeGreaterThan(cloudy.lux);
    // Kochi, 21 June, 19時 (18:30, the sun about 6° up): 薄暗い or brighter even under cloud.
    expect(hourLight(row(19), "47893", CLOUD.cloudy).lux).toBeGreaterThan(100);
  });
  it("gives the day's mean level with the sun up and its bright hours", () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, { sun: 1 }));
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

describe("adaptation over days (いつもと比べて)", () => {
  it("turns a day's sunshine into its mean daylight, sunrise to sunset (the clear sky's mean, dimmed by the missing sunshine)", async () => {
    const { daylightLux, clearDaylightLux } = await import("../../shared/brightness");
    const { dayEdges } = await import("../../shared/dayParts");
    const e = dayEdges("2026-11-12", "47893");
    const full = (e.set - e.rise) / 60;
    expect(daylightLux(full, "2026-11-12", "47893")!).toBeCloseTo(clearDaylightLux("2026-11-12", "47893"), 6);
    expect(daylightLux(0, "2026-11-12", "47893")!).toBeCloseTo(clearDaylightLux("2026-11-12", "47893") * CLOUD.cloudy, 6);
    expect(clearDaylightLux("2026-11-12", "47893")).toBeGreaterThan(20_000);
    expect(clearDaylightLux("2026-06-21", "47893")).toBeGreaterThan(clearDaylightLux("2026-12-22", "47893"));
    expect(daylightLux(null, "2026-11-12", "47893")).toBeNull();
  });
  it("compares the day with the geometric mean of the days before, and says it in words", async () => {
    const { usualRatio, usualText, usualShort } = await import("../../shared/brightness");
    // A sunny day (20,000) after a dull week (5,000 each): four times the usual.
    expect(usualRatio(20_000, [5_000, 5_000, 5_000, 5_000, 5_000, null, null])).toBeCloseTo(4, 9);
    // Ratios, not differences: 1,000 and 100,000 before average to 10,000.
    expect(usualRatio(10_000, [1_000, 100_000, 1_000, 100_000])).toBeCloseTo(1, 9);
    expect(usualRatio(10_000, [5_000, 5_000, 5_000])).toBeNull(); // fewer than four days
    expect(usualRatio(null, [5_000, 5_000, 5_000, 5_000])).toBeNull();
    expect(usualText(4)).toBe("いつもの4.0倍");
    expect(usualText(0.4)).toBe("いつもの0.4倍");
    expect(usualText(1.05)).toBe("いつも通り");
    expect(usualText(null)).toBe("—");
    expect(usualShort(2.14)).toBe("×2.1");
    expect(usualShort(1.02)).toBe("≈");
  });
  it("is a row under the 日照時間と明るさ graph only (no line, no table row)", async () => {
    const { chartMetricById, graphSeries, tableSeries } = await import("../../src/chartMetrics");
    const m = chartMetricById("light");
    expect(chartMetricById("radiation").under).toBeUndefined();
    expect(m.under!.map((u) => u.key)).toContain("usualLight");
    expect(graphSeries(m).map((s) => s.key)).not.toContain("usualLight");
    expect(tableSeries(m).map((s) => s.key)).not.toContain("usualLight");
  });
});

describe("太陽が低いときの日照（#132）", () => {
  // 高知 2025-11-01（午後は快晴）の実測：16〜17時 0.9時間（3°を切るのは16:54）、17〜18時 0.0時間（太陽は14分）。
  const r = (n: number, sun: number) => ({ date: "2025-11-01", n, type: "actual", provider: "test", raw: {}, quality: {}, sun, rain: 0 }) as WeatherRow;
  it("晴れた夕方の最後の1時間を曇り扱いにしない（照りえた時間は太陽が3°より上の時間）", () => {
    const could = sunshineFraction("2025-11-01", 17, "47893");
    expect(could * 60).toBeGreaterThan(50);
    expect(could * 60).toBeLessThan(58);
    expect(cloudFactor(r(17, 0.9), could)).toBeGreaterThan(0.97);
  });
  it("3°より上にならない時間は日照を読まない（近くの時間から）", () => {
    expect(sunshineFraction("2025-11-01", 18, "47893")).toBe(0);
    const lights = dayLights([r(16, 1), r(17, 0.9), r(18, 0), r(19, 0)], "47893");
    expect(lights[2].factor).toBeGreaterThan(0.97);
    expect(lights[3].factor).toBeGreaterThan(0.97);
  });
  it("1日の照りえた時間は昼の長さより短い", () => {
    expect(sunshineDayHours("2025-11-01", "47893")).toBeLessThan(dayLengthHours("2025-11-01", "47893") - 0.4);
  });
});

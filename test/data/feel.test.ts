import { describe as group, expect, it } from "vitest";
import {
  apparentTemperature,
  daytimeFeel,
  feelOf,
  MJ_PER_HOUR_TO_W,
  radiationOf,
  sunWarming,
  type Band,
  DEFAULT_FEEL,
  describe,
  estimatedBands,
  hourlyBands,
  levelOf,
  spread,
  windAtPerson,
  type Level,
  SCALE_STEPS,
  scaleThresholds,
  stepOf,
  type Thresholds,
} from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";

const hour = (n: number, temp: number | null, humidity = 60, wind = 2, type: "actual" | "forecast" = "actual"): WeatherRow => ({
  date: "2026-11-01",
  n,
  type,
  provider: "test",
  temp,
  humidity,
  wind,
  raw: {},
  quality: {},
});

group("apparent temperature", () => {
  it("matches the improved Missenard formula", () => {
    // 20 ℃, 50 %, 1 m/s: 37 − 17 / (0.68 − 0.07 + 1/3.16) − 0.29·20·0.5
    expect(apparentTemperature(20, 50, 1)).toBeCloseTo(15.75, 1);
    // With no wind the formula reads slightly warmer than the air.
    expect(apparentTemperature(15, 60, 0)).toBeCloseTo(16.36, 1);
  });

  it("feels colder with more wind", () => {
    expect(apparentTemperature(15, 60, 3)).toBeLessThan(apparentTemperature(15, 60, 1));
  });

  it("converts wind to a person's height with the surroundings exponent", () => {
    expect(windAtPerson(10, 10, 0.2)).toBeCloseTo(6.84, 1);
    expect(windAtPerson(10, 10, 0.3)).toBeLessThan(windAtPerson(10, 10, 0.14));
    expect(windAtPerson(10, 1.5, 0.2)).toBeCloseTo(10, 5);
    expect(windAtPerson(10, 10, 0.4)).toBeCloseTo(4.68, 1); // default: dense urban
  });
});

group("levels", () => {
  it("uses the boundaries 5 / 10 / 15 / 21 / 25 / 29 (seven steps)", () => {
    expect([4.9, 5, 9.9, 10, 14.9, 15, 20.9, 21, 24.9, 25, 28.9, 29, 35].map((v) => levelOf(v))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it("groups the seven steps into five and three for short displays", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((l) => stepOf(l as Level, 5))).toEqual([0, 0, 1, 2, 3, 4, 4]);
    expect([0, 1, 2, 3, 4, 5, 6].map((l) => stepOf(l as Level, 3))).toEqual([0, 0, 1, 1, 1, 2, 2]);
    expect([0, 1, 2, 3, 4, 5, 6].map((l) => stepOf(l as Level, 7))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(SCALE_STEPS[5].map((s) => s.label)).toEqual(["寒い", "涼しい", "暑くも寒くもない", "暖かい", "暑い"]);
    expect(SCALE_STEPS[3].map((s) => s.label)).toEqual(["寒い側", "ちょうどよい", "暑い側"]);
  });

  it("gives each scale the boundaries between its own steps", () => {
    const t = [5, 10, 15, 21, 25, 29] as const;
    expect(scaleThresholds([...t] as Thresholds, 7)).toEqual([5, 10, 15, 21, 25, 29]);
    expect(scaleThresholds([...t] as Thresholds, 5)).toEqual([10, 15, 21, 25]);
    expect(scaleThresholds([...t] as Thresholds, 3)).toEqual([10, 25]); // ちょうどよい = 涼しい〜暖かい
  });
});

group("five bands", () => {
  it("averages the hours of each band (by the sun) and ignores hours missing humidity or wind", () => {
    const rows = Array.from({ length: 24 }, (_, i) => hour(i + 1, 10 + i));
    rows[6] = { ...rows[6], humidity: null }; // 7:00 cannot be used for the feel
    const bands = hourlyBands(rows, DEFAULT_FEEL, "47893");
    expect(bands.map((b) => b.label)).toEqual(["朝", "日中", "昼", "夕方", "夜"]);
    // Kochi, 1 November: 朝 (dawn 5:59) holds 6–8時, 昼 12–15時 (shared/dayParts.ts).
    expect(bands[0].hours).toEqual([6, 7, 8]);
    expect(bands[2].hours).toEqual([12, 13, 14, 15]);
    expect(bands[0].temp).toBeCloseTo(16, 5); // 6, 7, 8 → 15, 16, 17
    expect(bands[2].temp).toBeCloseTo(22.5, 5); // 12–15 → 21–24
    expect(bands.every((b) => b.feel != null && b.source === "actual")).toBe(true);
  });

  it("leaves a band empty rather than guessing", () => {
    const rows = [hour(13, 20)];
    const bands = hourlyBands(rows, DEFAULT_FEEL, "47893");
    expect(bands[0]).toMatchObject({ feel: null, level: null });
    expect(bands[2].feel).not.toBeNull();
  });

  it("marks a band that mixes observed and forecast hours", () => {
    const rows = [hour(12, 20), hour(13, 21), hour(14, 22, 60, 2, "forecast")];
    expect(hourlyBands(rows, DEFAULT_FEEL, "47893")[2].source).toBe("mixed");
  });
});

group("estimate from the daily row", () => {
  it("uses the minimum for morning and night and the maximum for midday", () => {
    const row: WeatherRow = { ...hour(1, null), max: 27, min: 11, humidity: 65, wind: 1.5 };
    const bands = estimatedBands(row)!;
    expect(bands.map((b) => b.label)).toEqual(["朝晩", "昼", "朝晩"]);
    expect(bands[1].feel!).toBeGreaterThan(bands[0].feel!);
  });

  it("gives nothing when humidity or wind is missing", () => {
    expect(estimatedBands({ ...hour(1, null), max: 27, min: 11, humidity: null, wind: 1 })).toBeNull();
  });
});

group("describing the day", () => {
  const bands = (m: number, noon: number, night: number): Band[] =>
    [
      ["朝", m],
      ["日中", noon],
      ["昼", noon],
      ["夕方", noon],
      ["夜", night],
    ].map(([label, feel]) => ({ label: label as string, feel: feel as number, temp: null, level: levelOf(feel as number, DEFAULT_FEEL), source: "actual", sunCounted: false }));

  it("finds 'cold mornings and evenings, hot midday'", () => {
    expect(describe(bands(9, 27, 12))).toBe("朝晩は冷えるが昼は暑い");
    expect(spread(bands(9, 27, 12))).toBe(18);
  });

  it("covers the other patterns", () => {
    expect(describe(bands(26, 30, 26))).toBe("一日中暑い");
    expect(describe(bands(5, 9, 6))).toBe("一日中寒い");
    expect(describe(bands(12, 18, 13))).toBe("朝晩は冷える");
    expect(describe(bands(12, 18, 17))).toBe("朝だけ冷える");
    expect(describe(bands(17, 19, 13))).toBe("夜から冷え込む");
    expect(describe(bands(16, 26, 18))).toBe("昼は暑い");
    expect(describe(bands(17, 20, 18))).toBe("過ごしやすい一日");
  });

  it("works on the three-segment estimate too", () => {
    const est: Band[] = [
      { label: "朝晩", feel: 9, temp: null, level: 0, source: "actual", sunCounted: false },
      { label: "昼", feel: 27, temp: null, level: 5, source: "actual", sunCounted: false },
      { label: "朝晩", feel: 9, temp: null, level: 0, source: "actual", sunCounted: false },
    ];
    expect(describe(est)).toBe("朝晩は冷えるが昼は暑い");
  });
});

group("sunshine", () => {
  it("adds about 4 ℃ in clear midday sun (600 W/m², 2 m/s, k = 0.12)", () => {
    expect(sunWarming(600, 2, 0.12)).toBeCloseTo(4.2, 1);
    expect(sunWarming(0, 2, 0.12)).toBe(0);
  });

  it("reads JMA hourly radiation in MJ/m² and forecast radiation in W/m²", () => {
    expect(radiationOf({ radiation: 2.16 })).toBeCloseTo(600, 0);
    expect(MJ_PER_HOUR_TO_W).toBeCloseTo(277.8, 1);
    expect(radiationOf({ solar: 450 })).toBe(450);
    expect(radiationOf({})).toBeNull();
  });

  it("warms only in the sun, and only where radiation was measured", () => {
    const sun = feelOf(20, 50, 2, true, DEFAULT_FEEL, 600)!;
    const shade = feelOf(20, 50, 2, true, { ...DEFAULT_FEEL, sun: false }, 600)!;
    const noData = feelOf(20, 50, 2, true, DEFAULT_FEEL, null)!;
    expect(sun - shade).toBeCloseTo(7.0, 1) // default k = 0.2;
    expect(noData).toBeCloseTo(shade, 5);
  });

  it("raises midday but not night, widening the day's spread (by the sunshine, not the measured radiation: feel-1s)", () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      ...hour(i + 1, 15),
      sun: i + 1 >= 9 && i + 1 <= 15 ? 1 : 0,
    }));
    // A measured radiation alone (no sunshine) adds nothing: records and forecasts take the same inputs (#103).
    const radiationOnly = Array.from({ length: 24 }, (_, i) => ({ ...hour(i + 1, 15), radiation: i + 1 >= 9 && i + 1 <= 15 ? 2 : 0 }));
    expect(hourlyBands(radiationOnly, DEFAULT_FEEL, "47893")[2].feel).toBeCloseTo(hourlyBands(radiationOnly, { ...DEFAULT_FEEL, sun: false }, "47893")[2].feel!, 1);
    const sun = hourlyBands(rows, DEFAULT_FEEL, "47893");
    const shade = hourlyBands(rows, { ...DEFAULT_FEEL, sun: false }, "47893");
    expect(sun[2].feel! - shade[2].feel!).toBeGreaterThan(3); // 昼
    expect(sun[4].feel).toBeCloseTo(shade[4].feel!, 1); // 夜 (its first hour may hold the last minutes of a low sun)
    expect(sun[2].sunCounted).toBe(true);
  });
});

group("daytime feel", () => {
  const row = (n: number, temp: number) =>
    ({ date: "2026-11-10", n, type: "actual", provider: "JMA", temp, humidity: 60, wind: 2, raw: {}, quality: {} }) as WeatherRow;

  it("is the mean of the 日中, 昼 and 夕方 bands (Kochi, 10 November: 9–17時)", () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, i + 1 >= 9 && i + 1 <= 17 ? 20 : 5));
    const shade = { ...DEFAULT_FEEL, sun: false };
    expect(daytimeFeel(rows, shade, "47893")).toBeCloseTo(hourlyBands(rows, shade, "47893")[2].feel!, 1);
  });

  it("is empty unless all three bands have a value", () => {
    expect(daytimeFeel(Array.from({ length: 14 }, (_, i) => row(i + 1, 15)), DEFAULT_FEEL, "47893")).toBeNull();
    expect(daytimeFeel([], DEFAULT_FEEL, "47893")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  candidateDays,
  closeness,
  comparable,
  distance,
  findSimilar,
  rainClass,
  sameDateBack,
  weatherGroup,
} from "../../shared/similar";
import type { WeatherRow } from "../../shared/types";

const row = (date: string, max: number, min: number, rain = 0, dayWeather = "晴"): WeatherRow => ({
  date,
  n: 1,
  type: "actual",
  provider: "JMA",
  max,
  min,
  rain,
  dayWeather,
  raw: {},
  quality: {},
});

describe("similar days: building blocks", () => {
  it("classes rain and weather", () => {
    expect([0, 0.5, 1, 9.9, 10, 30].map(rainClass)).toEqual([0, 1, 2, 2, 3, 4]);
    expect(weatherGroup("晴後一時曇")).toBe("sun");
    expect(weatherGroup("曇一時雨")).toBe("cloud");
    expect(weatherGroup("雨後晴")).toBe("rain");
    expect(weatherGroup("にわか雨")).toBe("rain");
    expect(weatherGroup(null)).toBeNull();
  });

  it("weights the differences as in the spec", () => {
    const a = comparable(row("2026-11-14", 20, 10))!;
    expect(distance(a, a)).toBe(0);
    // max +1, min +1, spread 0 → 2
    expect(distance(a, comparable(row("x", 21, 11))!)).toBe(2);
    // one rain class (2) + other weather (2)
    expect(distance(a, comparable(row("x", 20, 10, 5, "雨"))!)).toBe(4 + 2);
    expect(closeness(0)).toBe(100);
    expect(closeness(5)).toBe(54);
  });

  it("looks in the same season of the past three years, with 29 February falling back to the 28th", () => {
    const days = candidateDays("2026-11-14");
    expect(days).toHaveLength(93);
    expect(days[0]).toBe("2025-10-30");
    expect(days).toContain("2023-11-14");
    expect(sameDateBack("2028-02-29", 1)).toBe("2027-02-28");
  });
});

describe("findSimilar", () => {
  const rows = new Map<string, WeatherRow | null>([
    ["2025-11-14", row("2025-11-14", 20.5, 10.2)], // very close (Friday)
    ["2024-11-09", row("2024-11-09", 21, 11)], // close (Saturday)
    ["2023-11-05", row("2023-11-05", 18, 9, 12, "雨")], // far (Sunday)
    ["2025-11-01", null], // no data
  ]);
  const origin = comparable(row("2026-11-14", 20, 10))!;

  it("returns the nearest first and skips days without data", () => {
    const found = findSimilar(origin, "2026-11-14", rows);
    expect(found.map((m) => m.date)).toEqual(["2025-11-14", "2024-11-09", "2023-11-05"]);
    expect(found[0].closeness).toBeGreaterThan(found[2].closeness);
  });

  it("filters by weekday", () => {
    // 2026-11-14 is a Saturday
    expect(findSimilar(origin, "2026-11-14", rows, "sameWeekday").map((m) => m.date)).toEqual(["2024-11-09"]);
    expect(findSimilar(origin, "2026-11-14", rows, "holidays").map((m) => m.date)).toEqual(["2024-11-09", "2023-11-05"]);
    expect(findSimilar(origin, "2026-11-14", rows, "weekdays").map((m) => m.date)).toEqual(["2025-11-14"]);
  });
});

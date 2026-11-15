// T-01 (#222, research/types): the grouping the month review's sample uses, and the check's pieces.

import { describe, expect, it } from "vitest";
import type { WeatherRow } from "../../shared/types";
import { clusterDays } from "../../research/types/day-types";
import { baseName, markOf, monthsBetween, shiftMonth } from "../../research/types/t01-lib";

const row = (v: Partial<Record<"max" | "min" | "rain" | "sun" | "humidity" | "wind", number>>) => ({ max: 25, min: 15, rain: 0, sun: 8, humidity: 60, wind: 2.5, ...v }) as unknown as WeatherRow;
// Two kinds of day, plainly apart: bright and dry, and dull and wet.
const bright = (i: number) => row({ max: 26 + (i % 3) * 0.3, sun: 8 + (i % 2) * 0.5, humidity: 55 });
const wet = (i: number) => row({ max: 21 + (i % 3) * 0.3, rain: 12 + i, sun: 0.2, humidity: 92 });
const month = (n: number) => Array.from({ length: n }, (_, i) => (i % 3 === 0 ? wet(i) : bright(i)));

describe("天気の型 (day-types)", () => {
  it("finds the two kinds, names them from their centres, and counts each year's days", () => {
    const c = clusterDays(month(30), month(30))!;
    expect(c.types.map((t) => t.sky)).toEqual(["sun", "rain"]);
    expect(c.types[1].a.length).toBe(10);
    expect(c.types[1].b.length).toBe(10);
    expect(c.silhouette).toBeGreaterThan(0.5);
  });

  it("gives the same groups every run (a fixed seed)", () => {
    expect(clusterDays(month(30), month(30))).toEqual(clusterDays(month(30), month(30)));
  });

  it("leaves out a day with a value not recorded, and says so", () => {
    const a: (WeatherRow | null)[] = month(30);
    a[4] = row({ humidity: null as unknown as number });
    a[5] = null;
    expect(clusterDays(a, month(30))!.missingA).toBe(2);
  });

  it("needs enough days", () => {
    expect(clusterDays(month(3), month(3))).toBeNull();
  });

  it("sets 晴れ against the daylight a time band covers", () => {
    const dim = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? wet(i) : row({ sun: 1.5, max: 26 })));
    expect(clusterDays(dim, dim)!.types[0].sky).toBe("cloud"); // a whole day: 1.5 h is dull
    expect(clusterDays(dim, dim, [2, 5], 2.5)!.types[0].sky).toBe("sun"); // a band of 2.5 h of light
  });
});

describe("T-01 pieces", () => {
  it("marks by sky and warmth, and names without the added warmth", () => {
    expect(markOf({ sky: "part", warm: null })).toBe("part/plain");
    expect(markOf({ sky: "sun", warm: "cool" })).toBe("sun/cool");
    expect(baseName("晴れ（24℃）")).toBe("晴れ");
    expect(baseName("雨・涼しい")).toBe("雨・涼しい");
  });

  it("walks months across the year's end", () => {
    expect(shiftMonth("2024-11", -13)).toBe("2023-10");
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

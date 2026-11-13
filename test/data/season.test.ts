import { describe, expect, it } from "vitest";
import { mean30, SEASON, seasonShift, shifted } from "../../shared/season";

describe("従来版の境目が季節で動く (#111)", () => {
  it("is the settings' boundaries at a 30-day mean of 15, and moves 0.7 per ℃ within 5–30", () => {
    expect(seasonShift(15)).toBe(0);
    expect(seasonShift(25)).toBeCloseTo(7, 9);
    expect(seasonShift(7)).toBeCloseTo(-5.6, 9);
    expect(seasonShift(-3)).toBeCloseTo(seasonShift(SEASON.lo), 9);
    expect(seasonShift(35)).toBeCloseTo(seasonShift(SEASON.hi), 9);
  });

  it("puts winter's 15 in 暖かい and summer's 24 in 涼しい (渡辺さん's sense, 2026-11-13)", () => {
    const t = [5, 10, 15, 21, 25, 29] as [number, number, number, number, number, number];
    const level = (v: number, th: number[]) => th.filter((x) => v >= x).length;
    // A cold spell (30-day mean 5): 15 is 暖かい. At Kochi's usual January (about 6.7) the 暖かい edge
    // is 15.3: 15 sits just under it (暑くも寒くもない) — the slope is to be fitted to the reports.
    expect(level(15, shifted(t, seasonShift(5)))).toBe(4); // 暖かい
    expect(level(15.5, shifted(t, seasonShift(6.7)))).toBe(4);
    expect(level(24, shifted(t, seasonShift(28)))).toBe(2); // 涼しい
  });

  it("needs most of the 30 days; never guesses", () => {
    expect(mean30(Array(SEASON.minDays - 1).fill(10))).toBeNull();
    expect(mean30([...Array(SEASON.minDays).fill(10), null])).toBe(10);
  });
});

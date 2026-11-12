// 明るさの移り変わり (shared/lightShift.ts): the light said in minutes, and a difference between two
// days split into the season and the weather. Kochi (47893).

import { describe, expect, it } from "vitest";
import { CLOUD } from "../../shared/brightness";
import { addDays } from "../../shared/dates";
import { clearClockOf, darkMinutes, dayFactor, factorAt, lightSpan, luxAtMinute, shiftAt, spanLength, spanShift, weeklyChange } from "../../shared/lightShift";

const K = "47893";
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const TODAY = "2026-11-12";

describe("the light at a minute", () => {
  it("reads the hourly clouds by JMA hour (n covers n−1 to n o'clock), unknown where missing", () => {
    const clouds = Array.from({ length: 24 }, (_, i) => (i === 16 ? CLOUD.rain : CLOUD.clear));
    expect(factorAt(clouds, hm("16:30"))).toBe(CLOUD.rain); // hour 17
    expect(factorAt(clouds, hm("17:00"))).toBe(CLOUD.clear);
    expect(factorAt([null], 10)).toBe(CLOUD.unknown);
    expect(factorAt(0.5, 999)).toBe(0.5);
    expect(luxAtMinute(TODAY, hm("16:30"), K, clouds)).toBeCloseTo(luxAtMinute(TODAY, hm("16:30"), K) * CLOUD.rain, 6);
  });
});

describe("時刻で: brightness in minutes", () => {
  it("finds the clock time of a light on a clear day, and back", () => {
    const at = hm("17:00");
    const lux = luxAtMinute(TODAY, at, K);
    expect(clearClockOf(TODAY, lux, at, K)!).toBeCloseTo(at, 3);
    expect(darkMinutes(TODAY, at, lux, K)!).toBeCloseTo(0, 3);
    // A third of the light in the evening: a clear day gets that dark some minutes later.
    expect(darkMinutes(TODAY, at, lux / 3, K)!).toBeGreaterThan(2);
    // In the morning a darker light comes earlier on a clear day: still "darker" (positive).
    const am = hm("6:30");
    expect(darkMinutes(TODAY, am, luxAtMinute(TODAY, am, K) / 3, K)!).toBeGreaterThan(2);
  });
  it("finds no time for a light the clear sky never gives near it", () => {
    expect(clearClockOf(TODAY, 1e6, hm("12:00"), K)).toBeNull();
  });
  it("splits a difference into the season and the weather", () => {
    const at = hm("17:00");
    // Same date a year before, both clear: nothing.
    const y = shiftAt(at, { date: TODAY, clouds: 1 }, { date: "2025-11-12", clouds: 1 }, K)!;
    expect(Math.abs(y.total)).toBeLessThan(0.5);
    expect(Math.abs(y.season)).toBeLessThan(0.5);
    // A week before, both clear: all season, a few minutes darker now (autumn).
    const w = shiftAt(at, { date: TODAY, clouds: 1 }, { date: addDays(TODAY, -7), clouds: 1 }, K)!;
    expect(w.season).toBeGreaterThan(3);
    expect(w.season).toBeLessThan(7);
    expect(w.weather).toBeCloseTo(0, 6);
    // Clouds today, clear a year ago: all weather.
    const c = shiftAt(at, { date: TODAY, clouds: CLOUD.cloudy }, { date: "2025-11-12", clouds: 1 }, K)!;
    expect(c.total).toBeGreaterThan(2);
    expect(Math.abs(c.season)).toBeLessThan(0.5);
    expect(c.total).toBeCloseTo(c.season + c.weather, 9);
    // The other way round: brighter (negative).
    expect(shiftAt(at, { date: TODAY, clouds: 1 }, { date: "2025-11-12", clouds: CLOUD.cloudy }, K)!.total).toBeLessThan(-2);
  });
});

describe("明るさで: when a light begins and ends", () => {
  it("matches the brightness review for Kochi on 12 November (clear, 100 lx ends about 17:14)", () => {
    const s = lightSpan(TODAY, 100, K)!;
    expect(s.end).toBeGreaterThanOrEqual(hm("17:12"));
    expect(s.end).toBeLessThanOrEqual(hm("17:16"));
    expect(s.start).toBeLessThan(hm("6:30"));
    // 明るい (1,000 lx) is shorter than 薄暗い and up.
    expect(spanLength(lightSpan(TODAY, 1000, K))).toBeLessThan(spanLength(s));
    // A coarser walk lands on the same minute.
    expect(lightSpan(TODAY, 100, K, CLOUD.clear, 5)).toEqual(s);
    // Never that bright: no span.
    expect(lightSpan(TODAY, 1e6, K)).toBeNull();
  });
  it("moves the evening edge by that hour's clouds only", () => {
    const clouds = Array.from({ length: 24 }, (_, i) => (i === 16 ? CLOUD.rain : CLOUD.clear)); // rain 16–17時
    const clear = lightSpan(TODAY, 1000, K)!, wet = lightSpan(TODAY, 1000, K, clouds)!;
    expect(wet.start).toBe(clear.start);
    expect(wet.end).toBeLessThan(clear.end);
  });
  it("splits the change of a span into season and weather, and into its start and end", () => {
    const w = spanShift(1000, { date: TODAY, clouds: 1 }, { date: addDays(TODAY, -7), clouds: 1 }, K)!;
    expect(w.total).toBeLessThan(-5); // shorter in autumn
    expect(w.weather).toBe(0);
    expect(w.start).toBeGreaterThan(0); // begins later
    expect(w.end).toBeLessThan(0); // ends earlier
    expect(w.total).toBe(w.end - w.start);
    const c = spanShift(1000, { date: TODAY, clouds: CLOUD.cloudy }, { date: "2025-11-12", clouds: 1 }, K)!;
    expect(Math.abs(c.season)).toBeLessThanOrEqual(1);
    expect(c.weather).toBeLessThan(-10);
  });
  it("is fastest near the equinoxes and still near the solstices (clear, per week)", () => {
    const sep = weeklyChange("2026-09-23", 1000, K, addDays)!.length;
    const dec = weeklyChange("2026-12-22", 1000, K, addDays)!.length;
    const mar = weeklyChange("2026-03-20", 1000, K, addDays)!.length;
    expect(sep).toBeLessThan(-12);
    expect(mar).toBeGreaterThan(12);
    expect(Math.abs(dec)).toBeLessThan(3);
  });
});

describe("a day's clouds from its daily sunshine (the year view)", () => {
  it("is clear with all the sunshine the day could have had, average clouds with none", () => {
    expect(dayFactor(24, TODAY, K)).toBe(CLOUD.clear);
    expect(dayFactor(0, TODAY, K)).toBeCloseTo(CLOUD.cloudy, 9);
    expect(dayFactor(null, TODAY, K)).toBeCloseTo(CLOUD.unknown, 9);
  });
});

// comfort-6 (#86): the day's stored sun at night is the latest daytime's total, fading with the
// hours since sunset. comfort-5 read the day's running total, which after 1時 is the new day's (0).

import { describe, expect, it } from "vitest";
import { DRIVERS, type Drivers, observationsOf, RAD_TAU_H, storedHeat, storedSunOf } from "../../src/beta/comfort";
import type { Report } from "../../src/beta/reports";
import { makeReport } from "../../research/data/fixture";
import { solarTimes, stationLatLon } from "../../shared/sunTimes";

const K = stationLatLon("47893")!;
/** Kochi's sunset of a date, in hours. */
const sunset = (date: string) => solarTimes(date, K.lat, K.lon).set / 60;

/** A Kochi report in November (sunset about 17:05, sunrise 6:30), read on `snapDate`'s hours. */
function at(iso: string, snapDate: string, hour: number, radDay: number, yesterday = 20): Report {
  const r = makeReport(iso, Math.min(hour, 23), 15, 0);
  return {
    ...r,
    at: new Date(Date.parse(iso)).toISOString(),
    snapshot: { ...r.snapshot!, date: snapDate, hour, radDay, sunrise: undefined, sunset: undefined },
    recent: [{ date: "2026-11-11", mean: 15, max: 20, min: 10, humidity: 60, sun: 8, radiation: yesterday, rain: 0, weather: "晴", from: "jma-fixed" }],
  } as Report;
}

describe("the stored sun across the night", () => {
  it("in the evening: the day's own total, and the hours since sunset", () => {
    const s = storedSunOf(at("2026-11-12T20:00:00+09:00", "2026-11-12", 20, 18));
    expect(s.storedRad).toBe(18);
    expect(s.sinceSunset!).toBeCloseTo(20 - sunset("2026-11-12"), 2);
  });

  it("in the 0時台 (read as 24時 of the day before): that day's total, still fading from its sunset", () => {
    const s = storedSunOf(at("2026-11-12T00:30:00+09:00", "2026-11-11", 24, 20));
    expect(s.storedRad).toBe(20);
    expect(s.sinceSunset!).toBeCloseTo(24.5 - sunset("2026-11-11"), 2);
  });

  it("from 1時 to sunrise: the day before's total from the daily table — not the new day's 0 (comfort-5's cliff)", () => {
    const s = storedSunOf(at("2026-11-12T03:00:00+09:00", "2026-11-12", 3, 0, 20));
    expect(s.storedRad).toBe(20);
    expect(s.sinceSunset!).toBeCloseTo(27 - sunset("2026-11-11"), 2);
  });

  it("nothing in daylight", () => {
    expect(storedSunOf(at("2026-11-12T12:00:00+09:00", "2026-11-12", 12, 9))).toEqual({ storedRad: null, sinceSunset: null });
  });

  it("no cliff at 1時: the driver moves smoothly from 0:59 to 1:01 (comfort-5 fell from +2 to −2)", () => {
    const before = observationsOf([at("2026-11-12T00:59:00+09:00", "2026-11-11", 24, 20)], 0.8)[0];
    const after = observationsOf([at("2026-11-12T01:01:00+09:00", "2026-11-12", 1, 0, 20)], 0.8)[0];
    const v = (o: Drivers) => DRIVERS.radNight.value(o)!;
    expect(Math.abs(v(before) - v(after))).toBeLessThan(0.05);
    const legacy = (o: Drivers) => DRIVERS.radNight.value({ ...o, legacyRad: true })!;
    expect(legacy(before) - legacy(after)).toBeCloseTo(4, 5); // (20 − 10)/5 → (0 − 10)/5
  });
});

describe("the fading", () => {
  const base = { night: true, storedRad: 20 } as Drivers;
  it("is the full warmth at sunset and 1/e after τ hours (τ given: the default is none, RAD_TAU_H = ∞)", () => {
    expect(storedHeat({ ...base, sinceSunset: 0, radTauH: 4 })).toBeCloseTo(2, 6);
    expect(storedHeat({ ...base, sinceSunset: 4, radTauH: 4 })).toBeCloseTo(2 / Math.E, 6);
    expect(RAD_TAU_H).toBe(Infinity);
    expect(storedHeat({ ...base, sinceSunset: 9 })).toBe(2);
  });
  it("is missing (not 0) without the day's radiation, and 0 by day", () => {
    expect(storedHeat({ ...base, storedRad: null, sinceSunset: 2 })).toBeNull();
    expect(DRIVERS.radNight.value({ ...base, night: false, sinceSunset: null })).toBe(0);
  });
  it("comfort-5's reading is kept for comparisons", () => {
    expect(storedHeat({ ...base, radDay: 0, legacyRad: true, sinceSunset: 9 })).toBe(-2);
  });
});

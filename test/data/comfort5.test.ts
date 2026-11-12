// comfort-5 candidate (#86): night from sunset to sunrise, the sky in daylight only, runs of
// reports in a row end 3 hours after their first report.

import { describe, expect, it } from "vitest";
import { DEFAULT_LAT_LON, solarTimes, stationLatLon } from "../../shared/sunTimes";
import { burstWeights, DRIVERS, type Drivers, nightAt, observationsOf, reportNight } from "../../src/beta/comfort";
import { makeReport } from "../../research/data/fixture";

const at = (iso: string) => Date.parse(iso);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

describe("sunrise and sunset by calculation", () => {
  it("matches the published times within a few minutes", () => {
    // 東京 2026-06-21: 4:25 / 19:00 (国立天文台).
    const tokyo = stationLatLon("47662")!;
    const s = solarTimes("2026-06-21", tokyo.lat, tokyo.lon);
    expect(Math.abs(s.rise - (4 * 60 + 25))).toBeLessThanOrEqual(3);
    expect(Math.abs(s.set - 19 * 60)).toBeLessThanOrEqual(3);
    // 那覇 2026-12-22: 7:12 / 17:44.
    const naha = stationLatLon("47936")!;
    const w = solarTimes("2026-12-22", naha.lat, naha.lon);
    expect(Math.abs(w.rise - (7 * 60 + 12))).toBeLessThanOrEqual(4);
    expect(Math.abs(w.set - (17 * 60 + 44))).toBeLessThanOrEqual(4);
  });

  it("knows the stations, and falls back to Japan's middle", () => {
    expect(stationLatLon("47893")!.lat).toBeCloseTo(33.563, 2);
    expect(stationLatLon("nope")).toBeNull();
    expect(DEFAULT_LAT_LON.lon).toBe(135);
  });
});

describe("night from the sun", () => {
  it("17:30 is night in December and day in June (the clock says the same for both)", () => {
    expect(nightAt(at("2026-12-22T17:30:00+09:00"), "47893")).toBe(true);
    expect(nightAt(at("2026-06-21T17:30:00+09:00"), "47893")).toBe(false);
    expect(nightAt(at("2026-06-21T18:45:00+09:00"), "47893")).toBe(false); // the clock (18時–) says night
    expect(nightAt(at("2026-06-21T05:30:00+09:00"), "47893")).toBe(false); // the clock (–5時) says night
    expect(nightAt(at("2026-06-21T00:30:00+09:00"), "47893")).toBe(true);
  });

  it("uses the stored sunrise and sunset of the same day, and calculates otherwise", () => {
    const t = at("2026-11-10T17:05:00+09:00");
    expect(nightAt(t, "47893", { sunrise: "06:32", sunset: "17:00", date: "2026-11-10" })).toBe(true);
    expect(nightAt(t, "47893", { sunrise: "06:32", sunset: "17:10", date: "2026-11-10" })).toBe(false);
    // Another day's times (a report at 0時台 carries the day before's): calculated instead.
    const k = stationLatLon("47893")!;
    const set = solarTimes("2026-11-10", k.lat, k.lon).set;
    expect(hm(set)).toMatch(/^17:0\d$/);
    expect(nightAt(t, "47893", { sunrise: "06:32", sunset: "16:00", date: "2026-11-09" })).toBe(t >= at(`2026-11-10T${hm(set)}:00+09:00`));
    // Not "HH:MM": calculated.
    expect(nightAt(at("2026-11-10T12:00:00+09:00"), "47893", { sunrise: "x", sunset: "12:00", date: "2026-11-10" })).toBe(false);
  });

  it("reads a report's night by version", () => {
    const r = makeReport("n", 20, 24, 0);
    const june = { ...r, station: "47893", at: new Date(at("2026-06-21T18:40:00+09:00")).toISOString(), snapshot: { ...r.snapshot!, date: "2026-06-21", hour: 18 } };
    expect(reportNight(june, "comfort-4")).toBe(true);
    expect(reportNight(june, "comfort-5")).toBe(false);
  });
});

describe("the sky in daylight only", () => {
  const x = { sky: true, night: true } as Drivers;
  it("counts nothing at night (0, not missing), and as before by day", () => {
    expect(DRIVERS.sky.value(x)).toBe(0);
    expect(DRIVERS.sky.value({ ...x, sky: null })).toBe(0);
    expect(DRIVERS.sky.value({ ...x, night: false })).toBe(0.5);
    expect(DRIVERS.sky.value({ ...x, night: false, sky: false })).toBe(-0.5);
    expect(DRIVERS.sky.value({ ...x, night: null, sky: null })).toBeNull();
  });
  it("comfort-3/4 kept for comparisons: the sky counts at night", () => {
    expect(DRIVERS.sky.value({ ...x, skyAtNight: true })).toBe(0.5);
  });
});

describe("runs end 3 hours after their first report", () => {
  const H = 3_600_000;
  it("a person reporting every 1.5 hours all day is not one run", () => {
    const times = [0, 1.5, 3, 4.5, 6].map((h) => h * H);
    // comfort-4: one run of 5 → 1/3 each.
    expect(burstWeights(times, 2, 0.5, Infinity).map((w) => +w.toFixed(3))).toEqual([0.333, 0.333, 0.333, 0.333, 0.333]);
    // comfort-5: [0, 1.5] [3, 4.5] [6] → 2/3, 2/3, 1.
    expect(burstWeights(times).map((w) => +w.toFixed(3))).toEqual([0.667, 0.667, 0.667, 0.667, 1]);
  });
  it("leaves runs within 3 hours and lone reports as they were", () => {
    const times = [0, 0.2, 0.5, 10].map((h) => h * H);
    expect(burstWeights(times)).toEqual(burstWeights(times, 2, 0.5, Infinity));
  });
  it("observations weigh by version", () => {
    // 9:10, 10:40, 12:10, each read on its own hour (so every one may teach).
    const list = [9, 10.5, 12].map((h, i) => {
      const r = makeReport(`w${i}`, Math.floor(h), 24, 0);
      return { ...r, at: new Date(Date.parse(r.at) + (h % 1) * H).toISOString() };
    });
    const w = (v: "comfort-3" | "comfort-4" | "comfort-5") => observationsOf(list, 0.8, v).map((o) => +(o.w ?? 1).toFixed(3));
    expect(w("comfort-3")).toEqual([1, 1, 1]);
    expect(w("comfort-4")).toEqual([0.5, 0.5, 0.5]);
    expect(w("comfort-5")).toEqual([0.667, 0.667, 1]);
  });
});

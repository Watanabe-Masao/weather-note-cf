import { describe, expect, it } from "vitest";
import { DEFAULT_FEEL } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import { hourOfDay } from "../../src/data/sun";
import { axisRange, detailMetric, formatDetail, hourSeries, initialHour, offeredMetrics, signedDiff } from "../../src/dayDetail";

const hour = (n: number, temp: number | null, extra: Partial<WeatherRow> = {}): WeatherRow => ({
  date: "2026-11-10",
  n,
  type: "actual",
  provider: "JMA",
  temp,
  humidity: 60,
  wind: 2,
  raw: {},
  quality: {},
  ...extra,
});

describe("day detail", () => {
  it("gives 24 points, leaving missing hours empty", () => {
    const rows = [hour(1, 10), hour(2, 11), hour(14, 20, { type: "forecast" })];
    const s = hourSeries(rows, "temp", DEFAULT_FEEL);
    expect(s).toHaveLength(24);
    expect(s[0]).toEqual({ hour: 1, v: 10, forecast: false });
    expect(s[2].v).toBeNull();
    expect(s[13]).toEqual({ hour: 14, v: 20, forecast: true });
  });

  it("computes the feel value per hour, and none without humidity or wind", () => {
    const s = hourSeries([hour(12, 20), hour(13, 20, { humidity: null })], "feel", { ...DEFAULT_FEEL, sun: false });
    expect(s[11].v).not.toBeNull();
    expect(s[11].v).not.toBe(20);
    expect(s[12].v).toBeNull();
  });

  it("shows radiation in MJ/㎡ from either source", () => {
    const s = hourSeries([hour(12, 20, { radiation: 2.17 }), hour(13, 20, { type: "forecast", solar: 500 })], "radiation", DEFAULT_FEEL);
    expect(s[11].v).toBe(2.17);
    expect(s[12].v).toBe(1.8);
    expect(formatDetail(1.8, detailMetric("radiation"))).toBe("1.80");
  });

  it("offers snow and rain chance only when one of the days has them", () => {
    const plain = [hour(12, 10)];
    const ids = (a: WeatherRow[], b: WeatherRow[]) => offeredMetrics(a, b, DEFAULT_FEEL).map((m) => m.id);
    expect(ids(plain, plain)).not.toContain("snow");
    expect(ids(plain, plain)).not.toContain("probability");
    expect(ids(plain, [hour(3, -1, { snow: 2 })])).toContain("snow");
    expect(ids([hour(12, 10, { type: "forecast", probability: 40 })], plain)).toContain("probability");
  });

  it("points first at the current hour today, otherwise at the warmest hour", () => {
    const s = hourSeries([hour(9, 15), hour(15, 22), hour(18, 18)], "temp", DEFAULT_FEEL);
    expect(initialHour(s, true, 10)).toBe(10);
    expect(initialHour(s, true, 0)).toBe(1);
    expect(initialHour(s, false, 10)).toBe(15);
    expect(initialHour(hourSeries([], "temp", DEFAULT_FEEL), false, 10)).toBe(14);
  });

  it("keeps amounts on a zero floor and sunshine within one hour", () => {
    expect(axisRange([0, 2], detailMetric("rain")).lo).toBe(0);
    const sun = axisRange([0, 0.4], detailMetric("sun"));
    expect(sun).toEqual({ lo: 0, hi: 1 });
    const t = axisRange([10, 20], detailMetric("temp"));
    expect(t.lo).toBeLessThan(10);
    expect(t.hi).toBeGreaterThan(20);
  });

  it("formats values and differences", () => {
    expect(formatDetail(0.5, detailMetric("sun"))).toBe("30分");
    expect(formatDetail(62.4, detailMetric("humidity"))).toBe("62");
    expect(formatDetail(null, detailMetric("temp"))).toBe("—");
    expect(signedDiff(20, 18.8)).toBe("+1.2");
    expect(signedDiff(18, 18.04)).toBe("±0");
    expect(signedDiff(10, 12.5)).toBe("−2.5");
    expect(signedDiff(10, null)).toBe("");
    expect(hourOfDay("2026-11-10T06:45")).toBe(6.75);
  });
});

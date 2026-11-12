import { describe, expect, it } from "vitest";
import { chartMetricById, hourlyExtreme, tableSeries } from "../../src/chartMetrics";
import type { WeatherRow } from "../../shared/types";
import { knownMetric } from "../../src/metrics";

describe("items", () => {
  it("maps items that were folded into others", () => {
    expect(knownMetric("snow")).toBe("rain");
    expect(knownMetric("probability")).toBe("rain");
    expect(knownMetric("mean")).toBe("temp");
    expect(knownMetric("range")).toBe("temp");
    expect(knownMetric("sun")).toBe("light"); // 日照 and 明るさ are their own item (日照時間と明るさ)
    expect(knownMetric("brightness")).toBe("light");
    expect(knownMetric("light")).toBe("light");
    expect(knownMetric("radiation")).toBe("radiation");
    expect(knownMetric("gust")).toBe("wind");
    expect(knownMetric("wind")).toBe("wind");
    expect(knownMetric(undefined)).toBe("temp");
  });

  it("gives the comparison side no forecast-only rows", () => {
    const rain = chartMetricById("rain");
    expect(tableSeries(rain).map((s) => s.key)).toEqual(["rain", "snow", "probability"]);
    expect(tableSeries(rain, true).map((s) => s.key)).toEqual(["rain", "snow"]);
    expect(tableSeries(chartMetricById("radiation")).map((s) => s.key)).toEqual(["radiation"]); // 日差し: the radiation only
    expect(tableSeries(chartMetricById("light")).map((s) => s.key)).toEqual(["sun", "brightHours"]); // 日照時間と明るさ
    expect(tableSeries(chartMetricById("wind")).map((s) => s.key)).toEqual(["wind", "gust"]);
    expect(tableSeries(chartMetricById("temp")).map((s) => s.key)).toEqual(["max", "min", "temp", "range"]);
  });
});

describe("hourly extremes (daily pressure range)", () => {
  const hour = (n: number, pressure: number | null) =>
    ({ date: "2026-11-10", n, type: "actual", provider: "JMA", pressure, raw: {}, quality: {} }) as WeatherRow;

  it("gives the day's highest and lowest hourly value", () => {
    const hours = Array.from({ length: 24 }, (_, i) => hour(i + 1, 1010 + Math.sin(i / 4) * 6));
    expect(hourlyExtreme(hours, "pressure", "max")).toBeCloseTo(1016, 0);
    expect(hourlyExtreme(hours, "pressure", "min")).toBeCloseTo(1004, 0);
  });

  it("waits for enough hours rather than show a partial day", () => {
    expect(hourlyExtreme(Array.from({ length: 12 }, (_, i) => hour(i + 1, 1010)), "pressure", "max")).toBeNull();
    expect(hourlyExtreme(null, "pressure", "min")).toBeNull();
  });

  it("puts the pressure range in the table (mean as a small row)", () => {
    expect(tableSeries(chartMetricById("pressure")).map((s) => s.key)).toEqual(["pressureMax", "pressureMin", "pressure"]);
  });
});

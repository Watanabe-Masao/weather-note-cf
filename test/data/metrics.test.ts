import { describe, expect, it } from "vitest";
import { chartMetricById, tableSeries } from "../../src/chartMetrics";
import { knownMetric } from "../../src/metrics";

describe("items", () => {
  it("maps items that were folded into others", () => {
    expect(knownMetric("snow")).toBe("rain");
    expect(knownMetric("probability")).toBe("rain");
    expect(knownMetric("mean")).toBe("temp");
    expect(knownMetric("range")).toBe("temp");
    expect(knownMetric("wind")).toBe("wind");
    expect(knownMetric(undefined)).toBe("temp");
  });

  it("gives the comparison side no forecast-only rows", () => {
    const rain = chartMetricById("rain");
    expect(tableSeries(rain).map((s) => s.key)).toEqual(["rain", "snow", "probability"]);
    expect(tableSeries(rain, true).map((s) => s.key)).toEqual(["rain", "snow"]);
    expect(tableSeries(chartMetricById("temp")).map((s) => s.key)).toEqual(["max", "min", "temp", "range"]);
  });
});

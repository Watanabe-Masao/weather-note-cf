import { describe, expect, it } from "vitest";
import type { Band } from "../../shared/feel";
import { trendSeries } from "../../src/ui/BandTrend";

const band = (feel: number | null, source: Band["source"] = "actual"): Band => ({
  label: "朝",
  feel,
  temp: null,
  level: null,
  source,
  sunCounted: false,
});

describe("band trend", () => {
  it("takes one band from each day, leaves gaps open and marks forecast points", () => {
    const days = [[band(10)], null, [band(null)], [band(14, "forecast")], [band(15, "mixed")]];
    expect(trendSeries(days, 0)).toEqual([
      { value: 10, forecast: false },
      { value: null, forecast: false },
      { value: null, forecast: false },
      { value: 14, forecast: true },
      { value: 15, forecast: true },
    ]);
  });
});

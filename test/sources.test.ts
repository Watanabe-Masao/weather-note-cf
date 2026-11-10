import { describe, expect, it } from "vitest";
import { aggregateRecentDay, parseLivePoint, type PointData } from "../worker/src/amedas";
import { normalizeForecast } from "../worker/src/open-meteo";
import { fixtureJson as json } from "./fixture";


describe("Open-Meteo forecast", () => {
  const { rows, hourlyRows } = normalizeForecast(json("forecast.json"));

  it("gives one daily row per forecast day with JMA field names", () => {
    expect(rows.map((r) => r.date)).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    for (const r of rows) {
      expect(r.type).toBe("forecast");
      expect(typeof r.max).toBe("number");
      expect(typeof r.dayWeather).toBe("string");
    }
  });

  it("numbers hours 1-24 like JMA, with 00:00 as hour 24 of the day before", () => {
    expect(hourlyRows.every((h) => h.n >= 1 && h.n <= 24)).toBe(true);
    const first = hourlyRows[0];
    expect(first).toMatchObject({ date: "2026-11-07", n: 24 });
    const nov9 = hourlyRows.filter((h) => h.date === "2026-11-09");
    expect(nov9.map((h) => h.n)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });
});

describe("AMeDAS observations", () => {
  const evening = json<PointData>("current-observations.json");
  const midnight = json<PointData>("midnight-observations.json");

  it("keeps the latest 10-minute observation and on-the-hour rows", () => {
    const { rows, latest } = parseLivePoint(evening, "2026-11-08");
    expect(latest?.observedAt).toBe("23:40");
    expect(rows.map((r) => r.n)).toEqual([21, 22, 23]);
  });

  it("uses the 24:00 closing record for max, min and rain when it is available", () => {
    const { daily, hourly } = aggregateRecentDay({ ...evening, ...midnight }, "2026-11-08");
    expect(hourly.at(-1)).toMatchObject({ n: 24, observedAt: "24:00" });
    expect(daily.quality.max).toBe("normal");
    expect(daily.provisional).toBe(true);
    expect(daily.dayWeather).toBeNull();
  });

  it("marks values from a partial day as partial", () => {
    const { daily } = aggregateRecentDay(evening, "2026-11-08");
    expect(daily.quality.temp).toBe("partial");
  });
});

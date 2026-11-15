// 材料の層 (docs/engineering-principles.md 2–4): the record and the forecast in one shape, no value
// filled in, and every material present in both sources.

import { describe, expect, it } from "vitest";
import type { WeatherRow } from "../../shared/types";
import { admits, DAY_FIELDS, dayOf, HOUR_FIELDS, hourOf } from "../../src/core";
import { aggregateRecentDay, parseLivePoint, type PointData } from "../../worker/src/amedas";
import { parseTable } from "../../worker/src/jma-tables";
import { normalizeForecast } from "../../worker/src/open-meteo";
import { fixture } from "../fixture";

const jmaDaily = (): WeatherRow[] =>
  parseTable(fixture("daily.html")).map((r) => ({ ...r, date: `2025-11-${String(r.n).padStart(2, "0")}`, type: "actual", provider: "JMA" }));
const jmaHourly = (): WeatherRow[] => parseTable(fixture("hourly.html"), true).map((r) => ({ ...r, date: "2025-11-01", type: "actual", provider: "JMA" }));
const forecast = () => normalizeForecast(JSON.parse(fixture("forecast.json")));
const live = () => JSON.parse(fixture("current-observations.json")) as PointData;

describe("every material is in both the record and the forecast (principles 3)", () => {
  const sources: [string, WeatherRow[], readonly { wire: string }[]][] = [
    ["JMA 毎時", jmaHourly(), HOUR_FIELDS],
    ["Open-Meteo 毎時", forecast().hourlyRows, HOUR_FIELDS],
    ["アメダス 毎時", parseLivePoint(live(), "2026-11-08").rows, HOUR_FIELDS],
    ["JMA 日", jmaDaily(), DAY_FIELDS],
    ["Open-Meteo 日", forecast().rows, DAY_FIELDS],
  ];
  for (const [name, rows, fields] of sources)
    it(name, () => {
      expect(rows.length).toBeGreaterThan(0);
      for (const f of fields) expect(Object.keys(rows[0]), `${name} に ${f.wire} がない`).toContain(f.wire);
    });
});

describe("quality marks decide what goes in (principles 4)", () => {
  it("normal and 現象なし go in, 準正常値 goes in as rough, the rest stays out", () => {
    expect(admits("normal")).toBe("yes");
    expect(admits("none")).toBe("yes");
    expect(admits("partial")).toBe("rough");
    expect(admits("insufficient")).toBe("no");
    expect(admits("missing")).toBe("no");
    expect(admits(undefined)).toBe("no");
  });

  const row = (over: Partial<WeatherRow>): WeatherRow => ({
    date: "2025-11-01",
    n: 13,
    type: "actual",
    provider: "JMA",
    raw: {},
    quality: { temp: "normal", humidity: "partial", wind: "insufficient", rain: "none", sun: "missing" },
    temp: 18.2,
    humidity: 60,
    wind: 3.1,
    rain: 0,
    sun: null,
    ...over,
  });

  it("an hour: 資料不足値 and a blank become null, never a stand-in", () => {
    const h = hourOf(row({}), "47893")!;
    expect(h.values).toEqual({ temp: 18.2, humidity: 60, wind: null, rain: 0, sunshine: null, pressure: null });
    expect(h.rough).toEqual(["humidity"]);
    expect(h).toMatchObject({ station: "47893", date: "2025-11-01", hour: 13, kind: "record", provider: "JMA", provisional: false });
  });

  it("a number with no quality mark is not taken", () => {
    expect(hourOf(row({ quality: {} }), "47893")!.values.temp).toBeNull();
  });

  it("an hour outside 1–24 is not an hour", () => {
    expect(hourOf(row({ n: 0 }), "47893")).toBeNull();
    expect(hourOf(row({ n: 25 }), "47893")).toBeNull();
  });
});

describe("the same shape from every source", () => {
  it("JMA hours", () => {
    const hours = jmaHourly().map((r) => hourOf(r, "47893")!);
    expect(hours).toHaveLength(24);
    expect(hours.every((h) => h.kind === "record" && !h.provisional)).toBe(true);
    expect(hours.some((h) => h.values.temp != null)).toBe(true);
  });

  it("forecast hours and days are forecasts, sunshine in hours", () => {
    const { rows, hourlyRows } = forecast();
    const hours = hourlyRows.map((r) => hourOf(r, "47893")!);
    expect(hours.every((h) => h.kind === "forecast" && h.provider === "Open-Meteo")).toBe(true);
    expect(hours.every((h) => h.values.sunshine == null || (h.values.sunshine >= 0 && h.values.sunshine <= 1))).toBe(true);
    expect(dayOf(rows[0], "47893").kind).toBe("forecast");
  });

  it("AMeDAS hours are provisional records", () => {
    const hours = parseLivePoint(live(), "2026-11-08").rows.map((r) => hourOf(r, "47893")!);
    expect(hours.length).toBeGreaterThan(0);
    expect(hours.every((h) => h.kind === "record" && h.provisional && h.provider === "JMA-amedas")).toBe(true);
  });

  it("a day built from too few observations keeps its values as rough", () => {
    const { daily } = aggregateRecentDay(live(), "2026-11-08");
    const d = dayOf(daily, "47893");
    expect(d.provisional).toBe(true);
    for (const f of d.rough) expect(d.values[f]).not.toBeNull();
    // JMA-recent has no 最大瞬間風速: it is missing, not 0.
    expect(d.values.gust).toBeNull();
  });
});

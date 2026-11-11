import { describe, expect, it } from "vitest";
import { jstHourOf, jstIso, type Report, snapshotOf, toCsv } from "../../src/beta/reports";
import { DEFAULT_FEEL } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";

const hour = (n: number, over: Partial<WeatherRow> = {}): WeatherRow => ({
  date: "2026-11-11",
  n,
  type: "actual",
  provider: "JMA-amedas",
  raw: {},
  quality: {},
  temp: 15 + n / 10,
  humidity: 60,
  wind: 2,
  from: "amedas",
  ...over,
});

describe("β②: what a report records", () => {
  it("takes the latest hour with a temperature, with each value's source", () => {
    const rows = [hour(19), hour(20, { solar: 0, origin: { solar: "forecast" } }), hour(21, { type: "forecast", from: "forecast" })];
    const s = snapshotOf(rows, 20, DEFAULT_FEEL)!;
    expect(s.hour).toBe(20);
    expect(s.from).toEqual({ temp: "amedas", humidity: "amedas", wind: "amedas", solar: "forecast" });
    expect(s.sunTemp).not.toBeNull();
    expect(s.shadeTemp).not.toBeNull();
  });

  it("is null without hours (never invents the weather)", () => {
    expect(snapshotOf([], 12, DEFAULT_FEEL)).toBeNull();
    expect(snapshotOf([hour(15)], 12, DEFAULT_FEEL)).toBeNull(); // nothing at or before 12時
  });

  it("knows the hour in Japan (24 for midnight, as JMA counts)", () => {
    expect(jstHourOf(Date.parse("2026-11-11T11:30:00Z"))).toBe(20);
    expect(jstHourOf(Date.parse("2026-11-11T15:10:00Z"))).toBe(24);
    expect(jstIso("2026-11-11T11:30:05.000Z")).toBe("2026-11-11T20:30:05+09:00");
  });
});

describe("β②: CSV", () => {
  const base: Report = {
    id: "a",
    at: "2026-11-11T11:30:00.000Z",
    station: "47893",
    sensation: -1,
    exposure: "shade",
    windFelt: "strong",
    snapshot: null,
    baseline: { value: 17.3, forecastMixed: false, coverage: 1, alpha: 0.8 },
    departures: { air: -2.4, sun: null, shade: -4 },
    updatedAt: 1,
  };
  it("writes one row per live report, oldest first, readable by Excel", () => {
    const csv = toCsv([{ ...base, id: "b", at: "2026-11-12T00:00:00.000Z" }, base, { ...base, id: "c", deleted: true }]);
    expect(csv.startsWith("﻿at_jst,station,sensation")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("2026-11-11T20:30:00+09:00,47893,-1,やや寒い,shade,strong");
    expect(lines[1]).toContain("17.3,0.8,0,-2.4,,-4,a");
    expect(lines[2].endsWith(",b")).toBe(true);
  });
});

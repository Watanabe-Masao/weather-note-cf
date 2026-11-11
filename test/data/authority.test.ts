import { describe, expect, it } from "vitest";
import { completeness, decideDay, decideHours, fillFrom, verdict } from "../../src/data/authority";
import type { DayRecord, HourRecord } from "../../src/data/db";
import type { WeatherRow } from "../../shared/types";

const row = (over: Partial<WeatherRow> = {}): WeatherRow => ({
  date: "2026-11-01",
  n: 1,
  type: "actual",
  provider: "JMA",
  raw: {},
  quality: {},
  max: 20,
  min: 10,
  sun: 5,
  ...over,
});
const day = (r: WeatherRow | null, over: Partial<DayRecord> = {}): DayRecord => ({
  key: "47893/2026-11-01",
  station: "47893",
  date: "2026-11-01",
  row: r,
  kind: "variable",
  source: "jma",
  savedAt: 0,
  fetchedAt: 100,
  ...over,
});

describe("正本管理: whose copy of a day is kept", () => {
  it("ranks JMA fixed > JMA provisional > AMeDAS > forecast", () => {
    const fc = day(row({ type: "forecast", max: 30 }), { source: "forecast" });
    const amedas = day(row({ max: 22 }), { source: "recent" });
    const jma = day(row({ max: 21 }));
    expect(decideDay(fc, amedas).row?.max).toBe(22);
    expect(decideDay(amedas, jma).row?.max).toBe(21);
    expect(decideDay(jma, amedas).row?.max).toBe(21); // AMeDAS never replaces JMA
    expect(decideDay(jma, fc).row?.max).toBe(21);
  });

  it("fills a gap from a lower source field by field and keeps where each came from", () => {
    const jma = day(row({ sun: null, unpublished: ["sun"] }));
    const amedas = day(row({ max: 99, sun: 6.2 }), { source: "recent" });
    const kept = decideDay(jma, amedas);
    expect(kept.row).toMatchObject({ max: 20, sun: 6.2, origin: { sun: "amedas" } });
    // When JMA later publishes the value, its own value replaces the filled one.
    const published = decideDay(kept, day(row({ sun: 5.9 }), { fetchedAt: 200 }));
    expect(published.row?.sun).toBe(5.9);
    expect(published.row?.origin).toBeUndefined();
  });

  it("never lets the answer to an older request replace a newer copy", () => {
    const newer = day(row({ max: 21 }), { fetchedAt: 200 });
    const older = day(row({ max: 18 }), { fetchedAt: 100 });
    expect(decideDay(newer, older).row?.max).toBe(21);
  });

  it("never lets a half-empty page replace a complete copy, fixed or not", () => {
    const full = day(row(), { kind: "fixed" });
    const broken = day(row({ max: null, min: null }), { fetchedAt: 200 });
    expect(decideDay(full, broken)).toBe(full);
    expect(decideDay(day(row()), day(row({ max: null }), { fetchedAt: 200 })).row?.max).toBe(20);
  });

  it("applies an official correction: same source, newer, complete — even over fixed data", () => {
    const fixed = day(row({ max: 20 }), { kind: "fixed" });
    const corrected = day(row({ max: 19.4 }), { kind: "fixed", fetchedAt: 200 });
    expect(decideDay(fixed, corrected).row?.max).toBe(19.4);
  });

  it("applies a correction listed in the ledger even when it withdraws a value", () => {
    const fixed = day(row({ max: 20 }), { kind: "fixed" });
    const withdrawn = day(row({ max: null }), { kind: "variable", fetchedAt: 200, rev: 1 });
    expect(decideDay(fixed, withdrawn).row?.max).toBeNull();
  });

  it("keeps a row when a source answers with no row", () => {
    const held = day(row());
    expect(decideDay(held, day(null, { fetchedAt: 200 }))).toBe(held);
  });

  it("does not let a forecast stand in for a missing measured value", () => {
    const measured = row({ max: null, unpublished: ["max"] });
    const forecast = row({ type: "forecast", max: 24, solar: 300 });
    const out = fillFrom(measured, "jma", forecast, "forecast");
    expect(out.max).toBeNull();
    expect(out.solar).toBe(300); // radiation, which the measuring source does not have at all
  });

  it("counts filled values as present", () => {
    expect(completeness(row({ sun: 5, unpublished: ["sun"], origin: { sun: "amedas" } }))).toBe(completeness(row()));
  });

  it("verdict: higher wins, then newer and no less complete", () => {
    const a = { origin: "jma" as const, row: row(), fetched: 100 };
    expect(verdict(a, { ...a, origin: "jma-fixed" })).toBe("replace");
    expect(verdict(a, { ...a, origin: "amedas", fetched: 999 })).toBe("keep");
    expect(verdict(a, { ...a, fetched: 50 })).toBe("keep");
  });
});

describe("正本管理: hours", () => {
  const hours = (rows: WeatherRow[], over: Partial<HourRecord> = {}): HourRecord => ({
    key: "47893/2026-11-10",
    station: "47893",
    date: "2026-11-10",
    rows,
    kind: "variable",
    source: "forecast",
    savedAt: 0,
    fetchedAt: 100,
    ...over,
  });
  const h = (n: number, over: Partial<WeatherRow> = {}) => row({ date: "2026-11-10", n, temp: 10 + n, ...over });

  it("observed hours win over forecast hours, either order, and borrow only the radiation", () => {
    const forecast = hours([h(1, { type: "forecast", solar: 0 }), h(2, { type: "forecast", solar: 120, temp: 30 })]);
    const observed = hours([h(1, { temp: 9 })], { source: "current", fetchedAt: 50 });
    for (const merged of [decideHours(forecast, observed), decideHours(observed, forecast)]) {
      expect(merged.rows.map((r) => [r.n, r.type, r.temp])).toEqual([
        [1, "actual", 9],
        [2, "forecast", 30],
      ]);
      expect(merged.rows[0]).toMatchObject({ solar: 0, origin: { solar: "forecast" } });
      expect(merged.source).toBe("current");
    }
  });

  it("a fixed day is replaced only by a newer complete fixed copy", () => {
    const fixed = hours([h(1), h(2)], { source: "jma", kind: "fixed" });
    expect(decideHours(fixed, hours([h(1)], { source: "jma", kind: "fixed", fetchedAt: 200 }))).toBe(fixed);
    expect(decideHours(fixed, hours([h(1), h(2)], { source: "jma", kind: "variable", fetchedAt: 200 }))).toBe(fixed);
    const corrected = hours([h(1, { temp: 3 }), h(2)], { source: "jma", kind: "fixed", fetchedAt: 200 });
    expect(decideHours(fixed, corrected).rows[0].temp).toBe(3);
  });
});

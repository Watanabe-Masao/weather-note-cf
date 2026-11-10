import { describe, expect, it } from "vitest";
import { isFixedDay, isFixedHourlyDay, isFixedMonth } from "../shared/fixed";
import type { WeatherRow } from "../shared/types";
import { parseTable } from "../worker/src/jma-tables";
import { fixture } from "./fixture";

const TODAY = "2026-11-10";

// daily.html is Kochi, November 2025.
const dailyRows = (): WeatherRow[] =>
  parseTable(fixture("daily.html")).map((r) => ({
    ...r,
    date: `2025-11-${String(r.n).padStart(2, "0")}`,
    type: "actual",
    provider: "JMA",
  }));

describe("daily table", () => {
  it("reads every day of the month with numbers and the daytime summary", () => {
    const rows = dailyRows();
    expect(rows).toHaveLength(30);
    for (const r of rows) {
      expect(typeof r.max).toBe("number");
      expect(typeof r.min).toBe("number");
      expect(r.max as number).toBeGreaterThan(r.min as number);
      expect(typeof r.dayWeather).toBe("string");
    }
  });

  it("treats a complete past month as fixed", () => {
    const rows = dailyRows();
    expect(rows.every((r) => r.unpublished?.length === 0)).toBe(true);
    expect(isFixedMonth("2025-11", rows, TODAY)).toBe(true);
  });

  it("does not fix recent days, days without the summary, or unpublished columns", () => {
    const [row] = dailyRows();
    expect(isFixedDay({ ...row, date: "2026-11-08" }, TODAY)).toBe(false);
    expect(isFixedDay({ ...row, date: "2026-11-07" }, TODAY)).toBe(true);
    expect(isFixedDay({ ...row, dayWeather: null }, TODAY)).toBe(false);
    expect(isFixedDay({ ...row, unpublished: ["sun"] }, TODAY)).toBe(false);
    expect(isFixedDay({ ...row, provisional: true }, TODAY)).toBe(false);
  });

  it("is incomplete while a single day is missing", () => {
    const rows = dailyRows().slice(1);
    expect(isFixedMonth("2025-11", rows, TODAY)).toBe(false);
  });
});

describe("hourly table", () => {
  const rows = (): WeatherRow[] =>
    parseTable(fixture("hourly.html"), true).map((r) => ({ ...r, date: "2025-11-01", type: "actual", provider: "JMA" }));

  it("reads 24 hours of temperature", () => {
    const hours = rows();
    expect(hours.map((h) => h.n)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(hours.every((h) => typeof h.temp === "number")).toBe(true);
  });

  it("fixes a complete old day even though sunshine is blank at night", () => {
    expect(isFixedHourlyDay("2025-11-01", rows(), TODAY)).toBe(true);
    expect(isFixedHourlyDay("2026-11-09", rows(), TODAY)).toBe(false);
    expect(isFixedHourlyDay("2025-11-01", rows().slice(0, 23), TODAY)).toBe(false);
  });

  it("rejects a page without the data table", () => {
    expect(() => parseTable("<html></html>")).toThrow(/表を読み取れません/);
  });
});

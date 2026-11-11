import { describe, expect, it } from "vitest";
import { correctionRev } from "../../shared/corrections";
import { inRevalidation, isFixedHourlyDay, isFixedMonth } from "../../shared/fixed";
import type { WeatherRow } from "../../shared/types";
import { dailyRow } from "./fake-api";

const TODAY = "2026-11-10";
const hour = (n: number, date = "2026-10-01"): WeatherRow => ({ date, n, type: "actual", provider: "JMA", raw: {}, quality: {}, temp: 10 });
const day24 = () => Array.from({ length: 24 }, (_, i) => hour(i + 1));

describe("fixed means every value is there, checked by content", () => {
  it("accepts hours 1–24 once each", () => {
    expect(isFixedHourlyDay("2026-10-01", day24(), TODAY)).toBe(true);
  });

  it("rejects 24 rows that hide a gap behind a duplicate, a stray day or a bad hour", () => {
    const dup = day24();
    dup[5] = hour(5); // hour 6 missing, hour 5 twice
    expect(isFixedHourlyDay("2026-10-01", dup, TODAY)).toBe(false);
    const stray = day24();
    stray[0] = hour(1, "2026-10-02");
    expect(isFixedHourlyDay("2026-10-01", stray, TODAY)).toBe(false);
    const zero = day24();
    zero[23] = hour(0);
    expect(isFixedHourlyDay("2026-10-01", zero, TODAY)).toBe(false);
  });

  it("rejects a month with a duplicate or stray day", () => {
    const rows = Array.from({ length: 30 }, (_, i) => dailyRow(`2026-09-${String(i + 1).padStart(2, "0")}`));
    expect(isFixedMonth("2026-09", rows, TODAY)).toBe(true);
    expect(isFixedMonth("2026-09", [...rows, dailyRow("2026-09-03")], TODAY)).toBe(false);
    expect(isFixedMonth("2026-09", [...rows.slice(1), dailyRow("2026-10-01")], TODAY)).toBe(false);
  });

  it("keeps re-checking fixed data for 30 days after its day", () => {
    expect(inRevalidation("2026-10-11", TODAY)).toBe(true); // day 30
    expect(inRevalidation("2026-10-10", TODAY)).toBe(false); // day 31
    expect(inRevalidation("2026-10-31", TODAY)).toBe(true); // a month ended 10 days ago
  });
});

describe("corrections ledger", () => {
  const ledger = [
    { id: 1, from: "2025-06-10", to: "2025-06-12", note: "all stations" },
    { id: 2, from: "2025-06-01", to: "2025-06-30", stations: ["47891"], note: "one station" },
  ];
  it("gives the latest revision touching a station and period, else 0", () => {
    expect(correctionRev("47893", "2025-06-01", "2025-06-30", ledger)).toBe(1);
    expect(correctionRev("47891", "2025-06-11", "2025-06-11", ledger)).toBe(2);
    expect(correctionRev("47893", "2025-06-13", "2025-06-30", ledger)).toBe(0);
    expect(correctionRev("47893", "2025-07-01", "2025-07-31", ledger)).toBe(0);
  });
});

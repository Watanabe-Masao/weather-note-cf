import { describe, expect, it } from "vitest";
import { departures, historyDays, HISTORY_DAYS, runningMean } from "../../src/beta/adaptation";
import { DEFAULT_FEEL } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";

const days = (means: (number | null)[], forecast = false) => means.map((mean) => ({ mean, forecast }));

describe("β: 最近の基準 (running mean of past daily means)", () => {
  it("is the mean itself when every past day is the same", () => {
    expect(runningMean(days(Array(HISTORY_DAYS).fill(15)), 0.8)?.value).toBe(15);
  });

  it("weighs yesterday most: (1 − α) for d−1, then α times less each day back (EN 16798-1)", () => {
    const past = days([25, ...Array(HISTORY_DAYS - 1).fill(15)]);
    const b = runningMean(past, 0.8)!;
    // 15 + 10 × 0.2 / (1 − 0.8^30), nearly 17
    expect(b.value).toBeCloseTo(17, 0);
    expect(runningMean(past, 0.7)!.value).toBeGreaterThan(b.value); // faster: follows yesterday more
  });

  it("says 履歴不足 (null) instead of guessing when yesterday or too much is missing", () => {
    expect(runningMean(days([null, ...Array(HISTORY_DAYS - 1).fill(15)]), 0.8)).toBeNull();
    const gappy = days([15, 15, null, null, null, null, null, null, null, null, 15, 15]);
    expect(runningMean(gappy.concat(days(Array(HISTORY_DAYS - gappy.length).fill(15))), 0.8)).toBeNull();
    const fewGaps = days([15, 15, 15, 15, 15, 15, 15, 15, null, null, ...Array(HISTORY_DAYS - 10).fill(15)]);
    expect(runningMean(fewGaps, 0.8)?.value).toBe(15);
  });

  it("marks a baseline that includes forecast days", () => {
    expect(runningMean(days(Array(HISTORY_DAYS).fill(15), true), 0.8)?.forecastMixed).toBe(true);
  });

  it("reads the 30 days before the day, newest first", () => {
    expect(historyDays("2026-11-10").slice(0, 2)).toEqual(["2026-11-09", "2026-11-08"]);
    expect(historyDays("2026-11-10")).toHaveLength(HISTORY_DAYS);
  });
});

describe("β: differences from the baseline, in the sun and in the shade", () => {
  const hour = (n: number): WeatherRow => ({
    date: "2026-11-10",
    n,
    type: "actual",
    provider: "JMA",
    raw: {},
    quality: {},
    temp: 20,
    humidity: 60,
    wind: 2,
    solar: n >= 9 && n <= 17 ? 500 : 0,
  });
  const hours = Array.from({ length: 24 }, (_, i) => hour(i + 1));
  const baseline = { value: 16, forecastMixed: false, coverage: 1 };

  it("gives the air, sun and shade differences, the sun warmer than the shade", () => {
    const d = departures({ ...hours[0], temp: 19 }, hours, baseline, DEFAULT_FEEL)!;
    expect(d.air).toBe(3);
    expect(d.sun).not.toBeNull();
    expect(d.shade).not.toBeNull();
    expect(d.sun!).toBeGreaterThan(d.shade!);
  });

  it("gives nothing without a baseline, and no feel differences without hours", () => {
    expect(departures(hours[0], hours, null, DEFAULT_FEEL)).toBeNull();
    const d = departures({ ...hours[0], temp: 19 }, [], baseline, DEFAULT_FEEL)!;
    expect([d.sun, d.shade]).toEqual([null, null]);
  });
});

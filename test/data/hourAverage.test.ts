import { describe, expect, it } from "vitest";
import type { HourPoint } from "../../src/dayDetail";
import { daysBefore, meanByHour, nextWindow } from "../../src/hourAverage";

const day = (f: (h: number) => number | null): HourPoint[] => Array.from({ length: 24 }, (_, i) => ({ hour: i + 1, v: f(i + 1), forecast: false }));

describe("手前の平均", () => {
  it("takes the days before the day, not the day itself, and none from today on", () => {
    expect(daysBefore("2024-11-03", 7, "2026-11-13")).toEqual([
      "2024-11-02", "2024-11-01", "2024-10-31", "2024-10-30", "2024-10-29", "2024-10-28", "2024-10-27",
    ]);
    // A comparison day a week ahead: only the days up to yesterday.
    expect(daysBefore("2026-11-20", 7, "2026-11-13")).toEqual([]);
    expect(daysBefore("2026-11-20", 14, "2026-11-13")).toEqual(["2026-11-12", "2026-11-11", "2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06"]);
    expect(daysBefore("2026-11-13", 7, "2026-11-13")).toHaveLength(7);
  });

  it("averages each hour, and leaves an hour empty when fewer than half the days have it", () => {
    const m = meanByHour([day((h) => h), day((h) => h + 2), day((h) => (h === 5 ? null : h + 4))], 3);
    expect(m[0].v).toBe(3); // (1 + 3 + 5) / 3
    expect(m[4].v).toBe(6); // hour 5: (5 + 7) / 2, two of three days
    const sparse = meanByHour([day((h) => h), day(() => null), day(() => null), day(() => null)], 7);
    expect(sparse.every((p) => p.v == null)).toBe(true);
  });

  it("steps 1週 → 2週 → 1か月 → 1週", () => {
    expect([nextWindow(7), nextWindow(14), nextWindow(30)]).toEqual([14, 30, 7]);
  });
});

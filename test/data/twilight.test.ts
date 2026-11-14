import { describe, expect, it } from "vitest";
import { dayEdges, twilights } from "../../shared/dayParts";

const clock = (m: number | null) => (m == null ? null : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`);

describe("three twilights (#151)", () => {
  it("are nested around the day: 天文 < 航海 < 市民 < sunrise, and the reverse in the evening", () => {
    const t = twilights("2026-11-14", "47893");
    const e = dayEdges("2026-11-14", "47893");
    expect(t.astronomical.start!).toBeLessThan(t.nautical.start!);
    expect(t.nautical.start!).toBeLessThan(t.civil.start!);
    expect(t.civil.start!).toBeLessThan(e.rise);
    expect(t.civil.end!).toBeGreaterThan(e.set);
    expect(t.nautical.end!).toBeGreaterThan(t.civil.end!);
    expect(t.astronomical.end!).toBeGreaterThan(t.nautical.end!);
    // 市民薄明 is the app's dawn and dusk (6° below).
    expect(Math.abs(t.civil.start! - e.dawn)).toBeLessThan(1);
    // About half an hour apart in Kochi in November.
    expect(t.civil.start! - t.nautical.start!).toBeGreaterThan(25);
    expect(t.civil.start! - t.nautical.start!).toBeLessThan(35);
    expect(clock(t.civil.start)).toMatch(/^6:/);
  });
});

import { describe, expect, it } from "vitest";
import { dayEdges, twilights } from "../../shared/dayParts";
import { isNightAt, sunHours } from "../../src/data/sun";
import { hoursMinutes, phraseBreak } from "../../src/design/format";

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

describe("twilights where they do not happen, and the night rule (#151)", () => {
  it("in a white night (69°N, midsummer) the sun never sets: no crossings, null", () => {
    const t = twilights("2026-06-21", { lat: 69, lon: 18 });
    expect(t.civil.start).toBeNull();
    expect(t.astronomical.end).toBeNull();
  });
  it("in Wakkanai at midsummer all three still happen, in order", () => {
    const t = twilights("2026-06-21", { lat: 45.4, lon: 141.7 });
    expect(t.astronomical.start!).toBeLessThan(t.nautical.start!);
    expect(t.nautical.end!).toBeLessThan(t.astronomical.end!);
  });
  it("an hour is night by its middle: 6時 (5–6時) before a 6:20 sunrise, 7時 (6–7時) not", () => {
    const h = sunHours(null, { rise: 6 * 60 + 20, set: 17 * 60 + 12 });
    expect(isNightAt(6 - 0.5, h)).toBe(true);
    expect(isNightAt(7 - 0.5, h)).toBe(false);
    expect(isNightAt(18 - 0.5, h)).toBe(true);
    // The API's sunrise wins over the calculated one.
    expect(sunHours({ sunrise: "2026-11-10T06:40:00+09:00", sunset: null }, { rise: 391, set: 1032 }).rise).toBeCloseTo(6 + 40 / 60, 5);
  });
});

describe("words and lengths on the sun's faces (#151)", () => {
  it("never 9時間60分", () => {
    expect(hoursMinutes(599.6)).toBe("10時間00分");
    expect(hoursMinutes(641)).toBe("10時間41分");
  });
  it("breaks only before the last word", () => {
    expect(phraseBreak("日差しの明るさ")).toBe("日差しの​明るさ");
    expect(phraseBreak("日の出前後の空")).toBe("日の出前後の​空");
    expect(phraseBreak("とても明るい")).toBe("とても​明るい");
    expect(phraseBreak("まぶしい")).toBe("​まぶしい");
  });
});

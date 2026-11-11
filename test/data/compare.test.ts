import { describe, expect, it } from "vitest";
import { dayTone, holidayName, weekdayOf } from "../../shared/holidays";
import {
  centerIndex,
  matchDate,
  needsRewindow,
  offsetOf,
  scrollFor,
  stripWindow,
  targetBounds,
  weekSteps,
} from "../../src/compare";

describe("comparison dates", () => {
  it("same date last year, with no partner for 29 February", () => {
    expect(matchDate("2026-11-10", "sameDate")).toBe("2025-11-10");
    expect(matchDate("2028-02-29", "sameDate")).toBeNull();
  });

  it("nearest same weekday last year", () => {
    // 2026-11-10 is a Tuesday; 2025-11-10 is a Monday → 2025-11-11 (Tuesday)
    expect(matchDate("2026-11-10", "sameWeekday")).toBe("2025-11-11");
    expect(weekdayOf(matchDate("2026-11-14", "sameWeekday")!)).toBe(weekdayOf("2026-11-14"));
  });

  it("last week and a fixed custom offset", () => {
    expect(matchDate("2026-11-10", "lastWeek")).toBe("2026-11-03");
    expect(matchDate("2026-11-10", "nextWeek")).toBe("2026-11-17");
    expect(matchDate("2026-11-10", "yesterday")).toBe("2026-11-09");
    expect(matchDate("2026-03-01", "yesterday")).toBe("2026-02-28");
    expect(matchDate("2026-11-10", "custom", -400)).toBe("2025-10-06");
    expect(offsetOf("2026-11-10", "2025-10-06")).toBe(-400);
  });

  it("keeps the comparison day inside the loadable range", () => {
    expect(targetBounds("lastWeek", 0, "2026-11-17")).toEqual({ min: "1977-01-08", max: "2026-11-17" });
    // 翌週: the target can be at most a week before the last forecast day.
    expect(targetBounds("nextWeek", 0, "2026-11-17")).toEqual({ min: "1977-01-01", max: "2026-11-10" });
    expect(targetBounds("yesterday", 0, "2026-11-17")).toEqual({ min: "1977-01-02", max: "2026-11-17" });
    expect(targetBounds("custom", 5, "2026-11-17").max).toBe("2026-11-12");
    expect(targetBounds("sameDate", 0, "2026-11-17").min).toBe("1978-01-02");
  });
});

describe("holidays", () => {
  it("colours Sundays and national holidays red, Saturdays blue", () => {
    expect(dayTone("2026-11-08")).toBe("holiday"); // Sunday
    expect(dayTone("2026-11-03")).toBe("holiday"); // 文化の日 (Tuesday)
    expect(holidayName("2026-11-23")).toBe("勤労感謝の日");
    expect(dayTone("2026-11-07")).toBe("saturday");
    expect(dayTone("2026-11-10")).toBe("weekday");
  });
});

describe("drum strip", () => {
  it("renders a window around the centre and moves it near an edge", () => {
    const win = stripWindow("2025-06-15", "1977-01-01", "2026-11-17");
    expect(win).toEqual({ start: "2025-04-16", end: "2025-08-14" });
    expect(needsRewindow("2025-06-15", win, "1977-01-01", "2026-11-17")).toBe(false);
    expect(needsRewindow("2025-04-20", win, "1977-01-01", "2026-11-17")).toBe(true);
    // At the range end there is nothing more to load, so the window stays.
    const end = stripWindow("2026-11-17", "1977-01-01", "2026-11-17");
    expect(needsRewindow("2026-11-17", end, "1977-01-01", "2026-11-17")).toBe(false);
  });

  it("maps scroll positions to the centred column and back", () => {
    expect(centerIndex(scrollFor(12, 52), 52, 121)).toBe(12);
    expect(centerIndex(12 * 52 + 25, 52, 121)).toBe(12);
    expect(centerIndex(-30, 52, 121)).toBe(0);
    expect(centerIndex(999_999, 52, 121)).toBe(120);
  });
});

describe("long press on the arrows", () => {
  it("adds a week per 40px slid down (or towards the arrow) and cancels when slid back", () => {
    // Held still: one week.
    expect(weekSteps(0, 0, -1)).toBe(1);
    // Down (the main way, clear of the screen edge): weeks grow with the distance, either arrow.
    expect(weekSteps(0, 60, -1)).toBe(2);
    expect(weekSteps(0, 100, 1)).toBe(3);
    // Sideways in the arrow's direction still works.
    expect(weekSteps(-60, 0, -1)).toBe(2);
    expect(weekSteps(60, 0, 1)).toBe(2);
    // Back up, or the other way: cancel.
    expect(weekSteps(0, -30, 1)).toBe(0);
    expect(weekSteps(30, 0, -1)).toBe(0);
    expect(weekSteps(0, 99_999, 1)).toBe(52);
  });
});

import { intervalLabel } from "../../src/ui/CalendarModal";

describe("interval in words (calendar)", () => {
  it("names presets, counts days, and counts from the same date for years", () => {
    expect(intervalLabel("2026-11-10", "2026-11-09")).toBe("前日");
    expect(intervalLabel("2026-11-10", "2026-11-17")).toBe("翌週");
    expect(intervalLabel("2026-11-10", "2026-11-05")).toBe("5日前");
    expect(intervalLabel("2026-11-10", "2025-11-10")).toBe("前年同日");
    expect(intervalLabel("2026-11-10", "2025-11-04")).toBe("1年前の6日前");
    expect(intervalLabel("2026-11-10", "2024-11-10")).toBe("2年前の同じ日");
  });
});

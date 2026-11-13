import { describe, expect, it } from "vitest";
import {
  type Conditions,
  candidateDays,
  needsHours,
  rainPasses,
  sameDateBack,
  searchConditions,
  startConditions,
  tempPasses,
  tempScale,
  wetParts,
} from "../../shared/conditions";
import { weatherGroup } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";

const day = (date: string, max: number, min: number, rain = 0): WeatherRow => ({
  date,
  n: Number(date.slice(8)),
  type: "actual",
  provider: "JMA",
  max,
  min,
  rain,
  raw: {},
  quality: {},
});
const hours = (date: string, wet: Record<number, number>): WeatherRow[] =>
  Array.from({ length: 24 }, (_, i) => ({ date, n: i + 1, type: "actual", provider: "JMA", rain: wet[i + 1] ?? 0, raw: {}, quality: {} }));

const base: Conditions = {
  max: { mode: "range", lo: 20, hi: 23 },
  min: { mode: "any", lo: 0, hi: 0 },
  rain: { mode: "any", parts: ["morning", "day", "evening", "night"] },
  years: 3,
  span: 15,
  weekday: "any",
};

describe("conditions: temperatures", () => {
  it("reads 以上 from lo, 以下 from hi, 範囲 from both", () => {
    const c = { lo: 20, hi: 23 };
    expect(tempPasses({ ...c, mode: "ge" }, 30)).toBe(true);
    expect(tempPasses({ ...c, mode: "ge" }, 19.5)).toBe(false);
    expect(tempPasses({ ...c, mode: "le" }, 5)).toBe(true);
    expect(tempPasses({ ...c, mode: "le" }, 23.5)).toBe(false);
    expect(tempPasses({ ...c, mode: "range" }, 20)).toBe(true);
    expect(tempPasses({ ...c, mode: "range" }, 23.1)).toBe(false);
    expect(tempPasses({ ...c, mode: "any" }, -40)).toBe(true);
  });

  it("starts from the target's values ±1.5 ℃ on 0.5 steps, dry all day when it has no rain", () => {
    const c = startConditions(day("2026-11-13", 21.6, 15.9));
    expect(c.max).toEqual({ mode: "range", lo: 20, hi: 23 });
    expect(c.min).toEqual({ mode: "range", lo: 14.5, hi: 17.5 });
    expect(c.rain.mode).toBe("dry");
    expect(c.rain.parts).toHaveLength(4);
    expect(startConditions(day("2026-11-13", 21, 15, 3)).rain.mode).toBe("any");
    expect(startConditions(null).max.mode).toBe("any");
  });
});

describe("conditions: slider scale", () => {
  it("spans the target's value ±10 ℃ out to the next 5 ℃", () => {
    expect(tempScale(21.6, { mode: "range", lo: 20, hi: 23 })).toEqual({ lo: 10, hi: 35 });
    expect(tempScale(-2, { mode: "ge", lo: -3, hi: 0 })).toEqual({ lo: -15, hi: 10 });
  });
});

describe("conditions: rain by part of the day", () => {
  it("places JMA's hour n (ending at n:00) in its part", () => {
    // 7:00 → 朝 (6–9), 9:00 still 朝, 10:00 昼, 24:00 夜; 3:00 is in none of them.
    expect([...wetParts(hours("d", { 7: 1 }))]).toEqual(["morning"]);
    expect([...wetParts(hours("d", { 9: 1 }))]).toEqual(["morning"]);
    expect([...wetParts(hours("d", { 10: 1 }))]).toEqual(["day"]);
    expect([...wetParts(hours("d", { 24: 1 }))]).toEqual(["night"]);
    expect([...wetParts(hours("d", { 3: 5 }))]).toEqual([]);
    // Below what a record shows (0.5 mm) is not rain.
    expect([...wetParts(hours("d", { 12: 0.4 }))]).toEqual([]);
  });

  it("needs the hours only for a day with rain", () => {
    const dry = { mode: "dry", parts: ["day"] } as const;
    expect(needsHours(dry, day("2025-11-01", 20, 10, 0))).toBe(false);
    expect(rainPasses(dry, day("2025-11-01", 20, 10, 0), null)).toBe(true);
    expect(rainPasses({ mode: "wet", parts: ["day"] }, day("2025-11-01", 20, 10, 0), null)).toBe(false);
    expect(rainPasses(dry, day("2025-11-01", 20, 10, 4), null)).toBeNull();
    // Rained only in the evening: dry in 昼 passes, wet in 昼 fails, wet in 夕 passes.
    const h = hours("2025-11-01", { 17: 3 });
    expect(rainPasses(dry, day("2025-11-01", 20, 10, 3), h)).toBe(true);
    expect(rainPasses({ mode: "wet", parts: ["day"] }, day("2025-11-01", 20, 10, 3), h)).toBe(false);
    expect(rainPasses({ mode: "wet", parts: ["day", "evening"] }, day("2025-11-01", 20, 10, 3), h)).toBe(true);
    // Hours at hand decide even when the day's total says otherwise.
    expect(rainPasses({ mode: "wet", parts: ["evening"] }, day("2025-11-01", 20, 10, 0), h)).toBe(true);
  });
});

describe("conditions: where to look", () => {
  it("looks around the same date in past years, before today, newest first", () => {
    const days = candidateDays("2026-11-13", { years: 3, span: 15, weekday: "any" }, "2026-11-13");
    expect(days).toHaveLength(93);
    expect(days[0]).toBe("2025-11-28");
    expect(days.at(-1)).toBe("2023-10-29");
    // A year's span reaching past today stops at yesterday.
    const all = candidateDays("2026-11-13", { years: 1, span: "all", weekday: "any" }, "2026-11-13");
    expect(all[0] < "2026-11-13").toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(sameDateBack("2028-02-29", 1)).toBe("2027-02-28");
  });

  it("filters by weekday", () => {
    // 2026-11-13 is a Friday.
    const fri = candidateDays("2026-11-13", { years: 1, span: 7, weekday: "sameWeekday" }, "2026-11-13");
    expect(fri.every((d) => new Date(d + "T00:00:00Z").getUTCDay() === 5)).toBe(true);
    expect(fri).toHaveLength(2);
  });
});

describe("searchConditions", () => {
  const rows = new Map<string, WeatherRow | null>([
    ["2025-11-14", day("2025-11-14", 21.5, 15)],
    ["2025-11-10", day("2025-11-10", 22.5, 16, 6)],
    ["2024-11-12", day("2024-11-12", 20, 12)],
    ["2024-11-20", day("2024-11-20", 25, 18)],
    ["2023-11-13", null],
  ]);
  const h = new Map([["2025-11-10", hours("2025-11-10", { 20: 6 })]]);
  const look = { day: (d: string) => rows.get(d), hours: (d: string) => h.get(d) ?? null };
  const cands = [...rows.keys(), "2023-11-01"];
  const origin = { date: "2026-11-13", max: 21.6, min: 15.9 };

  it("lists the days that pass, nearest high and low first", () => {
    const r = searchConditions(base, origin, cands, look);
    expect(r.matches.map((m) => m.date)).toEqual(["2025-11-14", "2025-11-10", "2024-11-12"]);
    expect(r.loaded).toBe(5);
    expect(r.total).toBe(6);
  });

  it("asks for hours only of rainy days that pass the temperatures", () => {
    const noHours = { day: look.day, hours: () => null };
    const r = searchConditions({ ...base, rain: { mode: "dry", parts: ["day"] } }, origin, cands, noHours);
    expect(r.hoursWanted).toEqual(["2025-11-10"]);
    const hot = searchConditions({ ...base, max: { mode: "ge", lo: 24, hi: 0 }, rain: { mode: "dry", parts: ["day"] } }, origin, cands, noHours);
    expect(hot.hoursWanted).toEqual([]);
  });

  it("uses the hours once loaded", () => {
    // Rained at night only: dry 昼 passes, wet 昼 does not.
    const dry = searchConditions({ ...base, rain: { mode: "dry", parts: ["day"] } }, origin, cands, look);
    expect(dry.matches.map((m) => m.date)).toContain("2025-11-10");
    expect([...dry.matches.find((m) => m.date === "2025-11-10")!.wet!]).toEqual(["night"]);
    const wet = searchConditions({ ...base, rain: { mode: "wet", parts: ["day"] } }, origin, cands, look);
    expect(wet.matches).toEqual([]);
  });

  it("with no match, names the condition that frees the most days", () => {
    const r = searchConditions({ ...base, max: { mode: "ge", lo: 30, hi: 0 } }, origin, cands, look);
    expect(r.matches).toEqual([]);
    expect(r.loosen).toEqual({ key: "max", count: 4 });
  });
});

describe("weatherGroup (moved to dayWeather)", () => {
  it("still groups the weather text", () => {
    expect(weatherGroup("晴後一時曇")).toBe("sun");
    expect(weatherGroup("雨後晴")).toBe("rain");
    expect(weatherGroup(null)).toBeNull();
  });
});

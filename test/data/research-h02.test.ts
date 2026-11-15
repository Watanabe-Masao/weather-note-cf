// H-02 (#132, research/brightness/h02-lib.ts): what the check counts. A value not recorded is never
// read as a value, a day's hours are set by the sun, and 日照 0 is split by its day.

import { describe, expect, it } from "vitest";
import { sunshineFraction } from "../../shared/brightness";
import type { WeatherRow } from "../../shared/types";
import { clearSkyW, dayCheck, daylight, daySky, h02bFactor, H02B, meanWithInterval, neighbours, overlapsFit, RECORD_STEP_W, rainState, sunOf } from "../../research/brightness/h02-lib";

const KOCHI = "47893";
const day = (date: string, at: (n: number) => Partial<WeatherRow> = () => ({})): WeatherRow[] =>
  Array.from({ length: 24 }, (_, i) => ({ date, n: i + 1, type: "actual", solar: 100, sun: 0.5, rain: 0, ...at(i + 1) }) as unknown as WeatherRow);

describe("rain as recorded", () => {
  it("is unknown when not recorded — never dry", () => {
    expect(rainState(null)).toBe("unknown");
    expect(rainState(0)).toBe("dry");
    expect(rainState(0.5)).toBe("wet");
  });
});

describe("the hours a day needs: set by the sun, not by the clock", () => {
  it("a winter day needs fewer hours than a summer day", () => {
    const winter = dayCheck("2025-12-21", KOCHI, day("2025-12-21")).needed.length;
    const summer = dayCheck("2026-06-21", KOCHI, day("2026-06-21")).needed.length;
    expect(winter).toBeLessThan(summer);
    expect(dayCheck("2025-12-21", KOCHI, day("2025-12-21")).complete).toBe(true);
  });

  it("a missing rain at noon makes the day incomplete, and says what is missing", () => {
    const c = dayCheck("2025-11-01", KOCHI, day("2025-11-01", (n) => (n === 12 ? { rain: null } : {})));
    expect(c.complete).toBe(false);
    expect(c.missing).toEqual([{ n: 12, what: ["rain"] }]);
  });

  it("an hour not in the table misses all three", () => {
    const c = dayCheck("2025-11-01", KOCHI, day("2025-11-01").filter((r) => r.n !== 10));
    expect(c.missing).toEqual([{ n: 10, what: ["radiation", "sun", "rain"] }]);
  });

  it("an hour whose clear sky is below the record's smallest step is not needed (it could not show light)", () => {
    // 2025-11-01 18時: the clear sky gives about 1 W/m², under 0.01 MJ/m² over the hour
    expect(clearSkyW("2025-11-01", 18, KOCHI)).toBeGreaterThan(0);
    expect(clearSkyW("2025-11-01", 18, KOCHI)).toBeLessThan(RECORD_STEP_W);
    expect(dayCheck("2025-11-01", KOCHI, day("2025-11-01", (n) => (n === 18 ? { solar: null } : {}))).complete).toBe(true);
  });

  it("a missing value at night is not needed", () => {
    const c = dayCheck("2025-11-01", KOCHI, day("2025-11-01", (n) => (n === 2 ? { solar: null, sun: null, rain: null } : {})));
    expect(c.complete).toBe(true);
  });

  it("an empty 日照 is no sunshine only where sunshine was not possible; elsewhere it is missing", () => {
    const date = "2025-11-01";
    const row = (n: number) => ({ date, n, sun: null }) as unknown as WeatherRow;
    expect(sunshineFraction(date, 18, KOCHI)).toBe(0);
    expect(sunOf(row(18), date, KOCHI)).toBe(0); // the sun too low for sunshine: empty is none
    expect(sunOf(row(12), date, KOCHI)).toBeNull(); // noon: empty is missing
    expect(dayCheck(date, KOCHI, day(date, (n) => (n === 12 ? { sun: null } : {}))).missing).toEqual([{ n: 12, what: ["sun"] }]);
  });
});

describe("日照 0 is not one sky", () => {
  it("splits by the day's sunshine", () => {
    expect(daySky(0.4)).toBe("dull");
    expect(daySky(3)).toBe("mixed");
    expect(daySky(7)).toBe("bright");
  });

  it("tells an hour between sunny ones from one inside a dark run, and says when it cannot", () => {
    const rows = day("2025-11-01", (n) => ({ sun: n === 11 ? 0.6 : n === 15 ? null : 0 }));
    expect(neighbours(rows, 12)).toBe("sunny");
    expect(neighbours(rows, 13)).toBe("dark");
    expect(neighbours(rows, 14)).toBe("unknown");
  });
});

describe("H-02b: chosen on one year, tested on another", () => {
  it("splits 日照 0 by its neighbours, and keeps the app's where they are not known", () => {
    expect(h02bFactor("dark")).toBe(H02B.dark);
    expect(h02bFactor("sunny")).toBe(H02B.between);
    expect(h02bFactor("unknown")).toBeNull();
    expect(H02B.dark).toBeLessThan(1 / 3);
    expect(H02B.between).toBeGreaterThan(1 / 3);
  });

  it("knows when a run overlaps the year its numbers were chosen on (not a test there)", () => {
    expect(overlapsFit("2024-11-01", "2025-10-31")).toBe(false);
    expect(overlapsFit("2025-10-01", "2025-11-30")).toBe(true);
    expect(overlapsFit("2025-11-01", "2026-10-31")).toBe(true);
  });

  it("gives a day-bootstrap interval only with enough days, the same every run", () => {
    expect(meanWithInterval([1, 2, 3]).interval).toBeNull();
    expect(Number.isNaN(meanWithInterval([]).mean)).toBe(true);
    const d = Array.from({ length: 40 }, (_, i) => -0.02 + (i % 5) * 0.001);
    const a = meanWithInterval(d);
    expect(a).toEqual(meanWithInterval(d));
    expect(a.interval![0]).toBeLessThanOrEqual(a.mean);
    expect(a.interval![1]).toBeGreaterThanOrEqual(a.mean);
    expect(a.interval![1]).toBeLessThan(0);
  });
});

// 台風の日 for the table (src/data/typhoonDays.ts, #234 review): a date is a typhoon day, no typhoon,
// or unknown — and what could not be read, or has not been reached yet, is never "no typhoon".

import { describe, expect, it } from "vitest";
import { typhoonLookup, type TyphoonSources } from "../../src/data/typhoonDays";

const mark = (number: number, area: "storm" | "gale" | "warning" = "gale") => ({ number, area });
const base: TyphoonSources = {
  past: new Map([["2026-06-27", mark(7)]]),
  pastEnd: "2026-08-24",
  ahead: new Map([["2026-11-17", mark(30, "warning")]]),
  aheadState: "ok",
  today: "2026-11-16",
};

describe("typhoonLookup", () => {
  it("reads the best track up to its last day, and JMA's word from today", () => {
    const on = typhoonLookup(base);
    expect(on("2026-06-27")).toEqual(mark(7));
    expect(on("2026-07-01")).toBe("none");
    expect(on("2026-11-17")).toEqual(mark(30, "warning"));
    expect(on("2026-11-18")).toBe("none");
  });

  it("does not call the days after the best track's last day 'no typhoon'", () => {
    const on = typhoonLookup(base);
    expect(on("2026-09-20")).toBe("unknown");
    expect(on("2026-11-15")).toBe("unknown");
  });

  it("does not call today and ahead 'no typhoon' while JMA's information is not read", () => {
    for (const aheadState of ["loading", "failed"] as const) {
      const on = typhoonLookup({ ...base, ahead: new Map(), aheadState });
      expect(on("2026-11-16")).toBe("unknown");
      expect(on("2026-11-20")).toBe("unknown");
    }
    // An old reading is still a reading: its days stand (the card says it is old).
    expect(typhoonLookup({ ...base, aheadState: "stale" })("2026-11-17")).toEqual(mark(30, "warning"));
  });

  it("knows nothing of the past while the best track is being read or could not be read", () => {
    expect(typhoonLookup({ ...base, past: new Map(), pastEnd: null })("2026-07-01")).toBe("unknown");
    expect(typhoonLookup({ ...base, past: new Map(), pastEnd: "none" })("2026-07-01")).toBe("unknown");
  });
});

// At night (sunset to sunrise) a report does not ask 日なた・日かげ: without sunshine both are the same
// temperature, so the place's temperature is the shade's.

import { describe, expect, it } from "vitest";
import { nightAt, placeTempOf } from "../../src/beta/engine/observations";
import type { Report } from "../../src/beta/reports";

const report = (exposure: Report["exposure"]) => ({ exposure, snapshot: { sunTemp: 14, shadeTemp: 11 } }) as unknown as Report;

describe("night reports without a place", () => {
  it("reads the shade's temperature when no place was asked", () => {
    expect(placeTempOf(report(null))).toBe(11);
    expect(placeTempOf(report("shade"))).toBe(11);
    expect(placeTempOf(report("sun"))).toBe(14);
    expect(placeTempOf(report("mixed"))).toBe(12.5);
  });
  it("calls night the same span as the model: sunset to sunrise", () => {
    const sun = { sunrise: "06:30", sunset: "17:10", date: "2026-11-12" };
    const jst = (hm: string) => Date.parse(`2026-11-12T${hm}:00+09:00`);
    expect(nightAt(jst("17:05"), "47893", sun)).toBe(false);
    expect(nightAt(jst("17:15"), "47893", sun)).toBe(true);
    expect(nightAt(jst("06:25"), "47893", sun)).toBe(true);
    expect(nightAt(jst("06:35"), "47893", sun)).toBe(false);
  });
});

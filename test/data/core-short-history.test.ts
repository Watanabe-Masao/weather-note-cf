// 学習なし版の短期の履歴 S と肌感の変化の速さ: the hours before, across midnight, with their reasons
// when there are too few — checked by their properties (fast-check).

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEEL } from "../../shared/feel";
import { stationLatLon } from "../../shared/sunTimes";
import { type Estimate, FEEL_RATE_STANDARD, HISTORY_SHORT_STANDARD, type MaterialHour, shortHistories } from "../../src/core";

const KOCHI = stationLatLon("47893")!;
const site = { anemometerHeight: DEFAULT_FEEL.stationHeight, lat: KOCHI.lat, lon: KOCHI.lon };
const s = { alpha: DEFAULT_FEEL.alpha, absorb: DEFAULT_FEEL.absorb };
const valueOf = (e: Estimate) => ("value" in e ? e.value : null);
const LAG = FEEL_RATE_STANDARD.values.lag.value;

/** Consecutive hours from 2026-11-14 hour 13 on, one per temperature (night: no 日照). */
function hours(temps: (number | null)[]): (MaterialHour | null)[] {
  return temps.map((t, i) => {
    if (t == null) return null;
    const k = 12 + i; // hours after 2026-11-14 0:00
    const date = k < 24 ? "2026-11-14" : "2026-11-15";
    const n = (k % 24) + 1;
    return {
      station: "47893",
      date,
      hour: n,
      kind: "record",
      provider: "JMA",
      provisional: false,
      values: { temp: t, humidity: 60, wind: 2, rain: 0, sunshine: 0, pressure: 1013 },
      absent: {},
      rough: [],
    };
  });
}

const temp = fc.double({ min: 0, max: 30, noNaN: true });

describe("the short history", () => {
  it("on a steady hour after hour, S is the 肌感 and the rate is 0", () => {
    fc.assert(
      fc.property(temp, (t) => {
        const out = shortHistories(hours(Array(16).fill(t)), site, s, "shade");
        const last = out.at(-1)!;
        expect(valueOf(last.short)!).toBeCloseTo(valueOf(last.feel)!, 9);
        expect(valueOf(last.rate)!).toBeCloseTo(0, 9);
      }),
      { numRuns: 30 },
    );
  });

  it("while it warms, S lags below the 肌感 and the rate is positive; while it cools, the other way", () => {
    fc.assert(
      fc.property(temp, fc.double({ min: 0.3, max: 2, noNaN: true }), fc.boolean(), (t0, step, up) => {
        const temps = Array.from({ length: 16 }, (_, i) => t0 + (up ? 1 : -1) * step * i);
        const last = shortHistories(hours(temps), site, s, "shade").at(-1)!;
        const f = valueOf(last.feel)!;
        if (up) {
          expect(valueOf(last.short)!).toBeLessThan(f);
          expect(valueOf(last.rate)!).toBeGreaterThan(0);
        } else {
          expect(valueOf(last.short)!).toBeGreaterThan(f);
          expect(valueOf(last.rate)!).toBeLessThan(0);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("the rate is (F now − F lag hours before) / lag", () => {
    const out = shortHistories(hours([10, 11, 13, 16, 20, 21]), site, s, "shade");
    const f = out.map((o) => valueOf(o.feel)!);
    expect(valueOf(out[5].rate)!).toBeCloseTo((f[5] - f[5 - LAG]) / LAG, 9);
  });

  it("runs across midnight: hour 1 of the next day reads the evening before", () => {
    const out = shortHistories(hours(Array(16).fill(12)), site, s, "shade");
    // index 12 is 2026-11-15 hour 1
    expect(valueOf(out[12].short)).not.toBeNull();
  });

  it("the first hour has nothing before it, and says so", () => {
    const first = shortHistories(hours([12, 12]), site, s, "shade")[0];
    expect(first.short).toMatchObject({ absent: "tooShort", shortage: { of: "1時間前" } });
    expect(first.rate).toMatchObject({ absent: "tooShort" });
  });

  it("a missing hour before is noRow: one far back is no loss, the hour before is", () => {
    const far = shortHistories(hours([12, null, ...Array(12).fill(12)]), site, s, "shade").at(-1)!;
    expect(valueOf(far.short)).not.toBeNull();
    const near = shortHistories(hours([...Array(12).fill(12), null, 12]), site, s, "shade").at(-1)!;
    expect(near.short).toMatchObject({ absent: "tooShort", shortage: { of: "1時間前" } });
  });

  it("日なた's S carries the afternoon's sun into the evening, and is 日かげ's once the window is all night", () => {
    const shade = shortHistories(hours(Array(18).fill(9)), site, s, "shade");
    const sun = shortHistories(hours(Array(18).fill(9)), site, s, "sun");
    // index 6 (19時) still remembers the sunny afternoon; index 17 (翌6時) looks back on 18時–5時, all night.
    expect(valueOf(sun[6].short)!).toBeGreaterThan(valueOf(shade[6].short)!);
    expect(valueOf(sun[17].short)!).toBeCloseTo(valueOf(shade[17].short)!, 9);
  });

  it("names its formula and set", () => {
    const last = shortHistories(hours(Array(14).fill(12)), site, s, "shade").at(-1)!;
    expect(last.short.trace.map((t) => [t.formula, t.params])).toEqual([["history.short.ema@1", `${HISTORY_SHORT_STANDARD.id}@1`]]);
    expect(last.rate.trace.map((t) => t.formula)).toEqual(["wind.person@1", "feel.shade@1", "feel.rate@1"]);
  });
});

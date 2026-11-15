// 学習なし版の慣れ: 慣れ-L1 (adapt.long.mean) and 慣れ-L2 (adapt.long.ema) from the same days, each
// checked against the app's current one and against each other.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runningMean } from "../../src/beta/adaptation";
import { mean30 } from "../../shared/season";
import { ADAPT_EMA_STANDARD, ADAPT_MEAN_SEASON, adaptationEma, adaptationMean, adaptEma, adaptMean, type Estimate, type MaterialDay } from "../../src/core";

function day(temp: number | null): MaterialDay {
  return {
    station: "47893",
    date: "2026-11-01",
    kind: "record",
    provider: "JMA",
    provisional: false,
    values: { temp, max: null, min: null, humidity: null, wind: null, windMax: null, gust: null, rain: null, sunshine: null, pressure: null },
    absent: temp == null ? { temp: "notObserved" } : {},
    rough: [],
  };
}
const days = (temps: (number | null)[]) => temps.map(day);
const valueOf = (e: Estimate) => ("value" in e ? e.value : null);

const temp = fc.double({ min: -10, max: 35, noNaN: true });
const run = (n: number, holes = 0.15) => fc.array(fc.option(temp, { freq: Math.round(1 / holes) }), { minLength: n, maxLength: n });

describe("慣れ-L1 rebuilds the 30-day mean of 従来版 (shared/season.ts)", () => {
  it("for any 30 days, with or without holes", () => {
    fc.assert(
      fc.property(run(30), (t) => {
        const now = mean30(t);
        const next = valueOf(adaptationMean(days(t)));
        if (now == null) expect(next).toBeNull();
        else expect(next!).toBeCloseTo(now, 9);
      }),
    );
  });

  it("too few days says how many there were", () => {
    const e = adaptationMean(days([...Array(20).fill(10), ...Array(10).fill(null)]));
    expect(e).toMatchObject({ absent: "tooShort", shortage: { have: 20, need: 24, of: "日" } });
  });
});

describe("慣れ-L2 rebuilds β's running mean (src/beta/adaptation.ts)", () => {
  it("for any 60 days, with or without holes (β rounds to 0.1)", () => {
    fc.assert(
      fc.property(run(60), (t) => {
        const now = runningMean(t.map((mean) => ({ mean, forecast: false })), ADAPT_EMA_STANDARD.values.alpha.value);
        const next = valueOf(adaptationEma(days(t)));
        if (now == null) expect(next).toBeNull();
        else expect(Math.abs(next! - now.value)).toBeLessThanOrEqual(0.05 + 1e-9);
      }),
    );
  });

  it("without the day before there is none, and it says so", () => {
    expect(adaptationEma(days([null, ...Array(59).fill(10)]))).toMatchObject({ absent: "tooShort", shortage: { of: "前日" } });
  });

  it("a day not loaded is noRow, never skipped", () => {
    const e = adaptationEma([day(10), null, ...days(Array(58).fill(10))]);
    expect(valueOf(e)).toBeCloseTo(10, 9);
  });
});

describe("L1 and L2 side by side: the same days, different answers", () => {
  it("after a sudden warming, L2 follows sooner than L1", () => {
    fc.assert(
      fc.property(temp, fc.double({ min: 3, max: 15, noNaN: true }), fc.integer({ min: 1, max: 7 }), (base, jump, k) => {
        const t = [...Array(k).fill(base + jump), ...Array(60 - k).fill(base)];
        const l1 = valueOf(adaptationMean(days(t)))!;
        const l2 = valueOf(adaptationEma(days(t)))!;
        expect(l2 - base).toBeGreaterThan(l1 - base);
      }),
    );
  });

  it("on a steady season they agree", () => {
    fc.assert(
      fc.property(temp, (t) => {
        const d = days(Array(60).fill(t));
        expect(valueOf(adaptationMean(d))!).toBeCloseTo(valueOf(adaptationEma(d))!, 9);
      }),
    );
  });

  it("each names its own formula and set", () => {
    const d = days(Array(60).fill(12));
    expect(adaptationMean(d).trace.map((s) => [s.formula, s.params])).toEqual([[`${adaptMean.id}@1`, `${ADAPT_MEAN_SEASON.id}@1`]]);
    expect(adaptationEma(d).trace.map((s) => [s.formula, s.params])).toEqual([[`${adaptEma.id}@1`, `${ADAPT_EMA_STANDARD.id}@1`]]);
  });
});

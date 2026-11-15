// 学習なし版の長期の気温履歴: 長期の気温履歴 L1 (history.long.mean) and 長期の気温履歴 L2 (history.long.ema) from the same days, each
// checked against the app's current one and against each other.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runningMean } from "../../src/beta/adaptation";
import { mean30 } from "../../shared/season";
import { HISTORY_EMA_STANDARD, HISTORY_MEAN_SEASON, longHistoryEma, longHistoryMean, historyEma, historyMean, type Estimate, type MaterialDay } from "../../src/core";

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

describe("長期の気温履歴 L1 rebuilds the 30-day mean of 従来版 (shared/season.ts)", () => {
  it("for any 30 days, with or without holes", () => {
    fc.assert(
      fc.property(run(30), (t) => {
        const now = mean30(t);
        const next = valueOf(longHistoryMean(days(t)));
        if (now == null) expect(next).toBeNull();
        else expect(next!).toBeCloseTo(now, 9);
      }),
    );
  });

  it("too few days says how many there were", () => {
    const e = longHistoryMean(days([...Array(20).fill(10), ...Array(10).fill(null)]));
    expect(e).toMatchObject({ absent: "tooShort", shortage: { have: 20, need: 24, of: "日" } });
  });
});

describe("長期の気温履歴 L2 rebuilds β's running mean (src/beta/adaptation.ts)", () => {
  it("for any 60 days, with or without holes (β rounds to 0.1)", () => {
    fc.assert(
      fc.property(run(60), (t) => {
        const now = runningMean(t.map((mean) => ({ mean, forecast: false })), HISTORY_EMA_STANDARD.values.alpha.value);
        const next = valueOf(longHistoryEma(days(t)));
        if (now == null) expect(next).toBeNull();
        else expect(Math.abs(next! - now.value)).toBeLessThanOrEqual(0.05 + 1e-9);
      }),
    );
  });

  it("without the day before there is none, and it says so", () => {
    expect(longHistoryEma(days([null, ...Array(59).fill(10)]))).toMatchObject({ absent: "tooShort", shortage: { of: "前日" } });
  });

  it("a day not loaded is noRow, never skipped", () => {
    const e = longHistoryEma([day(10), null, ...days(Array(58).fill(10))]);
    expect(valueOf(e)).toBeCloseTo(10, 9);
  });
});

describe("L1 and L2 side by side: the same days, different answers", () => {
  it("after a sudden warming, L2 follows sooner than L1", () => {
    fc.assert(
      fc.property(temp, fc.double({ min: 3, max: 15, noNaN: true }), fc.integer({ min: 1, max: 7 }), (base, jump, k) => {
        const t = [...Array(k).fill(base + jump), ...Array(60 - k).fill(base)];
        const l1 = valueOf(longHistoryMean(days(t)))!;
        const l2 = valueOf(longHistoryEma(days(t)))!;
        expect(l2 - base).toBeGreaterThan(l1 - base);
      }),
    );
  });

  it("on a steady season they agree", () => {
    fc.assert(
      fc.property(temp, (t) => {
        const d = days(Array(60).fill(t));
        expect(valueOf(longHistoryMean(d))!).toBeCloseTo(valueOf(longHistoryEma(d))!, 9);
      }),
    );
  });

  it("each names its own formula and set", () => {
    const d = days(Array(60).fill(12));
    expect(longHistoryMean(d).trace.map((s) => [s.formula, s.params])).toEqual([[`${historyMean.id}@1`, `${HISTORY_MEAN_SEASON.id}@1`]]);
    expect(longHistoryEma(d).trace.map((s) => [s.formula, s.params])).toEqual([[`${historyEma.id}@1`, `${HISTORY_EMA_STANDARD.id}@1`]]);
  });
});

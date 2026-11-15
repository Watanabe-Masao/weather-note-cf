// 長期の気温履歴 L1・L2 の違いの影響: only the baseline is swapped; the boundary shift and the seven-step judge
// are the same for both. Checked against 従来版 and by the properties of the difference.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEEL, levelOf } from "../../shared/feel";
import { mean30, seasonShift as legacyShift } from "../../shared/season";
import {
  longHistoryEma,
  longHistoryMean,
  type ComparedDay,
  compareLongHistory,
  type Estimate,
  evaluate,
  level7,
  level7Settings,
  type MaterialDay,
  type MaterialHour,
  SEASON_SHIFT_STANDARD,
  seasonShift,
  windPersonSettings,
} from "../../src/core";

const nothing = { max: null, min: null, humidity: null, wind: null, windMax: null, gust: null, rain: null, sunshine: null, pressure: null };
function day(date: string, temp: number | null): MaterialDay {
  return { station: "47893", date, kind: "record", provider: "JMA", provisional: false, values: { temp, ...nothing }, absent: temp == null ? { temp: "notObserved" } : {}, rough: [] };
}
function hour(date: string, n: number, temp: number): MaterialHour {
  return {
    station: "47893",
    date,
    hour: n,
    kind: "record",
    provider: "JMA",
    provisional: false,
    values: { temp, humidity: 60, wind: 2, rain: 0, sunshine: 0, pressure: 1013 },
    absent: {},
    rough: [],
  };
}
const valueOf = (e: Estimate) => ("value" in e ? e.value : null);
const S = SEASON_SHIFT_STANDARD.values;
const T = DEFAULT_FEEL.thresholds;
const sets = { feel: { windPerson: windPersonSettings(DEFAULT_FEEL.alpha) }, level: level7Settings(T) };

const temp = fc.double({ min: -10, max: 35, noNaN: true });

describe("with 長期の気温履歴 L1, the shift and the steps are 従来版's", () => {
  it("the shift equals shared/season.ts for any 30 days", () => {
    fc.assert(
      fc.property(fc.array(fc.option(temp, { freq: 8 }), { minLength: 30, maxLength: 30 }), (t) => {
        const m = mean30(t);
        const shift = evaluate(seasonShift, SEASON_SHIFT_STANDARD, { history: longHistoryMean(t.map((v) => day("2026-11-01", v))) });
        // Too few days: the shift says so at the place it started (history.dayMeans).
        if (m == null) expect(shift).toMatchObject({ absent: "tooShort", input: "history.dayMeans" });
        else expect(valueOf(shift)!).toBeCloseTo(legacyShift(m), 9);
      }),
    );
  });

  it("the step equals levelOf on the moved boundaries, for any 肌感 and shift", () => {
    fc.assert(
      fc.property(fc.double({ min: -15, max: 45, noNaN: true }), fc.double({ min: -7, max: 11, noNaN: true }), (feel, shift) => {
        const legacy = levelOf(feel, { ...DEFAULT_FEEL, thresholds: T.map((b) => b + shift) as typeof T });
        expect(valueOf(evaluate(level7, sets.level, { feel: { value: feel }, shift: { value: shift } }))).toBe(legacy);
      }),
    );
  });
});

describe("the difference Δb = g(L2) − g(L1)", () => {
  const g = (a: number) => valueOf(evaluate(seasonShift, SEASON_SHIFT_STANDARD, { history: { value: a } }))!;

  it("is never more than slope × |L2 − L1|, and 0 when both are past the same end", () => {
    fc.assert(
      fc.property(temp, temp, (a, b) => {
        expect(Math.abs(g(b) - g(a))).toBeLessThanOrEqual(S.slope.value * Math.abs(b - a) + 1e-9);
        if ((a >= S.hi.value && b >= S.hi.value) || (a <= S.lo.value && b <= S.lo.value)) expect(g(b) - g(a)).toBeCloseTo(0, 9);
      }),
    );
  });
});

describe("compareLongHistory: the same days, only the baseline swapped", () => {
  const dates = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));

  it("after a sudden warming, L2's boundaries move up first, and hours near a boundary change step", () => {
    // 60 days at 12℃, then 10 days at 22℃; hours at noon of the warm days.
    const ds = dates(70);
    const days: ComparedDay[] = ds.map((d, i) => ({ date: d, day: day(d, i < 60 ? 12 : 22), hours: i >= 60 ? [hour(d, 12, 15), hour(d, 14, 19)] : [] }));
    const c = compareLongHistory(days, { anemometerHeight: 10 }, sets);
    const warm = c.days.slice(61);
    for (const d of warm) expect(d.delta!).toBeGreaterThan(0);
    expect(c.largestDelta!).toBeGreaterThan(0);
    expect(c.hoursCompared).toBe(warm.length * 2 + 2);
    // Each counted difference is a real one, and every hour says which step each side gave.
    const differ = c.days.flatMap((d) => d.hours.filter((h) => h.differs));
    expect(differ.length).toBe(c.hoursDiffer);
    for (const h of differ) expect(valueOf(h.level1)).not.toBe(valueOf(h.level2));
  });

  it("days with too little before them are kept, left out of the counts, with their reasons", () => {
    const ds = dates(40);
    const c = compareLongHistory(
      ds.map((d) => ({ date: d, day: day(d, 15) })),
      { anemometerHeight: 10 },
      sets,
    );
    expect(c.days).toHaveLength(40);
    // L1 needs 24 days; L2 needs the day before and 8 tenths of its weight (about 8 days at α 0.8).
    expect(c.comparableDays).toBe(40 - 24);
    expect(Object.keys(c.leftOut).every((k) => k.includes("tooShort"))).toBe(true);
    expect(Object.values(c.leftOut).reduce((a, b) => a + b, 0)).toBe(24);
  });

  it("on a steady season the two agree: no difference anywhere", () => {
    fc.assert(
      fc.property(temp, (t) => {
        const ds = dates(65);
        const c = compareLongHistory(
          ds.map((d, i) => ({ date: d, day: day(d, t), hours: i === 64 ? [hour(d, 12, t)] : [] })),
          { anemometerHeight: 10 },
          sets,
        );
        for (const d of c.days) if (d.delta != null) expect(d.delta).toBeCloseTo(0, 9);
        expect(c.hoursDiffer).toBe(0);
      }),
      { numRuns: 30 },
    );
  });

  it("each side's trace names its own baseline, and the same shift and judge", () => {
    const ds = dates(62);
    const c = compareLongHistory(
      ds.map((d, i) => ({ date: d, day: day(d, 14), hours: i === 61 ? [hour(d, 12, 16)] : [] })),
      { anemometerHeight: 10 },
      sets,
    );
    const h = c.days[61].hours[0];
    const formulas = (e: { trace: { formula: string }[] }) => e.trace.map((s) => s.formula);
    expect(formulas(h.level1)).toEqual(["wind.person@1", "feel.shade@1", "history.long.mean@1", "judge.shift.season@1", "judge.level7@1"]);
    expect(formulas(h.level2)).toEqual(["wind.person@1", "feel.shade@1", "history.long.ema@1", "judge.shift.season@1", "judge.level7@1"]);
    expect(valueOf(longHistoryEma(ds.slice(0, 61).reverse().map((d) => day(d, 14))))!).toBeCloseTo(14, 9);
  });
});

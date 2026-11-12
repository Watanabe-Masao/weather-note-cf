// The in-app research analysis (iPhone only): aggregates, and what may leave the device.
import { describe, expect, it } from "vitest";
import { makeReport } from "../../research/data/fixture";
import { analyse, MIN_PEOPLE, sharedCsv } from "../../src/research/analysis";
import { MODEL_VERSION } from "../../src/beta/comfort";

const rowsFor = (people: number) =>
  Array.from({ length: people }, (_, p) =>
    [8, 12, 15].map((h, i) => ({ researchId: `p${p}`, report: makeReport(`p${p}-${i}`, h, 10 + h, i - 1) })),
  ).flat();

describe("in-app research analysis", () => {
  it("counts people and reports, and pools the scores by report", () => {
    const a = analyse(rowsFor(3));
    expect(a.people).toBe(3);
    expect(a.reports).toBe(9);
    const rps = a.cells.find((c) => c.item === "RPS（小さいほどよい）・件数で平均")!;
    expect(rps.people).toBe(3);
    expect(rps.reports).toBe(9);
    expect(rps.value).toBeGreaterThan(0);
    const lag = a.cells.find((c) => c.item === "中央値")!;
    expect(lag.value).toBe(10);
  });

  it("never leaves out who is who, and holds nothing back on screen", () => {
    const a = analyse(rowsFor(3));
    expect(JSON.stringify(a)).not.toMatch(/p0|p1|p2/);
  });

  it(`shares nothing below ${MIN_PEOPLE} people, and only cells of ${MIN_PEOPLE}+ people above`, () => {
    expect(sharedCsv(analyse(rowsFor(MIN_PEOPLE - 1)), new Date(0))).toBeNull();
    const rows = rowsFor(MIN_PEOPLE);
    rows[0].report = { ...rows[0].report, scaleVersion: 2 }; // one person in a cell of their own
    const csv = sharedCsv(analyse(rows), new Date(0))!;
    expect(csv).toContain("RPS");
    expect(csv).not.toContain("版2"); // and 版3 with it (it would give 版2 back by subtraction)
    expect(csv).not.toContain("版3");
    for (const line of csv.split("\r\n").slice(2).filter(Boolean)) expect(Number(line.split(",").at(-2))).toBeGreaterThanOrEqual(MIN_PEOPLE);
  });
});

describe("learning states without refitting", () => {
  it("takes each person's state from their latest report", () => {
    const rows = [
      { researchId: "a", report: makeReport("a1", 8, 12, 0, { comfort: { ...makeReport("x", 8, 12, 0).comfort!, learning: "sparse" } }) },
      { researchId: "a", report: makeReport("a2", 15, 20, 1, { comfort: { ...makeReport("x", 8, 12, 0).comfort!, learning: "testable" } }) },
      { researchId: "b", report: makeReport("b1", 9, 14, 0) },
    ];
    const cells = analyse(rows).cells.filter((c) => c.section.startsWith("学習の段階"));
    expect(cells.map((c) => [c.item, c.people])).toEqual([
      ["暫定", 1],
      ["検証可能", 1],
    ]);
  });
});

describe("by person and by report (#62 C)", () => {
  it("one person who reports a lot moves the by-report average but not the by-person one", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({ researchId: "heavy", report: makeReport(`h${i}`, 8 + (i % 8), 12 + i, 3) })),
      { researchId: "light", report: makeReport("l1", 12, 20, 0) },
    ];
    const cells = analyse(rows).cells;
    const byReport = cells.find((c) => c.item === "偏り（答え − 予測の平均）・件数で平均")!.value as number;
    const byPerson = cells.find((c) => c.item === "偏り（答え − 予測の平均）・人ごとに平均")!.value as number;
    expect(byReport).toBeGreaterThan(byPerson);
    expect(byPerson).toBeCloseTo((3 + 0) / 2, 1);
  });
});

describe("the preference questions (#63 P2)", () => {
  it("counts answers apart from skips, and only on reports that asked", () => {
    const rows = [
      { researchId: "a", report: makeReport("a1", 8, 12, -2, { preferenceVersion: 1, thermalPreference: "warmer", drinkPreference: "warm" }) },
      { researchId: "a", report: makeReport("a2", 13, 22, 1, { preferenceVersion: 1, drinkPreference: "cold" }) },
      { researchId: "b", report: makeReport("b1", 9, 14, 0) }, // made before the questions
    ];
    const cells = analyse(rows).cells;
    const of = (section: string) => cells.filter((c) => c.section === section).map((c) => [c.item, c.reports]);
    expect(of("どう感じたいか")).toEqual([
      ["もう少し暖かく", 1],
      ["（未回答）", 1],
    ]);
    expect(of("飲み物の温度")).toEqual([
      ["冷たい飲み物", 1],
      ["温かい飲み物", 1],
    ]);
    expect(of("感じ方 × 飲み物の温度（答えた記録）")).toEqual([
      ["寒い側・温かい飲み物", 1],
      ["暑い側・冷たい飲み物", 1],
    ]);
  });
});

describe("evaluation ready for real data (#53 #54 #68)", () => {
  it("splits sent predictions by model version and adds the 7-step cumulative calibration", () => {
    const rows = [0, 1, 2, 3].map((i) => ({ researchId: "a", report: makeReport(`v${i}`, 8 + i * 2, 12 + i * 3, i - 1) }));
    const cells = analyse(rows).cells;
    expect(cells.some((c) => c.section.startsWith("予測の版ごとの成績") && c.item.startsWith(MODEL_VERSION))).toBe(true);
    const cal = cells.filter((c) => c.section.startsWith("7段の較正"));
    expect(cal.length).toBeGreaterThan(0);
    expect(cal.reduce((s, c) => s + c.reports, 0)).toBe(4 * 6);
  });

  it("judges the preference models in time order from earlier answers only", async () => {
    const { preferenceTimeSeries } = await import("../../src/research/analysis");
    const list = Array.from({ length: 16 }, (_, i) => {
      const t = 10 + (i % 8) * 2;
      const r = makeReport(`p${i}`, 12, t, 0, { preferenceVersion: 1, drinkPreference: t < 15 ? "warm" : t > 21 ? "cold" : "either" });
      // One a day (12:10 JST), so no two are in a row.
      const date = `2026-10-${String(1 + i).padStart(2, "0")}`;
      return { ...r, at: new Date(Date.parse(`${date}T12:10:00+09:00`)).toISOString(), snapshot: { ...r.snapshot!, date } };
    });
    const ev = preferenceTimeSeries([["a", list]], "drink");
    expect(ev.n).toBeGreaterThan(0);
    expect(ev.n).toBeLessThan(16); // the first answers are never predicted
    expect(ev.before!).toBeLessThan(ev.ref!);
  });
});

describe("comfort-4 against comfort-5 on the same reports", () => {
  it("predicts the latest reports from earlier ones, both ways", { timeout: 120_000 }, async () => {
    const { compareSettings } = await import("../../src/research/analysis");
    const list = Array.from({ length: 6 }, (_, i) => {
      const r = makeReport(`c${i}`, 12, 12 + i * 3, i - 2);
      const date = `2026-10-${String(1 + i).padStart(2, "0")}`;
      return { ...r, at: new Date(Date.parse(`${date}T12:10:00+09:00`)).toISOString(), snapshot: { ...r.snapshot!, date } };
    });
    const c = compareSettings(list, 2);
    expect(c.n).toBe(2);
    expect(Number.isFinite(c.rpsA) && Number.isFinite(c.rpsB) && Number.isFinite(c.ref)).toBe(true);
  });
});

describe("review: no small cell back by subtraction", () => {
  it("hides a second cell when a section hides one, and shares a cross table only whole", () => {
    const rows = Array.from({ length: 6 }, (_, p) => [8, 12, 15].map((h, i) => ({ researchId: `p${p}`, report: makeReport(`p${p}-${i}`, h, 10 + h, i - 1) }))).flat();
    rows[0].report = { ...rows[0].report, scaleVersion: 2 }; // 1 person in 版2, 6 in 版3
    const csv = sharedCsv(analyse(rows), new Date(0))!;
    // 版3 would give 版2 back (header total − 版3), so both stay.
    expect(csv).not.toContain("版2");
    expect(csv).not.toContain("版3");
  });
});

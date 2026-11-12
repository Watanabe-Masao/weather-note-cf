// The in-app research analysis (iPhone only): aggregates, and what may leave the device.
import { describe, expect, it } from "vitest";
import { makeReport } from "../../research/data/fixture";
import { analyse, MIN_PEOPLE, sharedCsv } from "../../src/research/analysis";

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
    expect(csv).toContain("版3");
    expect(csv).not.toContain("版2");
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

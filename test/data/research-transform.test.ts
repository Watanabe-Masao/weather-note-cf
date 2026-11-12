// #45: the research export → analysis tables. Pure rules, so they are checked here without DuckDB.
import { describe, expect, it } from "vitest";
import { makeExport } from "../../research/data/fixture";
import { TABLES, purge, tablesOf } from "../../research/data/transform";

const columns = (sql: string) =>
  sql
    .slice(sql.indexOf("(") + 1, sql.lastIndexOf(")"))
    .split(/,(?![^(]*\))/)
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith("PRIMARY KEY"))
    .map((c) => c.split(/\s+/)[0]);

describe("research data", () => {
  it("each row has exactly the table's columns", () => {
    const rows = tablesOf(makeExport(), "h");
    for (const [table, list] of Object.entries(rows)) {
      const n = columns(TABLES[table]).length;
      for (const row of list) expect(row.length, table).toBe(n);
    }
  });

  it("keeps reports, inputs and predictions apart, with the input status per report", () => {
    const rows = tablesOf(makeExport(), "h");
    expect(rows.sensation_reports).toHaveLength(5);
    expect(rows.prediction_snapshots).toHaveLength(5);
    const cols = columns(TABLES.sensation_reports);
    const a3 = rows.sensation_reports.find((r) => r[1] === "a3")!;
    expect(a3[cols.indexOf("trainable")]).toBe(false);
    expect(rows.datasets[0]).toEqual(["ds-fixture", expect.any(String), 1, "h", 5, 2, 0]);
  });

  it("a withdrawal removes the person from every export and is counted", () => {
    const ex = purge(makeExport(), [{ researchId: "bbbb" }]);
    expect(ex.rows.every((r) => r.researchId !== "bbbb")).toBe(true);
    expect(ex.purged).toEqual(["bbbb"]);
    const again = purge(ex, [{ researchId: "bbbb" }]);
    expect(again).toBe(ex);
    expect(tablesOf(ex, "h").datasets[0][6]).toBe(1);
  });

  it("deleted reports are left out", () => {
    const ex = makeExport();
    ex.rows[0].report = { ...ex.rows[0].report, deleted: true };
    expect(tablesOf(ex, "h").sensation_reports).toHaveLength(4);
  });
});

// その発表の週間天気予報（11/19）：府県の日のあとに、週間で府県より先の日を足す（重ねない）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { issueDays } from "../../src/ui/forecastHistory/issueDays";
import type { HistoryEntry, HistoryIssue } from "../../shared/forecastHistory";

const h = JSON.parse(readFileSync(new URL("../../e2e/forecast-history.json", import.meta.url), "utf8")) as { issues: HistoryIssue[]; entries: HistoryEntry[]; places: { office: string; area: string; point: string } };
const shift = (e: HistoryEntry, n: number): HistoryEntry => {
  const d = (t: string) => new Date(Date.parse(t) + n * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 19) + "+09:00";
  return { ...e, valid_from: d(e.valid_from), valid_to: d(e.valid_to) };
};

describe("issueDays", () => {
  it("府県の3日のあとに週間の4日、日付は重ならず並ぶ。週間の行はどの発表かが分かる", () => {
    const fd = [...h.issues].reverse().find((i) => i.kind === "VPFD51")!;
    const wk = [...h.issues].reverse().find((i) => i.kind === "VPFW50" && i.issued_at <= fd.issued_at && h.entries.some((e) => e.issue_id === i.issue_id))!;
    const entries = [
      ...[0, 1, 2].flatMap((n) => h.entries.filter((e) => e.issue_id === fd.issue_id).map((e) => shift(e, n))),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((n) => h.entries.filter((e) => e.issue_id === wk.issue_id).map((e) => shift(e, n))),
    ];
    const rows = issueDays({ v: 1, station: "47893", supported: true, found: true, places: h.places, issue: fd, weekly: wk, entries });
    const days = rows.map((r) => r.day);
    expect(new Set(days).size).toBe(days.length);
    expect([...days].sort()).toEqual(days);
    expect(rows.filter((r) => r.from.issue_id === fd.issue_id).length).toBe(3);
    expect(rows.slice(3).every((r) => r.from.issue_id === wk.issue_id)).toBe(true);
    expect(rows.length).toBe(7);
  });
});

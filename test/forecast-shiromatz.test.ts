// 予報の履歴 (#250, R2): the record shiromatz keeps (CC BY-SA 4.0) read by shared/forecastShiromatz.ts —
// real rows of 高知 (2025-01, 2026-10: the two column namings), and JMA's forecast JSON of 2026-11-17
// 11時 flattened the record's way, read against the telegrams of the same issue (FH-05).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseForecastXml, type ForecastEntry } from "../shared/forecastXml";
import { compareWithTelegram, parseShiromatzCsv, readCsv, shiromatzIssueId } from "../shared/forecastShiromatz";
import { flatten } from "./forecastFlatten";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");

const pick = (es: ForecastEntry[], x: Partial<ForecastEntry>) => es.filter((e) => Object.entries(x).every(([k, v]) => e[k as keyof ForecastEntry] === v));

describe("shiromatz の記録を読む", () => {
  it("reads the CSV, quoted or not, and the later plural column names as the earlier ones", () => {
    const early = readCsv(fixture("shiromatz-202501-390000.csv"));
    const late = readCsv(fixture("shiromatz-202610-390000.csv"));
    expect(Object.keys(early[0])).toEqual(Object.keys(late[0]));
    expect(early[0]).toMatchObject({ reportDatetime: "2025-01-01T05:00:00+09:00", areaCode: "390010", weatherCode: "100", weather: "晴れ" });
    expect(readCsv('a,b\n"x, ""y""",2\r\n')).toEqual([{ a: 'x, "y"', b: "2" }]);
  });

  it("splits a time issued into its 府県天気予報 and, at 11・17時, its 週間 — each once (the record repeats the 17時 週間)", () => {
    const issues = parseShiromatzCsv(fixture("shiromatz-202501-390000.csv"), "390000");
    expect(issues.map((t) => `${t.kind}@${t.issuedAt.slice(5, 16)}:${t.entries.length}`)).toEqual([
      "VPFW50@12-31T17:00:35",
      "VPFD51@01-01T05:00:45",
      "VPFD51@01-01T11:00:48",
      "VPFW50@01-01T11:00:35",
      "VPFD51@01-01T17:00:39",
      "VPFW50@01-01T17:00:35",
      "VPFD51@01-02T05:00:45",
      "VPFD51@01-02T11:00:48",
      "VPFW50@01-02T11:00:35",
      "VPFD51@01-02T17:00:39",
      "VPFW50@01-02T17:00:35",
    ]);
    expect(issues.every((t) => t.problems.length === 0 && t.infoType === "発表")).toBe(true);
    expect(shiromatzIssueId(issues[1])).toBe("shiromatz:390000:VPFD51:2025-01-01T05:00:00+09:00");
  });

  it("reads the 気温 of a 府県天気予報 by their time, as the telegram names them", () => {
    const t = parseShiromatzCsv(fixture("shiromatz-202501-390000.csv"), "390000").find((x) => x.kind === "VPFD51" && x.issuedAt === "2025-01-01T11:00:00+09:00")!;
    expect(pick(t.entries, { place: "74182" }).map((e) => [e.jmaType, e.validFrom.slice(5, 16), e.period, e.label])).toEqual([
      ["日中の最高気温", "01-01T09:00", "PT9H", "今日日中"],
      ["最高気温", "01-01T00:00", "PT24H", "今日"],
      ["朝の最低気温", "01-02T00:00", "PT9H", "明日朝"],
      ["日中の最高気温", "01-02T09:00", "PT9H", "明日日中"],
    ]);
  });

  it("keeps the 週間's empty first day as JMA's 「値なし」", () => {
    const w = parseShiromatzCsv(fixture("shiromatz-202610-390000.csv"), "390000").find((x) => x.kind === "VPFW50")!;
    expect(pick(w.entries, { element: "pop" })[0]).toMatchObject({ value: null, condition: "値なし", period: "P1D" });
    expect(pick(w.entries, { element: "temp_max" })[1]).toMatchObject({ unit: "℃", period: "P1D" });
    expect(pick(w.entries, { element: "temp_max" })[1].lower).toEqual(expect.any(Number));
  });

  it("keeps an issue out of the regular hours (21時) as its own", () => {
    const issues = parseShiromatzCsv(fixture("shiromatz-202610-390000.csv"), "390000");
    expect(issues.some((t) => t.issuedAt === "2026-10-14T21:00:00+09:00" && t.kind === "VPFD51")).toBe(true);
  });
});

describe("記録と電文の突き合わせ（R5-2）", () => {
  const record = parseShiromatzCsv(flatten(JSON.parse(fixture("bosai-390000-1100.json"))), "390000");
  const telegram = {
    VPFD51: parseForecastXml(fixture("vpfd51-390000-1100.xml"), "VPFD51", "390000"),
    VPFW50: parseForecastXml(fixture("vpfw50-390000-1100.xml"), "VPFW50", "390000"),
  };

  it("every value of the record's 11時 issue is the telegram's, to the letter (天気の文, codes, 降水確率, 気温 and ranges, 信頼度)", () => {
    expect(record.map((t) => t.kind)).toEqual(["VPFD51", "VPFW50"]);
    for (const t of record) {
      const c = compareWithTelegram(t.entries, telegram[t.kind as "VPFD51" | "VPFW50"].entries);
      expect(c).toEqual({ same: t.entries.length, differ: [], missing: [] });
    }
    expect(record[0].entries.length + record[1].entries.length).toBe(83);
  });

  it("says a value that differs and one the telegram does not have", () => {
    const changed = record[1].entries.map((e) => (e.element === "reliability" && e.value === "C" ? { ...e, value: "B" } : e));
    changed.push({ ...changed[0], validFrom: "2026-11-30T00:00:00+09:00" });
    const c = compareWithTelegram(changed, telegram.VPFW50.entries);
    expect(c.differ).toEqual(['390000|reliability|信頼度階級|2026-11-24T00:00:00+09:00|2026-11-25T00:00:00+09:00|P1D: ["C",null,null,false] → ["B",null,null,false]']);
    expect(c.missing).toHaveLength(1);
  });
});

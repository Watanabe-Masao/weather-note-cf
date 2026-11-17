// 予報の履歴 (#250, R1-7 / R4): the kept telegrams read by the scheduled run (worker/src/forecastParse.ts)
// on a D1 stand-in: values with their times in forecast_entries, the XML never touched, a telegram
// that does not read kept with its reason, a 訂正 tied to what it corrects, and the same values again
// when everything is read anew.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORECAST_XML_PARSER } from "../shared/forecastXml";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { parseForecasts } from "../worker/src/forecastParse";
import { d1 } from "./d1";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");

async function setup() {
  const db = d1();
  await ensureForecastSchema(db);
  const keep = (id: string, kind: string, xml: string, issued = /<ReportDateTime>([^<]+)</.exec(xml)?.[1] ?? null) =>
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, '390000', 'u', ?, '2026-11-17T02:00:00Z', 'h', ?)")
      .run(id, kind, issued, xml);
  return { db, keep };
}

describe("予報の履歴：電文を読む", () => {
  it("reads the kept telegrams into an issue and its values, and leaves the XML as it was", async () => {
    const { db, keep } = await setup();
    const xml = fixture("vpfw50-390000-1100.xml");
    keep("w1", "VPFW50", xml);
    keep("d1", "VPFD51", fixture("vpfd51-390000-1100.xml"));
    keep("g1", "VPFG50", fixture("vpfg50-390000-1036.xml"));
    expect(await parseForecasts(db)).toEqual({ read: 3, failed: 0 });
    expect(db.raw.prepare("SELECT issue_id, source, kind, issued_at, info_type, preferred, parser, entries, problems FROM forecast_issues ORDER BY issue_id").all()).toEqual([
      { issue_id: "d1", source: "jma-xml", kind: "VPFD51", issued_at: "2026-11-17T11:00:00+09:00", info_type: "発表", preferred: 1, parser: FORECAST_XML_PARSER, entries: 132, problems: null },
      { issue_id: "g1", source: "jma-xml", kind: "VPFG50", issued_at: "2026-11-17T10:36:00+09:00", info_type: "発表", preferred: 1, parser: FORECAST_XML_PARSER, entries: 1, problems: null },
      { issue_id: "w1", source: "jma-xml", kind: "VPFW50", issued_at: "2026-11-17T11:00:00+09:00", info_type: "発表", preferred: 1, parser: FORECAST_XML_PARSER, entries: 42, problems: null },
    ]);
    // 11/20 as the week's forecast of 11/17 11時 had it, with the range and the unit.
    expect(
      db.raw.prepare("SELECT element, value, unit, lower, upper, period, condition FROM forecast_entries WHERE issue_id = 'w1' AND valid_from = '2026-11-20T00:00:00+09:00' ORDER BY element").all(),
    ).toEqual([
      { element: "pop", value: "30", unit: "%", lower: null, upper: null, period: "P1D", condition: null },
      { element: "reliability", value: "B", unit: null, lower: null, upper: null, period: "P1D", condition: null },
      { element: "temp_max", value: "13", unit: "℃", lower: 11, upper: 14, period: "P1D", condition: null },
      { element: "temp_min", value: "5", unit: "℃", lower: 3, upper: 6, period: "P1D", condition: null },
      { element: "weather", value: "くもり時々晴れ", unit: null, lower: null, upper: null, period: "P1D", condition: null },
      { element: "weather_code", value: "201", unit: null, lower: null, upper: null, period: "P1D", condition: null },
    ]);
    expect(db.raw.prepare("SELECT xml, parser, parsed FROM forecast_telegrams WHERE id = 'w1'").get()).toEqual({
      xml,
      parser: FORECAST_XML_PARSER,
      parsed: JSON.stringify({ entries: 42, problems: [] }),
    });
    expect(await parseForecasts(db)).toEqual({ read: 0, failed: 0 }); // once each
  });

  it("keeps a telegram that does not read, with its reason; its values stay empty", async () => {
    const { db, keep } = await setup();
    keep("bad", "VPFD51", "<Report><Head></Head></Report>", "2026-11-17T11:00:00+09:00");
    expect(await parseForecasts(db)).toEqual({ read: 0, failed: 1 });
    expect(db.raw.prepare("SELECT xml, parser, parsed FROM forecast_telegrams").get()).toEqual({
      xml: "<Report><Head></Head></Report>",
      parser: FORECAST_XML_PARSER,
      parsed: JSON.stringify({ error: "ReportDateTime がない" }),
    });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_issues").get()).toEqual({ n: 0 });
    expect(await parseForecasts(db)).toEqual({ read: 0, failed: 0 }); // not tried again until the parser changes
  });

  it("ties a 訂正 to the issue it corrects; both are kept", async () => {
    const { db, keep } = await setup();
    const xml = fixture("vpfw50-390000-1100.xml");
    keep("20261117014218_0_VPFW50_390000", "VPFW50", xml);
    keep("20261117020000_0_VPFW50_390000", "VPFW50", xml.replace("<InfoType>発表</InfoType>", "<InfoType>訂正</InfoType>").replace(">くもり一時雨<", ">雨<"));
    await parseForecasts(db);
    // Read newest first, the 訂正 comes before the 発表: it is tied when the 発表 is read.
    expect(db.raw.prepare("SELECT issue_id, info_type, revision_of FROM forecast_issues ORDER BY issue_id").all()).toEqual([
      { issue_id: "20261117014218_0_VPFW50_390000", info_type: "発表", revision_of: null },
      { issue_id: "20261117020000_0_VPFW50_390000", info_type: "訂正", revision_of: "20261117014218_0_VPFW50_390000" },
    ]);
    expect(
      db.raw.prepare("SELECT issue_id, value FROM forecast_entries WHERE element = 'weather' AND valid_from = '2026-11-24T00:00:00+09:00' ORDER BY issue_id").all(),
    ).toEqual([
      { issue_id: "20261117014218_0_VPFW50_390000", value: "くもり一時雨" },
      { issue_id: "20261117020000_0_VPFW50_390000", value: "雨" },
    ]);
  });

  it("reads everything again from the kept XML to the same values (a new parser, N-5), a few a run, newest first", async () => {
    const { db, keep } = await setup();
    keep("w1", "VPFW50", fixture("vpfw50-390000-1100.xml"));
    keep("d1", "VPFD51", fixture("vpfd51-390000-1100.xml"));
    keep("d0", "VPFD51", fixture("vpfd51-390000-1700.xml"));
    await parseForecasts(db);
    const before = db.raw.prepare("SELECT * FROM forecast_entries ORDER BY issue_id, place, element, jma_type, valid_from, period").all();
    db.raw.prepare("UPDATE forecast_telegrams SET parser = 0").run(); // as a parser of a later version sees them
    expect(await parseForecasts(db, 2)).toEqual({ read: 2, failed: 0 });
    expect(db.raw.prepare("SELECT id FROM forecast_telegrams WHERE parser = 0").all()).toEqual([{ id: "d0" }]); // the oldest waits
    await parseForecasts(db, 2);
    expect(db.raw.prepare("SELECT * FROM forecast_entries ORDER BY issue_id, place, element, jma_type, valid_from, period").all()).toEqual(before);
  });
});

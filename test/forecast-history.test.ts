// 予報の履歴 (#250, R6): one day's issues and values for 「この日の予報の移り変わり」 (worker/src/forecastHistory.ts),
// read from the kept telegrams on a D1 stand-in: only the station's office and places, only the day's values,
// the issues from 8 days before to the day's end, and the fetch log of those days.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HISTORY_ELEMENTS } from "../shared/forecastHistory";
import { forecastHistory } from "../worker/src/forecastHistory";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { parseForecasts } from "../worker/src/forecastParse";
import { d1 } from "./d1";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");

async function kept() {
  const db = d1();
  await ensureForecastSchema(db);
  const keep = (id: string, kind: string, xml: string) =>
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, '390000', 'u', ?, '2026-11-17T02:00:00Z', 'h', ?)")
      .run(id, kind, /<ReportDateTime>([^<]+)</.exec(xml)?.[1] ?? null, xml);
  keep("d17", "VPFD51", fixture("vpfd51-390000-1700.xml"));
  keep("d05", "VPFD51", fixture("vpfd51-390000-0500.xml"));
  keep("d11", "VPFD51", fixture("vpfd51-390000-1100.xml"));
  keep("w11", "VPFW50", fixture("vpfw50-390000-1100.xml"));
  await parseForecasts(db, 50);
  const log = db.raw.prepare("INSERT INTO forecast_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, 'short', ?, 0, 0, 0, 0, ?)");
  log.run("2026-11-09T00:00:00Z", 1, null); // before the window
  log.run("2026-11-16T08:00:00Z", 0, "配信一覧：HTTP 503");
  log.run("2026-11-16T08:05:00Z", 1, null);
  return db;
}

describe("予報の履歴：1日分を返す", () => {
  it("gives the day's issues and only the day's values at the station's places", async () => {
    const db = await kept();
    const r = await forecastHistory(db, "47893", "2026-11-18");
    if (!r.supported) throw new Error("supported");
    expect(r.places).toEqual({ office: "390000", area: "390010", point: "74182" });
    expect(r.issues.map((i) => [i.issue_id, i.kind, i.issued_at])).toEqual([
      ["d17", "VPFD51", "2026-11-16T17:00:00+09:00"],
      ["d05", "VPFD51", "2026-11-17T05:00:00+09:00"],
      ["d11", "VPFD51", "2026-11-17T11:00:00+09:00"],
      ["w11", "VPFW50", "2026-11-17T11:00:00+09:00"],
    ]);
    expect(r.entries.length).toBeGreaterThan(0);
    for (const e of r.entries) {
      expect(e.valid_from.slice(0, 10)).toBe("2026-11-18");
      expect(["390000", "390010", "74182"]).toContain(e.place);
      expect(HISTORY_ELEMENTS).toContain(e.element);
    }
    // 府県天気予報 11時：中部の6時間降水確率が4つ、3時間ごとの天気、高知の最高・最低。
    const d11 = r.entries.filter((e) => e.issue_id === "d11");
    expect(d11.filter((e) => e.element === "pop").map((e) => e.valid_from.slice(11, 13))).toEqual(["00", "06", "12", "18"]);
    expect(d11.some((e) => e.element === "weather_3h")).toBe(true);
    expect(d11.filter((e) => e.element.startsWith("temp_")).every((e) => e.place === "74182")).toBe(true);
    // 他の区域（東部・西部）や他の地点は入らない。
    expect(new Set(r.entries.map((e) => e.place)).size).toBeLessThanOrEqual(3);
    expect(r.fetchLog.map((l) => l.at)).toEqual(["2026-11-16T08:00:00Z", "2026-11-16T08:05:00Z"]);
  });

  it("leaves out issues after the day and more than 8 days before it", async () => {
    const db = await kept();
    const r = await forecastHistory(db, "47893", "2026-11-17");
    if (!r.supported) throw new Error("supported");
    expect(r.issues.map((i) => i.issue_id)).toEqual(["d17", "d05", "d11", "w11"]);
    const early = await forecastHistory(db, "47893", "2026-11-08");
    if (!early.supported) throw new Error("supported");
    expect(early.issues).toEqual([]);
    expect(early.entries).toEqual([]);
  });

  it("says a station without known places is not supported, without guessing an area", async () => {
    const db = await kept();
    expect(await forecastHistory(db, "47662", "2026-11-18")).toEqual({ v: 1, station: "47662", date: "2026-11-18", supported: false });
  });
});

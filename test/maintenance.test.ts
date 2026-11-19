// データの保守（worker/src/maintenance.ts、refetch.ts）：エラーの記録（文言つき）、重なりを確かめる（読むだけ）、
// 取り直しのボタンは要る段だけ。
import { describe, expect, it } from "vitest";
import { dupCheck, maintenanceSummary, recentErrors } from "../worker/src/maintenance";
import { ensureHealthSchema, keepError, timed } from "../worker/src/health";
import { ensureSchema } from "../worker/src/accounts";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { ensureRadarSchema } from "../worker/src/radarArchive";
import { refetchSummary } from "../worker/src/refetch";
import { d1 } from "./d1";

const NOW = Date.parse("2026-11-19T01:00:00Z");

describe("エラーの記録", () => {
  it("アカウント・定時処理の段（文言つき）・取得の失敗を、新しい順に", async () => {
    const db = d1();
    await ensureHealthSchema(db);
    await ensureRadarSchema(db);
    await keepError(db, "/api/reports/sync", "Error: promise ended", NOW - 3_600_000);
    await timed(db, new Date(NOW - 1_800_000).toISOString(), "radar save", async () => {
      throw new Error("R2 put failed");
    });
    db.raw.prepare("INSERT INTO radar_fetch_log (at, ok, saved, waiting, error) VALUES (?, 0, 0, 9, 'hrpns x: HTTP 503')").run(new Date(NOW - 600_000).toISOString());
    const e = await recentErrors(db, NOW);
    expect(e.map((x) => [x.where, x.message])).toEqual([
      ["雨雲の保存", "hrpns x: HTTP 503"],
      ["定時処理 radar save", "Error: R2 put failed"],
      ["アカウント /api/reports/sync", "Error: promise ended"],
    ]);
  });
});

describe("重なりを確かめる", () => {
  it("同じ中身の電文・同じ発表時刻の2通（疑い）・肌感の送り直しの重なりを数え、何も消さない", async () => {
    const db = d1();
    await ensureSchema(db);
    await ensureForecastSchema(db);
    await ensureRadarSchema(db);
    const ins = db.raw.prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, 'VPFD51', '390000', 'u', ?, 'f', ?, 'x')");
    ins.run("a", "2026-11-18T11:00:00+09:00", "h1");
    ins.run("b", "2026-11-18T11:00:00+09:00", "h1"); // 同じ中身
    ins.run("c", "2026-11-18T17:00:00+09:00", "h2");
    const r = await dupCheck(db, NOW, "admin1");
    expect(r.find((x) => x.name.startsWith("予報の電文（同じ中身）"))).toMatchObject({ n: 1, examples: ["11/18 11:00（2行）"] });
    expect(r.find((x) => x.name.startsWith("予報の電文（同じ発表時刻"))).toMatchObject({ n: 1, note: expect.any(String) });
    expect(r.find((x) => x.name.startsWith("肌感"))?.n).toBe(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_telegrams").get()).toEqual({ n: 3 }); // 消さない
    const s = await maintenanceSummary(db, NOW, { hasBucket: true });
    expect(s.lastDupCheck?.result.length).toBe(r.length);
  });
});

describe("取り直しのボタンは要る段だけ", () => {
  it("取り残し・最後に取れてから間が空いている・まだ取り戻せる欠け、のどれかで要る", async () => {
    const db = d1();
    await ensureRadarSchema(db);
    const log = db.raw.prepare("INSERT INTO radar_fetch_log (at, ok, saved, waiting, error) VALUES (?, 1, 9, ?, NULL)");
    log.run(new Date(NOW - 300_000).toISOString(), 0);
    let s = (await refetchSummary(db, NOW, true)).stages[0];
    expect(s).toMatchObject({ id: "radar", needed: false, why: [] });
    s = (await refetchSummary(db, NOW, true, { radar: 2 })).stages[0];
    expect(s).toMatchObject({ needed: true, why: ["まだ取り戻せる欠け 2"] });
    s = (await refetchSummary(db, NOW + 20 * 60_000, true)).stages[0];
    expect(s.why).toEqual(["最後に取れてから間が空いている"]);
    log.run(new Date(NOW - 60_000).toISOString(), 18);
    expect((await refetchSummary(db, NOW, true)).stages[0].why).toEqual(["取り残し 18"]);
  });
});

import { tableAudit } from "../worker/src/maintenance";
import { ensureForecastParseSchema } from "../worker/src/forecastParse";
describe("表の点検（読むだけ）", () => {
  it("表ごとの行数と、つながりの切れを数え、何も消さない。結果は保守の画面に残る", async () => {
    const db = d1();
    await ensureSchema(db);
    await ensureForecastParseSchema(db);
    db.raw.prepare("INSERT INTO forecast_issues (issue_id, source, office, kind, issued_at, preferred, parser, entries) VALUES ('x1', 'jma-xml', '390000', 'VPFD51', '2026-11-18T11:00:00+09:00', 1, 1, 0)").run();
    const r = await tableAudit(db, NOW, "admin1");
    expect(r.tables.find((t) => t.name === "forecast_issues")?.rows).toBe(1);
    expect(r.links.find((l) => l.name.startsWith("自前の発表で"))?.n).toBe(1); // 電文の無い発表
    expect(r.links.find((l) => l.name.startsWith("肌感の記録で"))?.n).toBe(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_issues").get()).toEqual({ n: 1 });
    expect((await maintenanceSummary(db, NOW, { hasBucket: true })).lastAudit?.result.links.length).toBe(r.links.length);
  });
});

import { readCompleteness } from "../worker/src/completeness";
describe("公開直後（新しい列がまだ無い）でも読める", () => {
  it("取り戻した印の列が無い古い data_gaps でも、readCompleteness が版を当てて読む", async () => {
    const db = d1();
    db.raw.exec("CREATE TABLE data_gaps (source TEXT NOT NULL, item TEXT NOT NULL, found_at TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY (source, item))");
    db.raw.prepare("INSERT INTO data_gaps VALUES ('radar:hrpns', '2026-11-18T07:00:00+09:00', 'x', 'y')").run();
    const c = await readCompleteness(db, NOW);
    expect(c.lostAll).toEqual([{ source: "radar:hrpns", n: 1 }]);
  });
  it("データの保守は、1つの部分が失敗しても残りを出し、失敗した部分と文言を並べる", async () => {
    const db = d1();
    const broken = { ...db, prepare: (q: string) => (/FROM refetch_log WHERE stage = 'audit'/.test(q) ? { bind: () => ({ all: async () => Promise.reject(new Error("D1_ERROR: boom")) }) } : db.prepare(q)) } as never;
    const s = await maintenanceSummary(broken, NOW, { hasBucket: true });
    expect(s.failed).toEqual([{ part: "表の点検", message: "Error: D1_ERROR: boom" }]);
    expect(s.refetch.stages.length).toBe(4);
  });
});

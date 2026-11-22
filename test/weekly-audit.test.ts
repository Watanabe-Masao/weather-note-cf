// 週の点検（worker/src/weeklyAudit.ts、#370）：全期間で「最新」と「履歴」を分けて数える。R2 の実物を確かめる。読むだけ。
import { describe, expect, it } from "vitest";
import { claimWeeklyAudit, lastWeeklyAudit, runWeeklyAudit, slotsBetween, weeklyAuditLastAt, weeklyAuditLines } from "../worker/src/weeklyAudit";
import { ensureAmedasSchema } from "../worker/src/amedasArchive";
import { ensureRadarSchema } from "../worker/src/radarArchive";
import { type Bucket, ensureR2Schema } from "../worker/src/r2Archive";
import { ensureAirSchema } from "../worker/src/airQuality";
import { ensureSoramameSchema } from "../worker/src/soramame";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { ensureLongRangeSchema } from "../worker/src/longRangeArchive";
import { ensureCompletenessSchema } from "../worker/src/completeness";
import { maintenanceSummary } from "../worker/src/maintenance";
import { judgeHealth } from "../shared/healthJudge";
import { d1 } from "./d1";

const H = 3_600_000;
// 2026-11-22 03:10（日本時間）
const NOW = Date.parse("2026-11-21T18:10:00Z");
const jst = (ms: number) => `${new Date(ms + 9 * H).toISOString().slice(0, 19)}+09:00`;

function bucket(files: Map<string, number>): Bucket {
  return {
    async put() {},
    async get(key) {
      const n = files.get(key);
      return n == null ? null : { arrayBuffer: async () => new ArrayBuffer(n) };
    },
  };
}

async function seeded() {
  const db = d1();
  for (const f of [ensureAmedasSchema, ensureRadarSchema, ensureR2Schema, ensureAirSchema, ensureSoramameSchema, ensureForecastSchema, ensureLongRangeSchema, ensureCompletenessSchema]) await f(db);
  const files = new Map<string, number>();
  // アメダス：3時間ごと、5日分。2つのブロック（11/19 9時・12時）が抜けている。
  const am = db.raw.prepare("INSERT INTO amedas_saved (key, point, block_at, times, bytes, sha256, fetched_at) VALUES (?, '74182', ?, 18, 100, 's', 'f')");
  const end = Date.parse("2026-11-22T00:00:00+09:00");
  for (let t = end - 5 * 24 * H; t <= end; t += 3 * H) {
    const at = jst(t);
    if (at.startsWith("2026-11-19T09") || at.startsWith("2026-11-19T12")) continue;
    am.run(`amedas/${at}`, at);
    files.set(`amedas/${at}`, 100);
  }
  // 天気図（実況）：3〜21時の7回。0時は元から無いので抜けではない。
  const wx = db.raw.prepare("INSERT INTO wxchart_saved (key, kind, valid_at, base_at, url, bytes, sha256, fetched_at) VALUES (?, 'quick', ?, NULL, 'u', 50, 's', 'f')");
  for (const d of ["2026-11-20", "2026-11-21"]) for (const h of [3, 6, 9, 12, 15, 18, 21]) wx.run(`wx/${d}/${h}`, `${d}T${String(h).padStart(2, "0")}:00:00+09:00`);
  // そらまめ：1〜24時。11/20 の 5時だけ抜け。最新は11/21 24時（＝11/22 0時）。
  const so = db.raw.prepare("INSERT INTO soramame_hourly (station, date, hour, fetched_at) VALUES ('39201350', ?, ?, 'f')");
  for (const d of ["2026-11-20", "2026-11-21"]) for (let h = 1; h <= 24; h++) if (!(d === "2026-11-20" && h === 5)) so.run(d, h);
  // 予報の電文：5・11・17時。11/20 の 11時と17時が無い（5時から翌5時まで24時間）→ 1か所。最新は2日前なので「遅れ」。
  const fc = db.raw.prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, 'VPFD51', '390000', 'u', ?, 'f', ?, 'x')");
  for (const at of ["2026-11-19T05:00:00+09:00", "2026-11-19T11:00:00+09:00", "2026-11-19T17:00:00+09:00", "2026-11-20T05:00:00+09:00", "2026-11-21T05:00:00+09:00"]) fc.run(at, at, at);
  // 欠けの累計
  db.raw.prepare("INSERT INTO data_gaps (source, item, found_at, detail) VALUES ('radar:hrpns', '2026-11-18T10:00:00+09:00', 'f', 'd')").run();
  db.raw.prepare("INSERT INTO data_absent (source, item, found_at) VALUES ('forecast:VPFW50', '2026-11-18T11:00:00+09:00', 'f')").run();
  return { db, files };
}

describe("週の点検", () => {
  it("抜けた回を全期間で数え、最新と履歴を分ける", async () => {
    const { db, files } = await seeded();
    const r = await runWeeklyAudit(db, bucket(files), NOW);
    const am = r.series.find((s) => s.id === "amedas")!;
    expect(am).toMatchObject({ part: "74182", missing: 2, gapCount: 1, fresh: true });
    expect(am.gaps[0]).toMatchObject({ from: "2026-11-19T06:00:00+09:00", to: "2026-11-19T15:00:00+09:00", n: 2 });
    expect(r.series.find((s) => s.id === "wxchart")).toMatchObject({ missing: 0, gapCount: 0 });
    const so = r.series.find((s) => s.id === "soramame")!;
    expect(so).toMatchObject({ missing: 1, gapCount: 1, have: 47, fresh: true });
    const fc = r.series.find((s) => s.id === "forecast")!;
    expect(fc).toMatchObject({ part: "VPFD51 390000", missing: null, gapCount: 1, fresh: false });
    // 表がまだ無い系列は飛ばす（失敗にしない）。空の表は系列が出ない。
    expect(r.failed).toEqual([]);
    expect(r.series.some((s) => s.id === "radar")).toBe(false);
    expect(r).toMatchObject({ latestOk: false, historyOk: false });
    expect(r.holes).toEqual([
      { source: "forecast:VPFW50", lost: 0, recovered: 0, absent: 1 },
      { source: "radar:hrpns", lost: 1, recovered: 0, absent: 0 },
    ]);
    // R2：アメダスの実物はある。天気図は置いていない（無い）。
    expect(r.r2?.checked).toBe(20);
    expect(r.r2!.missing.every((k) => k.startsWith("wx/"))).toBe(true);
    // 読むだけ
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM amedas_saved").get()).toEqual({ n: 39 });
  });

  it("R2 の大きさが記録とちがえば挙げる", async () => {
    const { db, files } = await seeded();
    db.raw.prepare("DELETE FROM wxchart_saved").run();
    for (const k of files.keys()) files.set(k, 99);
    const r = await runWeeklyAudit(db, bucket(files), NOW);
    expect(r.r2!.wrongSize.length).toBe(r.r2!.checked);
  });

  it("日本時間の3時台に、約1週間ごとに1回だけ取る", async () => {
    const db = d1();
    expect(await claimWeeklyAudit(db, NOW - H)).toBe(false); // 2時台
    expect(await claimWeeklyAudit(db, NOW)).toBe(true);
    expect(await claimWeeklyAudit(db, NOW + 5 * 60_000)).toBe(false);
    expect(await claimWeeklyAudit(db, NOW + 6 * 24 * H)).toBe(false);
    expect(await claimWeeklyAudit(db, NOW + 7 * 24 * H)).toBe(true);
    // 管理者のボタンは時間帯を問わず、1分に1回まで
    expect(await claimWeeklyAudit(db, NOW + 7 * 24 * H + 30_000, true)).toBe(false);
    expect(await claimWeeklyAudit(db, NOW + 7 * 24 * H + 90_000, true)).toBe(true);
  });

  it("結果は保守の画面・毎朝の点検・見張りに出る", async () => {
    const { db, files } = await seeded();
    expect(await weeklyAuditLastAt(db)).toBeUndefined();
    expect(weeklyAuditLines(await lastWeeklyAudit(db))).toEqual(["・週の点検：まだ一度も動いていません。"]);
    await claimWeeklyAudit(db, NOW);
    await runWeeklyAudit(db, bucket(files), NOW, new Date(NOW).toISOString());
    expect((await db.raw.prepare("SELECT COUNT(*) AS n FROM weekly_audit").get()) as { n: number }).toEqual({ n: 1 });
    const last = await lastWeeklyAudit(db);
    const line = weeklyAuditLines(last)[0];
    expect(line).toContain("週の点検（2026/11/22）");
    expect(line).toContain("遅れ 1（予報の電文）");
    expect(line).toContain("アメダスの観測（10分値の原本） 2回");
    expect(line).toContain("予報の電文 1か所");
    const s = await maintenanceSummary(db, NOW, { hasBucket: true });
    expect(s.weeklyAudit?.result.series.length).toBe(last?.result.series.length);
    const at = await weeklyAuditLastAt(db);
    const view = (n: number) => ({
      state: { forecastLastOk: new Date(n).toISOString(), typhoonLastOk: new Date(n).toISOString(), openAlerts: [], accountErrorsLastDay: [], weeklyAuditAt: at },
      room: { d1Size: null, d1WritesMonth: { percent: 1 }, r2: { percentOfFree: 1 }, cron: { runsLastDay: 288, stages: [] } },
      waste: { unparsed: 0, parseFailed: 0, fetchFailuresLastDay: 0 },
    });
    const keys = (n: number) => judgeHealth(view(n) as never, n).notes.map((x) => x.key);
    // 終わった時刻（done_at）は実際の時計で書かれるので、NOW ではなくその時刻から数える（11/23：実行した日が進むと
    // NOW + 9 日がまだ 8 日を超えず、テストが落ちた）。
    const done = Date.parse(at ?? "");
    expect(keys(done + 7 * 24 * H)).not.toContain("weeklyAuditStale");
    expect(keys(done + 9 * 24 * H)).toContain("weeklyAuditStale");
  });

  it("数える時刻だけを数える（天気図の 21時→翌3時は抜けではない）", () => {
    const t = (s: string) => Date.parse(s);
    const keep = (ms: number) => new Date(ms + 9 * H).getUTCHours() !== 0;
    expect(slotsBetween(t("2026-11-20T21:00:00+09:00"), t("2026-11-21T03:00:00+09:00"), 3 * H, keep)).toBe(0);
    expect(slotsBetween(t("2026-11-20T21:00:00+09:00"), t("2026-11-21T06:00:00+09:00"), 3 * H, keep)).toBe(1);
    expect(slotsBetween(t("2026-11-20T01:00:00+09:00"), t("2026-11-20T04:00:00+09:00"), H)).toBe(2);
  });
});

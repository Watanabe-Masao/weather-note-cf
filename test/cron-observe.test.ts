// 定時処理の観測（2026-11-18、#297 のあと）：段の時間を D1 の待ちとそれ以外に分ける、D1 とは別にログへ書く、
// Cloudflare 自身の記録（workersInvocationsScheduled）と D1 の記録を照らし合わせる。

import { describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../worker/src/accounts";
import { digestMessage, digestExtra } from "../worker/src/dailyDigest";
import { ensureHealthSchema, health, markStart, metered, timed } from "../worker/src/health";
import { scheduledRuns } from "../worker/src/usage";
import { d1 } from "./d1";

const NOW = Date.parse("2026-11-18T00:12:00Z");

describe("段の時間：D1 の待ちを分ける", () => {
  it("D1 に待った時間を数え（prepare・batch とも）、cron_runs の d1_ms と、D1 とは別のログに書く", async () => {
    const db = d1();
    await ensureHealthSchema(db);
    const m = metered(db);
    await m.db.prepare("SELECT 1").first();
    await m.db.batch([m.db.prepare("SELECT 1"), m.db.prepare("SELECT 2")]);
    expect(m.ms()).toBeGreaterThanOrEqual(0);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const at = new Date(NOW).toISOString();
    await markStart(db, at, 1234);
    await timed(db, at, "a", async (d) => void (await d.prepare("SELECT 1").first()));
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    log.mockRestore();
    expect(lines[0]).toEqual({ wn: "cron-start", at, lateMs: 1234 });
    expect(lines[1]).toMatchObject({ wn: "cron-stage", at, stage: "a", ok: 1 });
    expect(typeof lines[1].d1Ms).toBe("number");
    expect(db.raw.prepare("SELECT stage, ms, ok, d1_ms IS NOT NULL AS d FROM cron_runs WHERE stage = 'a'").get()).toMatchObject({ stage: "a", ok: 1, d: 1 });
    expect(db.raw.prepare("SELECT ms FROM cron_runs WHERE stage = 'start'").get()).toEqual({ ms: 1234 });
  });
  it("前からある cron_runs（d1_ms なし）にも列を足す", async () => {
    const db = d1();
    db.raw.exec("CREATE TABLE cron_runs (at TEXT NOT NULL, stage TEXT NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL, PRIMARY KEY (at, stage))");
    await ensureHealthSchema(db);
    await timed(db, new Date(NOW).toISOString(), "b", async () => {});
    expect(db.raw.prepare("SELECT stage FROM cron_runs").all()).toEqual([{ stage: "b" }]);
  });
});

/** Cloudflare の GraphQL の作り物：workersInvocationsScheduled だけ答え、ほかは空。 */
function cf(rows: { scheduledDatetime: string; status: string; cpuTimeUs: number }[] | "error") {
  const asked: string[] = [];
  const post = async (_u: string, init: RequestInit) => {
    const q = JSON.parse(String(init.body)).query as string;
    asked.push(q);
    if (q.includes("workersInvocationsScheduled"))
      return rows === "error"
        ? { ok: true, status: 200, json: async () => ({ data: null, errors: [{ message: "unknown field" }] }) }
        : { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{ s: rows }] } }, errors: null }) };
    return { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{ w: [], q: [], s: [], o: [] }] } }, errors: null }) };
  };
  return { post, asked };
}
const ENV = { CF_ANALYTICS_TOKEN: "t", CF_ACCOUNT_ID: "a" };

describe("Cloudflare 自身の記録", () => {
  it("始めた回を時刻で数え、状態ごとにまとめる。空は空、読めないは読めない（0回と言わない）", async () => {
    const w = { from: "2026-11-17T00:05:00.000Z", to: "2026-11-18T00:00:00.000Z" };
    const ok = await scheduledRuns(ENV, w, cf([
      { scheduledDatetime: "2026-11-17T23:55:00Z", status: "success", cpuTimeUs: 120_000 },
      { scheduledDatetime: "2026-11-17T23:50:00Z", status: "exceededCpu", cpuTimeUs: 30_000_000 },
    ]).post);
    expect(ok).toEqual({ ok: true, value: { empty: false, runs: 2, times: ["2026-11-17T23:55:00.000Z", "2026-11-17T23:50:00.000Z"], byStatus: { success: 1, exceededCpu: 1 }, cpuMaxUs: 30_000_000 } });
    expect(await scheduledRuns(ENV, w, cf([]).post)).toMatchObject({ ok: true, value: { empty: true, runs: 0 } });
    expect(await scheduledRuns(ENV, w, cf("error").post)).toEqual({ ok: false, error: "unknown field" });
    expect(await scheduledRuns({}, w)).toMatchObject({ ok: false });
  });
  it("/api/health：Cloudflare が始めたのに D1 に残らなかった回と、始まらなかった回を分ける", async () => {
    const db = d1();
    await ensureSchema(db);
    await ensureHealthSchema(db);
    const slot = (k: number) => new Date(Date.parse("2026-11-18T00:00:00Z") - k * 300_000).toISOString();
    // D1：k=1..3 が無い。Cloudflare：k=1 は始めた（D1 に書けなかった）、k=2・3 は始めていない
    for (let k = 0; k < 288; k++) if (![1, 2, 3].includes(k)) db.raw.prepare("INSERT INTO cron_runs (at, stage, ms, ok) VALUES (?, 'notify', 10, 1)").run(slot(k));
    const rows = Array.from({ length: 288 }, (_, k) => k).filter((k) => ![2, 3].includes(k)).map((k) => ({ scheduledDatetime: slot(k), status: "success", cpuTimeUs: 1000 }));
    const h = await health(db, NOW, ENV, cf(rows).post as never);
    expect(h.room.cron).toMatchObject({ kept: 285, missing: 3, cloudflare: { ok: true, runs: 286, startedNotKept: 1, notStarted: 2 } });
    const lines = await digestExtra(db, NOW, h.room.cron.cloudflare);
    expect(lines.find((l) => l.startsWith("・Cloudflare の記録"))).toBe("・Cloudflare の記録：始めた回 286回（success 286）・計算時間の最長 1ms。始めたのに D1 に残らなかった回 1・始まらなかった回 2");
    expect(digestMessage([], [], [], ["・Cloudflare の記録：空でした"]).body).toContain("空でした");
  });
});

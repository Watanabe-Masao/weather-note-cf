// 毎時の見張り (worker/src/healthWatch.ts) on a D1 stand-in: once an hour in the 5-minute run, /api/health
// judged with the same judgment as scripts/health-check.mjs (shared/healthJudge.ts); a problem told to
// the administrators when it starts and when it is over (not every hour), the record's month told once,
// and the last look given by /api/health (counts and times only).

import { describe, expect, it } from "vitest";
import { judgeHealth } from "../shared/healthJudge";
import { ensureSchema } from "../worker/src/accounts";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { ensureForecastWatchSchema } from "../worker/src/forecastWatch";
import { health } from "../worker/src/health";
import { claimHealthWatch, watchHealth } from "../worker/src/healthWatch";
import { ensureTyphoonSchema } from "../worker/src/typhoonArchive";
import type { Subscription } from "../worker/src/webpush";
import { d1 } from "./d1";

const T0 = Date.parse("2026-11-17T12:00:00+09:00");
const MIN = 60_000;
const H = 60 * MIN;

async function setup() {
  const db = d1();
  await ensureSchema(db);
  await ensureForecastSchema(db);
  await ensureTyphoonSchema(db);
  const user = (id: string, role: string) =>
    db.raw
      .prepare("INSERT INTO users (id, login_id, role, pw_hash, pw_salt, pw_iter, research_id, created_at) VALUES (?, ?, ?, 'h', 's', 1, ?, 0)")
      .run(id, id, role, `r${id}`);
  user("A", "admin");
  user("U", "user");
  for (const [u, e] of [
    ["A", "https://push.test/admin"],
    ["U", "https://push.test/user"],
  ])
    db.raw.prepare("INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, 'p', 'a', 0)").run(e, u);
  const told: { to: string; title: string; body: string }[] = [];
  const send = async (s: Subscription, m: unknown) => {
    const msg = m as { title: string; body: string };
    told.push({ to: s.endpoint, title: msg.title, body: msg.body });
    return 201;
  };
  /** The archives' runs that went well, at `t` (so 予報・台風 are not stale). */
  const fetched = (t: number) => {
    const at = new Date(t).toISOString();
    db.raw.prepare("INSERT INTO forecast_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, 'short', 1, 10, 0, 0, 0, NULL)").run(at);
    db.raw.prepare("INSERT INTO typhoon_fetch_log (at, feed, ok, entries, typhoon_entries, added, error) VALUES (?, 'short', 1, 10, 0, 0, NULL)").run(at);
  };
  /** The record: 404 (not yet) unless `has`. */
  let recordHas = false;
  let asked = 0;
  const head = async () => (asked++, recordHas ? { ok: true, status: 200 } : { ok: false, status: 404 });
  const look = (t: number) => watchHealth(db, t, {}, { send, head });
  return {
    db,
    told,
    fetched,
    look,
    record: (v: boolean) => (recordHas = v),
    asked: () => asked,
  };
}

describe("毎時の見張り：1時間に1回", () => {
  it("takes the look when none was taken in the 60 minutes before, once for a moment", async () => {
    const { db } = await setup();
    expect(await claimHealthWatch(db, T0)).toBe(true);
    expect(await claimHealthWatch(db, T0)).toBe(false); // the same run twice
    for (let m = 5; m < 60; m += 5) expect(await claimHealthWatch(db, T0 + m * MIN)).toBe(false);
    expect(await claimHealthWatch(db, T0 + 60 * MIN)).toBe(true);
    expect(await claimHealthWatch(db, T0 + 65 * MIN)).toBe(false);
  });
});

describe("毎時の見張り：異常を知らせる", () => {
  it("tells the administrators when a problem starts and when it is over, not every hour while it stays", async () => {
    const s = await setup();
    // Nothing fetched yet: 予報 and 台風 are stale (予報's is told by forecastWatch.ts, not here).
    let r = await s.look(T0);
    expect(r.problems).toBe(2);
    expect(r.opened).toEqual(["typhoonStale"]);
    expect(s.told).toHaveLength(1);
    expect(s.told[0]).toMatchObject({ to: "https://push.test/admin", title: "監視：異常が1件あります" });
    expect(s.told[0].body).toContain("台風の電文を最後に取れたのは 記録なし");
    expect(s.told[0].body).not.toContain("予報");

    // An hour on, the same problems (their text has moved on): not told again.
    r = await s.look(T0 + H);
    expect(r).toMatchObject({ problems: 2, opened: [], closed: [] });
    expect(s.told).toHaveLength(1);

    // Fetched again: over, told once.
    s.fetched(T0 + 2 * H - 5 * MIN);
    r = await s.look(T0 + 2 * H);
    expect(r).toMatchObject({ problems: 0, opened: [] });
    expect(r.closed).toEqual(["typhoonStale"]);
    expect(s.told).toHaveLength(2);
    expect(s.told[1].title).toBe("監視：1件 直りました");
    expect(s.told[1].body).toContain("直りました：台風の電文を最後に取れたのは");
    await s.look(T0 + 2 * H + 20 * MIN); // still all right: nothing told
    expect(s.told).toHaveLength(2);

    // Stale again later: a new one, told again (the closed one kept, renamed).
    r = await s.look(T0 + 5 * H);
    expect(r.opened).toEqual(["typhoonStale"]);
    expect(s.told).toHaveLength(3);
    const rows = s.db.raw.prepare("SELECT key, closed_at IS NULL AS open, sent FROM health_alerts WHERE kind = 'problem' ORDER BY key").all();
    expect(rows).toEqual([
      { key: "typhoonStale", open: 1, sent: 1 },
      { key: `typhoonStale@${new Date(T0).toISOString()}`, open: 0, sent: 1 },
    ]);
    // Nothing of the app's address or of a person in what is told.
    for (const t of s.told) expect(t.title + t.body).not.toMatch(/https?:|@/);
  });

  it("keeps each look's counts, and /api/health gives the last one (time and counts only)", async () => {
    const s = await setup();
    expect((await health(s.db, T0)).state.watch).toBeNull();
    await claimHealthWatch(s.db, T0);
    await s.look(T0);
    const w = (await health(s.db, T0 + MIN)).state.watch;
    // Counted with what is told elsewhere (forecastStale), opened only what is told here.
    expect(w).toEqual({ at: new Date(T0).toISOString(), finished: true, problems: 2, notes: expect.any(Number), opened: 1, closed: 0, sent: 1 });
    // A look taken but not ended says so.
    await claimHealthWatch(s.db, T0 + H);
    expect((await health(s.db, T0 + H)).state.watch).toMatchObject({ at: new Date(T0 + H).toISOString(), finished: false, problems: null });
  });
});

describe("毎時の見張り：1つの出来事には1つの知らせ (#271)", () => {
  it("does not tell an open alert of another watch, nor the forecast feed's stop (forecastWatch.ts tells them)", async () => {
    const s = await setup();
    s.fetched(T0 - 5 * MIN);
    await ensureForecastWatchSchema(s.db);
    s.db.raw
      .prepare("INSERT INTO forecast_alerts (key, kind, opened_at, closed_at, detail) VALUES ('fetch', 'fetch', ?, NULL, '{}')")
      .run(new Date(T0 - H).toISOString());
    await claimHealthWatch(s.db, T0);
    const r = await s.look(T0);
    expect(r).toMatchObject({ problems: 1, opened: [], sent: 0 });
    expect(s.told).toEqual([]);
    expect(s.db.raw.prepare("SELECT COUNT(*) AS n FROM health_alerts").get()).toEqual({ n: 0 });
    expect((await health(s.db, T0 + MIN)).state.watch).toMatchObject({ problems: 1, opened: 0 });
  });
});

describe("毎時の見張り：取り込める月 (#262)", () => {
  it("tells once when the record has the month to take next", async () => {
    const s = await setup();
    s.fetched(T0 - 5 * MIN);
    let r = await s.look(T0);
    expect(r.importTold).toBeNull();
    expect(s.asked()).toBe(1); // one question to the record a look, as the script
    expect(s.told).toHaveLength(0);
    s.record(true);
    s.fetched(T0 + H - 5 * MIN);
    r = await s.look(T0 + H);
    expect(r.importTold).toMatch(/^\d{4}-\d{2}$/);
    expect(s.told).toEqual([{ to: "https://push.test/admin", title: `取り込める月があります：${r.importTold}`, body: expect.stringContaining("管理画面") }]);
    expect(s.told[0].body).not.toMatch(/https?:|@/);
    s.fetched(T0 + 2 * H - 5 * MIN);
    r = await s.look(T0 + 2 * H);
    expect(r.importTold).toBeNull();
    expect(s.told).toHaveLength(1);
    // Not an open alert (it does not come back as「アプリの警告が開いたまま」).
    expect((await health(s.db, T0 + 2 * H)).state.openAlerts).toEqual([]);
  });

  it("tells nothing when the record could not be asked (a note, 確かめられなかった)", async () => {
    const s = await setup();
    s.fetched(T0 - 5 * MIN);
    const r = await watchHealth(s.db, T0, {}, {
      send: async () => 201,
      head: async () => {
        throw new Error("fetch failed");
      },
    });
    expect(r.importTold).toBeNull();
    const h = await health(s.db, T0);
    const j = judgeHealth(h, T0, { ...h.state.forecastImport, available: null, reason: "fetch failed" });
    expect(j.notes.map((n) => n.key)).toContain("importUnknown");
  });
});

describe("監視の判断 (shared/healthJudge.ts)", () => {
  it("keeps a finding's key while its text moves on with the hours", async () => {
    const s = await setup();
    const h = await health(s.db, T0);
    s.fetched(T0 - 2 * H);
    const a = judgeHealth(await health(s.db, T0), T0);
    const b = judgeHealth(await health(s.db, T0 + H), T0 + H);
    const stale = (j: typeof a) => j.problems.find((p) => p.key === "forecastStale");
    expect(stale(a)?.text).toContain("2.0時間前");
    expect(stale(b)?.text).toContain("3.0時間前");
    expect(judgeHealth(h, T0).problems.map((p) => p.key).sort()).toEqual(["forecastStale", "typhoonStale"]);
  });
});

describe("毎朝の点検（dailyDigest.ts）", () => {
  const T7 = Date.parse("2026-11-18T07:10:00+09:00");
  it("7時より後の最初の見張りで1通だけ。この24時間の回数と、異常・気づいたことを書く", async () => {
    const s = await setup();
    // 前の日の24時間：予報・台風は5分ごとにうまくいった（1回だけ失敗）
    for (let t = T7 - 24 * H + 5 * MIN; t < T7; t += 5 * MIN) s.fetched(t);
    s.db.raw.prepare("UPDATE forecast_fetch_log SET ok = 0 WHERE at = ?").run(new Date(T7 - 60 * MIN).toISOString());
    s.db.raw.prepare("UPDATE forecast_fetch_log SET added = 3 WHERE at = ?").run(new Date(T7 - 30 * MIN).toISOString());
    const r = await s.look(T7);
    expect(r.digest).toBe("daily:2026-11-18");
    const d = s.told.filter((t) => t.title.startsWith("毎朝の点検"));
    expect(d.map((t) => t.to)).toEqual(["https://push.test/admin"]);
    expect(d[0].title).toBe("毎朝の点検：うまくいかなかった回があります");
    expect(d[0].body).toContain("・予報の電文：287回中286回うまくいった（新しく3通）");
    expect(d[0].body).toContain("・台風の電文：287回中287回うまくいった（新しく0通）");
    expect(d[0].body).toContain("・毎時の見張り：");
    // 同じ日の次の見張りでは送らない
    expect((await s.look(T7 + 61 * MIN)).digest).toBeNull();
    expect(s.told.filter((t) => t.title.startsWith("毎朝の点検"))).toHaveLength(1);
  });
  it("7時より前・10時より後は送らない（昼に遅れて届かないように）", async () => {
    const s = await setup();
    for (let t = T0 - 2 * H; t <= T0 + 2 * H; t += 5 * MIN) s.fetched(t);
    expect((await s.look(Date.parse("2026-11-18T06:55:00+09:00"))).digest).toBeNull();
    expect((await s.look(Date.parse("2026-11-18T10:05:00+09:00"))).digest).toBeNull();
  });
});

describe("毎朝の点検の題", () => {
  it("異常・うまくいかなかった回・気づいたこと・問題なしで変える。動いていない取得はそう書く", async () => {
    const { digestMessage } = await import("../worker/src/dailyDigest");
    const ok = [{ name: "予報の電文", runs: 288, ok: 288, added: 20, unit: "通" }];
    expect(digestMessage(ok, [], []).title).toBe("毎朝の点検：問題なし");
    expect(digestMessage(ok, [], [{ key: "x", text: "R2 が8割" }]).title).toBe("毎朝の点検：問題なし（気づいたこと1件）");
    expect(digestMessage(ok, [{ key: "y", text: "止まっている" }], []).title).toBe("毎朝の点検：異常が1件あります");
    const idle = digestMessage([{ name: "天気図", runs: 0, ok: 0, added: 0, unit: "枚" }], [], []);
    expect(idle.title).toBe("毎朝の点検：うまくいかなかった回があります");
    expect(idle.body).toBe("・天気図：この24時間に1回も動いていません");
  });
});

describe("定時処理の抜け（health.ts cronGaps、2026-11-18）", () => {
  it("決まった窓（最後が今から10分以上前の288回）のうち、記録の無い回を、続いた抜けにまとめる（新しい順）", async () => {
    const { cronGaps } = await import("../worker/src/health");
    const { gapText } = await import("../shared/healthJudge");
    const now = Date.parse("2026-11-18T00:12:00Z");
    // 窓の最後は 00:00Z（00:12 − 10分 → 00:02 の5分の頭）、最初はその 287 回前
    const slot = (k: number) => new Date(Date.parse("2026-11-18T00:00:00Z") - k * 300_000).toISOString();
    const ats = Array.from({ length: 288 }, (_, k) => k).filter((k) => ![1, 2, 3, 10].includes(k)).map(slot);
    ats.push("2026-11-18T00:05:00.000Z", "2026-11-18T00:10:00.000Z"); // 窓の外（まだ続いているかもしれない回）は数えない
    const g = cronGaps(ats, now);
    expect(g.window).toEqual({ from: slot(287), to: slot(0), runs: 288 });
    expect([g.kept, g.missing]).toEqual([284, 4]);
    expect(g.gaps).toEqual([
      { from: slot(3), to: slot(1), n: 3 },
      { from: slot(10), to: slot(10), n: 1 },
    ]);
    // 日本時間で、大きい順
    expect(gapText(g.gaps)).toBe("抜けた時間：11/18 8:45〜8:55（3回）・11/18 8:10。");
    expect(cronGaps(Array.from({ length: 288 }, (_, k) => slot(k)), now)).toMatchObject({ kept: 288, missing: 0, gaps: [] });
  });
  it("毎朝の点検に、定時処理の回数と抜け、失敗の文言（管理者だけ）を書く", async () => {
    const s = await setup();
    const T7 = Date.parse("2026-11-18T07:10:00+09:00");
    const { ensureHealthSchema } = await import("../worker/src/health");
    await ensureHealthSchema(s.db);
    for (let t = T7 - 24 * H + 5 * MIN; t < T7; t += 5 * MIN) {
      if (t >= T7 - 3 * H && t < T7 - 2 * H) continue; // 1時間（12回）抜け
      s.fetched(t);
      s.db.raw.prepare("INSERT INTO cron_runs (at, stage, ms, ok) VALUES (?, 'notify', 100, 1)").run(new Date(Math.floor(t / (5 * MIN)) * 5 * MIN).toISOString());
    }
    s.db.raw.prepare("INSERT INTO app_errors (at, place, message) VALUES (?, '/api/reports/sync', 'Error: D1_ERROR: overloaded')").run(new Date(T7 - 2 * H).toISOString());
    s.db.raw.prepare("INSERT INTO app_errors (at, place, message) VALUES (?, '/api/auth/me', 'Error: D1_ERROR: overloaded')").run(new Date(T7 - H).toISOString());
    await s.look(T7);
    const d = s.told.find((t) => t.title.startsWith("毎朝の点検"))!;
    expect(d.body).toMatch(/・定時処理（5分ごと、11\/17 7:\d\d〜11\/18 7:\d\d の288回）：記録あり \d+回。記録の無い回：11\/18 4:\d\d〜5:\d\d（12回）/);
    expect(d.body).toContain("・アカウントの処理の失敗 2回（5:10〜6:10、");
    expect(d.body).toContain("：Error: D1_ERROR: overloaded");
  });
});

describe("毎朝の点検：雨雲レーダー・解析雨量の欠け（2026-11-18）", () => {
  it("30分ごとの48時刻のうち、9枚そろっていない時刻を欠けとして書く", async () => {
    const s = await setup();
    const T7 = Date.parse("2026-11-18T07:10:00+09:00");
    const { ensureRadarSchema } = await import("../worker/src/radarArchive");
    await ensureRadarSchema(s.db);
    const jst = (ms: number) => `${new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;
    // 数える時刻：6:00 から 30分ずつ48個さかのぼる（今から1時間以内は数えない）
    const end = Date.parse("2026-11-18T06:00:00+09:00");
    for (let k = 0; k < 48; k++) {
      const t = end - k * 1_800_000;
      for (const p of ["hrpns", "rasrf"]) {
        const tiles = p === "hrpns" && k === 2 ? 5 : p === "rasrf" && k === 0 ? 0 : 9; // 5:00 のレーダーは5枚だけ、6:00 の解析雨量は無し
        for (let i = 0; i < tiles; i++)
          s.db.raw.prepare("INSERT INTO radar_saved (key, valid_at, jma_time, z, x, y, bytes, sha256, fetched_at) VALUES (?, ?, 'x', 8, ?, 0, 1, 'h', 'f')").run(`radar/${p}/${k}/${i}`, jst(t), i);
      }
    }
    await s.look(T7);
    const d = s.told.find((t) => t.title.startsWith("毎朝の点検"))!;
    expect(d.body).toContain("・雨雲レーダーの保存：48時刻中47時刻（欠けた時刻：5:00）");
    expect(d.body).toContain("・解析雨量の保存：48時刻中47時刻（欠けた時刻：6:00）");
  });
});

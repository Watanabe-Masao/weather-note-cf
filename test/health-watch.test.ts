// 毎時の見張り (worker/src/healthWatch.ts) on a D1 stand-in: once an hour in the 5-minute run, /api/health
// judged with the same judgment as scripts/health-check.mjs (shared/healthJudge.ts); a problem told to
// the administrators when it starts and when it is over (not every hour), the record's month told once,
// and the last look given by /api/health (counts and times only).

import { describe, expect, it } from "vitest";
import { judgeHealth } from "../shared/healthJudge";
import { ensureSchema } from "../worker/src/accounts";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
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
    // Nothing fetched yet: 予報 and 台風 are stale.
    let r = await s.look(T0);
    expect(r.opened.sort()).toEqual(["forecastStale", "typhoonStale"]);
    expect(s.told).toHaveLength(1);
    expect(s.told[0]).toMatchObject({ to: "https://push.test/admin", title: "監視：異常が2件あります" });
    expect(s.told[0].body).toContain("予報の電文を最後に取れたのは 記録なし");

    // An hour on, the same problems (their text has moved on): not told again.
    r = await s.look(T0 + H);
    expect(r).toMatchObject({ problems: 2, opened: [], closed: [] });
    expect(s.told).toHaveLength(1);

    // Fetched again: over, told once.
    s.fetched(T0 + 2 * H - 5 * MIN);
    r = await s.look(T0 + 2 * H);
    expect(r).toMatchObject({ problems: 0, opened: [] });
    expect(r.closed.sort()).toEqual(["forecastStale", "typhoonStale"]);
    expect(s.told).toHaveLength(2);
    expect(s.told[1].title).toBe("監視：2件 直りました");
    expect(s.told[1].body).toContain("直りました：予報の電文を最後に取れたのは");
    await s.look(T0 + 2 * H + 20 * MIN); // still all right: nothing told
    expect(s.told).toHaveLength(2);

    // Stale again later: a new one, told again (the closed one kept, renamed).
    r = await s.look(T0 + 5 * H);
    expect(r.opened.sort()).toEqual(["forecastStale", "typhoonStale"]);
    expect(s.told).toHaveLength(3);
    const rows = s.db.raw.prepare("SELECT key, closed_at IS NULL AS open, sent FROM health_alerts WHERE kind = 'problem' ORDER BY key").all();
    expect(rows).toEqual([
      { key: "forecastStale", open: 1, sent: 1 },
      { key: `forecastStale@${new Date(T0).toISOString()}`, open: 0, sent: 1 },
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
    expect(w).toEqual({ at: new Date(T0).toISOString(), finished: true, problems: 2, notes: expect.any(Number), opened: 2, closed: 0, sent: 1 });
    // A look taken but not ended says so.
    await claimHealthWatch(s.db, T0 + H);
    expect((await health(s.db, T0 + H)).state.watch).toMatchObject({ at: new Date(T0 + H).toISOString(), finished: false, problems: null });
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

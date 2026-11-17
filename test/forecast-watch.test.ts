// 止まったら知らせる (#250 R5-3): the forecast archive watched, and the administrators told once when it
// stops and once when it is over (worker/src/forecastWatch.ts), on a D1 stand-in.

import { describe, expect, it } from "vitest";
import { ensureSchema } from "../worker/src/accounts";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { watchForecastArchive } from "../worker/src/forecastWatch";
import type { Subscription } from "../worker/src/webpush";
import { d1 } from "./d1";

const T0 = Date.parse("2026-11-17T05:00:00+09:00");
const H = 3_600_000;
const MIN = 60_000;

async function setup() {
  const db = d1();
  await ensureSchema(db);
  await ensureForecastSchema(db);
  const user = (id: string, role: string) =>
    db.raw
      .prepare(
        "INSERT INTO users (id, login_id, role, pw_hash, pw_salt, pw_iter, research_id, created_at) VALUES (?, ?, ?, 'h', 's', 1, ?, 0)",
      )
      .run(id, id, role, `r${id}`);
  user("A", "admin");
  user("U", "user");
  for (const [u, e] of [
    ["A", "https://push.test/admin"],
    ["U", "https://push.test/user"],
  ])
    db.raw
      .prepare(
        "INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, 'p', 'a', 0)",
      )
      .run(e, u);
  const told: { to: string; title: string; body: string }[] = [];
  const send = async (s: Subscription, m: unknown) => {
    const msg = m as { title: string; body: string };
    told.push({ to: s.endpoint, title: msg.title, body: msg.body });
    return 201;
  };
  /** A telegram kept, issued at `t` (JST in issued_at, as JMA writes it). */
  const telegram = (kind: string, t: number, office = "390000") => {
    const jst = new Date(t + 9 * H).toISOString().slice(0, 19);
    const id = `${jst.replace(/[-:T]/g, "")}_0_${kind}_${office}`;
    db.raw
      .prepare(
        "INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, ?, 'u', ?, ?, 'h', 'x')",
      )
      .run(id, kind, office, `${jst}+09:00`, new Date(t).toISOString());
    return id;
  };
  /** A run of the collector, logged at `t`. */
  const run = (t: number, ok: boolean, error: string | null = null) =>
    db.raw
      .prepare(
        "INSERT INTO forecast_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, 'short', ?, 0, 0, 0, 0, ?)",
      )
      .run(new Date(t).toISOString(), ok ? 1 : 0, error);
  const watch = (t: number) => watchForecastArchive(db, t, send);
  return { db, told, telegram, run, watch };
}

describe("watching the forecast archive", () => {
  it("tells the administrators (only) once when no 府県天気予報 has come for 9 hours, and once when one does", async () => {
    const { db, told, telegram, run, watch } = await setup();
    const first = telegram("VPFD51", T0);
    telegram("VPFW50", T0);
    run(T0 + 5 * MIN, true);
    run(T0 + 9 * H - 5 * MIN, true);
    expect((await watch(T0 + 9 * H - MIN)).opened).toEqual([]);
    run(T0 + 9 * H, true);
    expect((await watch(T0 + 9 * H)).opened).toEqual(["missing:VPFD51"]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      to: "https://push.test/admin",
      title: "予報の保存：高知の府県天気予報が9時間届いていません",
    });
    expect(told[0].body).toMatch(/11\/17 5時 発表/);
    // No repeat while open.
    run(T0 + 9 * H + 5 * MIN, true);
    expect(await watch(T0 + 9 * H + 5 * MIN)).toEqual({ opened: [], closed: [] });
    expect(told).toHaveLength(1);
    // A new one comes: over.
    telegram("VPFD51", T0 + 9 * H + 6 * MIN);
    run(T0 + 9 * H + 10 * MIN, true);
    expect((await watch(T0 + 9 * H + 10 * MIN)).closed).toEqual(["missing:VPFD51"]);
    expect(told.map((t) => t.title)).toEqual([
      "予報の保存：高知の府県天気予報が9時間届いていません",
      "予報の保存：復旧しました",
    ]);
    expect(told[1].body).toMatch(/府県天気予報がまた届いています（最新：11\/17 14時6分 発表）/);
    // The row is kept, closed, with what was seen.
    const rows = db.raw.prepare("SELECT key, kind, closed_at, detail, sent FROM forecast_alerts").all() as {
      key: string;
      kind: string;
      closed_at: string | null;
      detail: string;
      sent: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "missing", sent: 1 });
    expect(rows[0].key).toMatch(/^missing:VPFD51@/);
    expect(rows[0].closed_at).not.toBeNull();
    expect(JSON.parse(rows[0].detail).lastTelegram).toEqual({ id: first, issued_at: "2026-11-17T05:00:00+09:00" });
  });

  it("waits 15 hours for the 府県週間天気予報", async () => {
    const { telegram, run, watch } = await setup();
    telegram("VPFW50", T0);
    for (let h = 1; h < 15; h++) {
      telegram("VPFD51", T0 + h * H);
      run(T0 + h * H, true);
      expect((await watch(T0 + h * H)).opened).toEqual([]);
    }
    telegram("VPFD51", T0 + 15 * H);
    run(T0 + 15 * H, true);
    const r = await watch(T0 + 15 * H);
    expect(r.opened).toEqual(["missing:VPFW50"]);
  });

  it("tells when the feed failed three times in a row, with the reason, and when it reads again", async () => {
    const { told, telegram, run, watch } = await setup();
    telegram("VPFD51", T0);
    run(T0, true);
    run(T0 + 5 * MIN, false, "Error: feed HTTP 503");
    run(T0 + 10 * MIN, false, "Error: feed HTTP 503");
    expect((await watch(T0 + 10 * MIN)).opened).toEqual([]);
    run(T0 + 15 * MIN, false, "Error: feed HTTP 503");
    expect((await watch(T0 + 15 * MIN)).opened).toEqual(["fetch"]);
    expect((await watch(T0 + 16 * MIN)).opened).toEqual([]);
    expect(told).toHaveLength(1);
    expect(told[0].title).toBe("予報の保存：気象庁の配信を読めません（3回続けて失敗）");
    expect(told[0].body).toMatch(/Error: feed HTTP 503/);
    expect(told[0].body).toMatch(/11\/17 5時 発表/);
    run(T0 + 20 * MIN, true);
    expect((await watch(T0 + 20 * MIN)).closed).toEqual(["fetch"]);
    expect(told[1].title).toBe("予報の保存：復旧しました");
  });

  it("does not also tell `missing` while the fetch is failing (the cause is the fetch)", async () => {
    const { told, telegram, run, watch } = await setup();
    telegram("VPFD51", T0);
    telegram("VPFW50", T0);
    run(T0, true);
    for (let m = 5; m <= 10 * 60; m += 5) run(T0 + m * MIN, false, "Error: feed HTTP 503");
    expect((await watch(T0 + 10 * H)).opened).toEqual(["fetch"]);
    expect(told.map((t) => t.title)).toEqual(["予報の保存：気象庁の配信を読めません（3回続けて失敗）"]);
    // The feed reads again but 高知's 府県天気予報 still has not come: now it is `missing`, with the last failure.
    run(T0 + 10 * H + 5 * MIN, true);
    const r = await watch(T0 + 10 * H + 5 * MIN);
    expect(r).toEqual({ opened: ["missing:VPFD51"], closed: ["fetch"] });
    const missing = told.find((t) => /府県天気予報が9時間/.test(t.title))!;
    expect(missing.body).toMatch(/最後の失敗（11\/17 15時）：Error: feed HTTP 503/);
  });

  it("keeps an open `missing` open (not 復旧) while the fetch fails", async () => {
    const { told, telegram, run, watch } = await setup();
    telegram("VPFD51", T0);
    run(T0 + 9 * H, true);
    expect((await watch(T0 + 9 * H)).opened).toEqual(["missing:VPFD51"]);
    run(T0 + 9 * H + 5 * MIN, false, "x");
    expect(await watch(T0 + 9 * H + 5 * MIN)).toEqual({ opened: [], closed: [] });
    expect(told).toHaveLength(1);
  });

  it("says nothing before the archive has run, or before the first telegram of a kind; but tells `fetch`", async () => {
    const { told, telegram, run, watch } = await setup();
    expect(await watch(T0)).toEqual({ opened: [], closed: [] });
    run(T0, true);
    expect(await watch(T0 + 20 * H)).toEqual({ opened: [], closed: [] });
    // A telegram of another office or kind is not 高知's VPFD51.
    telegram("VPFD51", T0, "130000");
    telegram("VPFG50", T0);
    expect(await watch(T0 + 20 * H)).toEqual({ opened: [], closed: [] });
    expect(told).toEqual([]);
    // Three failures before anything was kept: still told.
    run(T0 + 20 * H, false, "Error: feed: no entries");
    run(T0 + 20 * H + 5 * MIN, false, "Error: feed: no entries");
    run(T0 + 20 * H + 10 * MIN, false, "Error: feed: no entries");
    expect((await watch(T0 + 20 * H + 10 * MIN)).opened).toEqual(["fetch"]);
    expect(told[0].body).toMatch(/Error: feed: no entries/);
    expect(told[0].body).toMatch(/まだ1つも保存していません/);
  });

  it("tells a later stop again, as a new row", async () => {
    const { db, telegram, run, watch } = await setup();
    telegram("VPFD51", T0);
    run(T0 + 9 * H, true);
    await watch(T0 + 9 * H);
    telegram("VPFD51", T0 + 10 * H);
    run(T0 + 10 * H, true);
    await watch(T0 + 10 * H);
    run(T0 + 19 * H, true);
    expect((await watch(T0 + 19 * H)).opened).toEqual(["missing:VPFD51"]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_alerts").get()).toEqual({ n: 2 });
  });
});

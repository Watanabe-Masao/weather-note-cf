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

/** A JST time, e.g. at("11-17T06:01"). */
const at = (s: string) => Date.parse(`2026-${s}:00+09:00`);

describe("watching the forecast archive", () => {
  it("府県天気予報: quiet overnight after 17時, and before 5時 + 1 hour; told once at 6時 if 5時 has not come; 復旧 when it does", async () => {
    const { db, told, telegram, run, watch } = await setup();
    const last = telegram("VPFD51", at("11-16T17:00"));
    telegram("VPFW50", at("11-16T17:00"));
    for (const t of ["11-17T04:00", "11-17T05:30", "11-17T05:59"]) {
      run(at(t), true);
      expect(await watch(at(t))).toEqual({ opened: [], closed: [] });
    }
    run(at("11-17T06:01"), true);
    expect((await watch(at("11-17T06:01"))).opened).toEqual(["missing:VPFD51"]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      to: "https://push.test/admin",
      title: "予報の保存：高知の府県天気予報（11/17 5時の発表）が届いていません",
    });
    expect(told[0].body).toMatch(/11\/16 17時 発表/);
    // No repeat while open.
    run(at("11-17T06:06"), true);
    expect(await watch(at("11-17T06:06"))).toEqual({ opened: [], closed: [] });
    expect(told).toHaveLength(1);
    // The 5時 one comes late: over.
    telegram("VPFD51", at("11-17T05:00"));
    run(at("11-17T06:11"), true);
    expect((await watch(at("11-17T06:11"))).closed).toEqual(["missing:VPFD51"]);
    expect(told.map((t) => t.title)).toEqual([
      "予報の保存：高知の府県天気予報（11/17 5時の発表）が届いていません",
      "予報の保存：復旧しました",
    ]);
    expect(told[1].body).toMatch(/府県天気予報がまた届いています（最新：11\/17 5時 発表）/);
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
    const detail = JSON.parse(rows[0].detail);
    expect(detail.lastTelegram).toEqual({ id: last, issued_at: "2026-11-16T17:00:00+09:00" });
    expect(detail.due).toBe(new Date(at("11-17T05:00")).toISOString());
  });

  it("is quiet when each issue comes on time (the feed has it before its ReportDateTime)", async () => {
    const { told, telegram, run, watch } = await setup();
    for (const [kind, t] of [
      ["VPFD51", "11-17T05:00"],
      ["VPFD51", "11-17T11:00"],
      ["VPFW50", "11-17T11:00"],
    ])
      telegram(kind, at(t));
    for (const t of ["11-17T06:01", "11-17T12:01", "11-17T17:59"]) {
      run(at(t), true);
      expect(await watch(at(t))).toEqual({ opened: [], closed: [] });
    }
    expect(told).toEqual([]);
  });

  it("府県週間天気予報: quiet at 10時 after 17時 the day before; told at 12時 if 11時 has not come", async () => {
    const { told, telegram, run, watch } = await setup();
    telegram("VPFW50", at("11-16T17:00"));
    telegram("VPFD51", at("11-17T05:00"));
    telegram("VPFD51", at("11-17T11:00"));
    run(at("11-17T10:00"), true);
    expect((await watch(at("11-17T10:00"))).opened).toEqual([]);
    run(at("11-17T12:01"), true);
    expect((await watch(at("11-17T12:01"))).opened).toEqual(["missing:VPFW50"]);
    expect(told[0].title).toBe("予報の保存：高知の府県週間天気予報（11/17 11時の発表）が届いていません");
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
    telegram("VPFW50", at("11-17T11:00"));
    run(T0, true);
    for (let m = 5; m <= 10 * 60; m += 5) run(T0 + m * MIN, false, "Error: feed HTTP 503");
    // 15時: the 11時 府県天気予報 is missing, but the fetch is the cause.
    expect((await watch(T0 + 10 * H)).opened).toEqual(["fetch"]);
    expect(told.map((t) => t.title)).toEqual(["予報の保存：気象庁の配信を読めません（3回続けて失敗）"]);
    // The feed reads again but 11時's has still not come: now it is `missing`, with the last failure.
    run(T0 + 10 * H + 5 * MIN, true);
    const r = await watch(T0 + 10 * H + 5 * MIN);
    expect(r).toEqual({ opened: ["missing:VPFD51"], closed: ["fetch"] });
    const missing = told.find((t) => /府県天気予報（/.test(t.title))!;
    expect(missing.title).toBe("予報の保存：高知の府県天気予報（11/17 11時の発表）が届いていません");
    expect(missing.body).toMatch(/最後の失敗（11\/17 15時）：Error: feed HTTP 503/);
  });

  it("keeps an open `missing` open (not 復旧) while the fetch fails", async () => {
    const { told, telegram, run, watch } = await setup();
    telegram("VPFD51", at("11-17T05:00"));
    run(at("11-17T12:01"), true);
    expect((await watch(at("11-17T12:01"))).opened).toEqual(["missing:VPFD51"]);
    run(at("11-17T12:06"), false, "x");
    expect(await watch(at("11-17T12:06"))).toEqual({ opened: [], closed: [] });
    expect(told).toHaveLength(1);
  });

  it("says nothing before the archive has run, or before the first telegram of a kind; but tells `fetch`", async () => {
    const { told, telegram, run, watch } = await setup();
    expect(await watch(T0 + 20 * H)).toEqual({ opened: [], closed: [] });
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
    telegram("VPFD51", at("11-17T05:00"));
    run(at("11-17T12:01"), true);
    expect((await watch(at("11-17T12:01"))).opened).toEqual(["missing:VPFD51"]);
    telegram("VPFD51", at("11-17T11:00"));
    run(at("11-17T12:10"), true);
    expect((await watch(at("11-17T12:10"))).closed).toEqual(["missing:VPFD51"]);
    run(at("11-17T18:01"), true);
    expect((await watch(at("11-17T18:01"))).opened).toEqual(["missing:VPFD51"]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_alerts").get()).toEqual({ n: 2 });
  });
});


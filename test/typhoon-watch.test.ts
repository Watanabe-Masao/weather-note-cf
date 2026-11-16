// 止まったら知らせる (#220): the typhoon sources watched, and the administrators told once when one
// stops and once when it is over (worker/src/typhoonWatch.ts), on a D1 stand-in.

import { describe, expect, it } from "vitest";
import { ensureSchema } from "../worker/src/accounts";
import { collectTyphoons } from "../worker/src/typhoonArchive";
import {
  logTyphoonJson,
  watchTyphoonSources,
} from "../worker/src/typhoonWatch";
import type { Subscription } from "../worker/src/webpush";
import { d1 } from "./d1";

const T0 = Date.parse("2026-09-20T00:00:00Z");
const MIN = 60_000;

async function setup() {
  const db = d1();
  await ensureSchema(db);
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
  return { db, told, send };
}

const feedOf = (urls: string[]) =>
  `<feed>${urls.map((u) => `<entry><title>${/VPTW/.test(u) ? "台風解析・予報情報（５日予報）" : "気象警報"}</title><updated>x</updated><link href="${u}"/></entry>`).join("")}</feed>`;
const W =
  "https://www.data.jma.go.jp/developer/xml/data/20260920000000_0_VPWW54_010000.xml";
const telegram = (n: string, issued: string, remark = "", body = true) =>
  `<Report><Head><ReportDateTime>${issued}</ReportDateTime></Head><Body><TyphoonNamePart><Number>${n}</Number><Remark>${remark}</Remark></TyphoonNamePart>${
    body
      ? `<MeteorologicalInfo><DateTime type="実況">${issued}</DateTime><CenterPart><jmx_eb:Coordinate type="中心位置（度）">+30.0+133.0/</jmx_eb:Coordinate></CenterPart></MeteorologicalInfo>`
      : ""
  }</Body></Report>`;
const fetcher =
  (feed: string | null, telegrams: Record<string, string> = {}) =>
  async (url: string) => {
    if (/feed\//.test(url))
      return feed == null
        ? { ok: false, status: 503, text: async () => "" }
        : { ok: true, status: 200, text: async () => feed };
    const id = /([^/]+)\.xml$/.exec(url)![1];
    return { ok: true, status: 200, text: async () => telegrams[id] ?? "" };
  };

describe("watching the typhoon sources", () => {
  it("tells the administrators (only) once when the collector has stopped for an hour, and once when it is back", async () => {
    const { db, told, send } = await setup();
    await collectTyphoons(db, T0, fetcher(feedOf([W])));
    for (let m = 5; m <= 55; m += 5) {
      await collectTyphoons(db, T0 + m * MIN, fetcher(null));
      expect(
        (await watchTyphoonSources(db, T0 + m * MIN, send)).opened,
      ).toEqual([]);
    }
    await collectTyphoons(db, T0 + 60 * MIN, fetcher(null));
    expect((await watchTyphoonSources(db, T0 + 60 * MIN, send)).opened).toEqual(
      ["collector"],
    );
    await collectTyphoons(db, T0 + 65 * MIN, fetcher(null));
    expect((await watchTyphoonSources(db, T0 + 65 * MIN, send)).opened).toEqual(
      [],
    );
    await collectTyphoons(db, T0 + 70 * MIN, fetcher(feedOf([W])));
    expect((await watchTyphoonSources(db, T0 + 70 * MIN, send)).closed).toEqual(
      ["collector"],
    );
    expect(told.map((t) => [t.to, t.title])).toEqual([
      ["https://push.test/admin", "台風の電文が取れていません"],
      ["https://push.test/admin", "台風の電文の収集が戻りました"],
    ]);
    // A later stop is told again.
    await collectTyphoons(db, T0 + 75 * MIN, fetcher(null));
    await collectTyphoons(db, T0 + 135 * MIN, fetcher(null));
    expect(
      (await watchTyphoonSources(db, T0 + 135 * MIN, send)).opened,
    ).toEqual(["collector"]);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM typhoon_alerts").get(),
    ).toEqual({ n: 2 });
  });

  it("tells once about a telegram that could not be read in full", async () => {
    const { db, told, send } = await setup();
    const id = "20260920000000_0_VPTW60_010000";
    await collectTyphoons(
      db,
      T0,
      fetcher(
        feedOf([`https://www.data.jma.go.jp/developer/xml/data/${id}.xml`]),
        { [id]: telegram("2625", "2026-09-20T09:00:00+09:00", "", false) },
      ),
    );
    expect((await watchTyphoonSources(db, T0, send)).opened).toEqual([
      `problems:${id}`,
    ]);
    expect((await watchTyphoonSources(db, T0 + 5 * MIN, send)).opened).toEqual(
      [],
    );
    expect(told).toHaveLength(1);
    expect(told[0].body).toMatch(/台風25号の電文/);
  });

  it("tells when the JSON failed three times in a row, and when it reads again", async () => {
    const { db, told, send } = await setup();
    await logTyphoonJson(db, { ok: false, numbers: [], error: "503" }, T0);
    await logTyphoonJson(
      db,
      { ok: false, numbers: [], error: "503" },
      T0 + 30 * MIN,
    );
    expect((await watchTyphoonSources(db, T0 + 31 * MIN, send)).opened).toEqual(
      [],
    );
    await logTyphoonJson(
      db,
      { ok: false, numbers: [], error: "503" },
      T0 + 60 * MIN,
    );
    expect((await watchTyphoonSources(db, T0 + 61 * MIN, send)).opened).toEqual(
      ["json"],
    );
    await logTyphoonJson(db, { ok: true, numbers: [] }, T0 + 90 * MIN);
    expect((await watchTyphoonSources(db, T0 + 91 * MIN, send)).closed).toEqual(
      ["json"],
    );
    expect(told.map((t) => t.title)).toEqual([
      "今の台風情報が読めていません",
      "今の台風情報が読めるようになりました",
    ]);
  });

  it("tells when the telegrams have a typhoon the JSON does not (its form may have changed), not when it has ended", async () => {
    const { db, told, send } = await setup();
    const a = "20260920000000_0_VPTW60_010000";
    const b = "20260920000500_0_VPTW60_010000";
    await collectTyphoons(
      db,
      T0,
      fetcher(
        feedOf(
          [a, b].map(
            (x) => `https://www.data.jma.go.jp/developer/xml/data/${x}.xml`,
          ),
        ),
        {
          [a]: telegram("2625", "2026-09-20T08:45:00+09:00"),
          [b]: telegram(
            "2626",
            "2026-09-20T08:50:00+09:00",
            "台風第26号は熱帯低気圧に変わりました。",
          ),
        },
      ),
    );
    // The JSON has 25号: fine (26号 has ended).
    await logTyphoonJson(db, { ok: true, numbers: [25] }, T0 + 10 * MIN);
    expect((await watchTyphoonSources(db, T0 + 10 * MIN, send)).opened).toEqual(
      [],
    );
    // The JSON reads but has no typhoon.
    await logTyphoonJson(db, { ok: true, numbers: [] }, T0 + 40 * MIN);
    expect((await watchTyphoonSources(db, T0 + 40 * MIN, send)).opened).toEqual(
      ["mismatch"],
    );
    expect(told[0].body).toMatch(/台風25号/);
    // Seven hours on, the telegram is no longer fresh: over.
    await logTyphoonJson(db, { ok: true, numbers: [] }, T0 + 7 * 60 * MIN);
    expect(
      (await watchTyphoonSources(db, T0 + 7 * 60 * MIN, send)).closed,
    ).toEqual(["mismatch"]);
  });

  it("is quiet when everything reads", async () => {
    const { db, told, send } = await setup();
    await collectTyphoons(db, T0, fetcher(feedOf([W])));
    await logTyphoonJson(db, { ok: true, numbers: [] }, T0);
    expect(await watchTyphoonSources(db, T0 + MIN, send)).toEqual({
      opened: [],
      closed: [],
    });
    expect(told).toEqual([]);
  });
});

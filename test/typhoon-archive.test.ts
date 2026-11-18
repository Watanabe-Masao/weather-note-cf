// 当時の発表を残す (#220): JMA's typhoon telegram read into its times (shared/typhoonXml.ts), and the
// scheduled collector (worker/src/typhoonArchive.ts) on a D1 stand-in with a made-up feed.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTyphoonXml } from "../shared/typhoonXml";
import {
  archiveSummary,
  collectTyphoons,
  feedEntries,
} from "../worker/src/typhoonArchive";
import { d1 } from "./d1";

const XML = readFileSync(
  new URL("./fixtures/vptw60-synthetic.xml", import.meta.url),
  "utf8",
);
const NM = 1.852;

describe("the telegram (VPTW60)", () => {
  const t = parseTyphoonXml(XML);
  it("reads when JMA issued it and the typhoon", () => {
    expect(t).toMatchObject({
      kind: "VPTW60",
      issuedAt: "2026-09-20T09:45:00+09:00",
      targetAt: "2026-09-20T09:00:00+09:00",
      number: "2625",
      name: "TESTER",
      nameKana: "テスター",
      problems: [],
    });
  });
  it("keeps when it was issued apart from the times it speaks of", () => {
    expect(t.times.map((x) => [x.part, x.validAt, x.hours])).toEqual([
      ["実況", "2026-09-20T09:00:00+09:00", 0],
      ["予報　２４時間後", "2026-09-21T09:00:00+09:00", 24],
    ]);
  });
  it("reads the analysis: centre, pressure, wind in knots, 暴風域 leaning east, 強風域 all round", () => {
    const now = t.times[0];
    expect(now).toMatchObject({
      lat: 30,
      lon: 133,
      location: "四国の南",
      pressure: 950,
      windKt: 80,
      gustKt: 115,
      typhoonClass: "台風(TY)",
    });
    expect(now.storm!.radius).toEqual({
      long: 100 * NM,
      short: 60 * NM,
      dir: 90,
    });
    expect(now.gale).toEqual({
      lat: 30.2,
      lon: 133.1,
      radius: { long: 250 * NM, short: 250 * NM, dir: null },
    });
  });
  it("reads a forecast time: its centre is its 予報円's, and its 暴風警戒域", () => {
    const ahead = t.times[1];
    expect(ahead).toMatchObject({
      lat: 33.5,
      lon: 133.5,
      pressure: 965,
      windKt: 65,
    });
    expect(ahead.probability!.radius.long).toBeCloseTo(50 * NM);
    expect(ahead.warning).toEqual({
      lat: 33.5,
      lon: 133.5,
      radius: { long: 140 * NM, short: 140 * NM, dir: null },
    });
  });
  it("says what it could not read, never guesses", () => {
    expect(
      parseTyphoonXml("<Report></Report>").problems.length,
    ).toBeGreaterThan(0);
  });
});

const feed = (urls: string[]) =>
  `<feed>${urls.map((u, i) => `<entry><title>${/VPTW/.test(u) ? "台風解析・予報情報（５日予報）（Ｈ３０）" : "気象警報・注意報"}</title><updated>2026-09-20T0${i}:00:00Z</updated><link type="application/xml" href="${u}"/></entry>`).join("")}</feed>`;
const T1 =
  "https://www.data.jma.go.jp/developer/xml/data/20260920004500_0_VPTW60_010000.xml";
const W1 =
  "https://www.data.jma.go.jp/developer/xml/data/20260920004000_0_VPWW54_010000.xml";

function fakeFetch(feeds: Record<string, string>, fail = false, page = XML) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    if (fail) return { ok: false, status: 503, text: async () => "" };
    const body =
      url.endsWith("extra.xml") || url.endsWith("extra_l.xml")
        ? feeds[url.endsWith("extra_l.xml") ? "long" : "short"]
        : page;
    return { ok: true, status: 200, text: async () => body };
  };
  return { get, asked };
}

describe("the collector", () => {
  it("first reads the long feed, keeps the typhoon telegram (only), and logs the run", async () => {
    const db = d1();
    const f = fakeFetch({ long: feed([T1, W1]), short: feed([]) });
    const r = await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:00:00Z"),
      f.get,
    );
    expect(r).toMatchObject({ added: 1, ok: true });
    expect(f.asked[0]).toMatch(/extra_l\.xml$/);
    expect(f.asked).not.toContain(W1);
    const row = db.raw
      .prepare(
        "SELECT id, kind, number, issued_at, parser, problems, length(xml) > 100 AS kept FROM typhoon_telegrams",
      )
      .get();
    expect(row).toMatchObject({
      id: "20260920004500_0_VPTW60_010000",
      kind: "VPTW60",
      number: "2625",
      issued_at: "2026-09-20T09:45:00+09:00",
      parser: 1,
      problems: null,
      kept: 1,
    });
  });

  it("reads the short feed after, does not fetch a telegram it has, and logs a run with no typhoon too", async () => {
    const db = d1();
    await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:00:00Z"),
      fakeFetch({ long: feed([T1]), short: feed([]) }).get,
    );
    const f = fakeFetch({ long: feed([]), short: feed([T1, W1]) });
    const r = await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:05:00Z"),
      f.get,
    );
    expect(r.added).toBe(0);
    expect(f.asked).toEqual([
      "https://www.data.jma.go.jp/developer/xml/feed/extra.xml",
    ]);
    await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:10:00Z"),
      fakeFetch({ long: feed([]), short: feed([W1]) }).get,
    );
    const log = db.raw
      .prepare(
        "SELECT feed, ok, typhoon_entries, added FROM typhoon_fetch_log ORDER BY at",
      )
      .all();
    expect(log).toEqual([
      { feed: "long", ok: 1, typhoon_entries: 1, added: 1 },
      { feed: "short", ok: 1, typhoon_entries: 1, added: 0 },
      { feed: "short", ok: 1, typhoon_entries: 0, added: 0 },
    ]);
  });

  it("keeps a failed run as a gap, and catches up from the long feed after a long one", async () => {
    const db = d1();
    await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:00:00Z"),
      fakeFetch({ long: feed([W1]), short: feed([W1]) }).get,
    );
    const failed = await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:05:00Z"),
      fakeFetch({}, true).get,
    );
    expect(failed.ok).toBe(false);
    const later = fakeFetch({ long: feed([T1]), short: feed([]) });
    await collectTyphoons(db, Date.parse("2026-09-20T12:00:00Z"), later.get);
    expect(later.asked[0]).toMatch(/extra_l\.xml$/);
    const s = await archiveSummary(db);
    expect(s.gaps).toHaveLength(1);
    expect(s.telegrams).toEqual([
      {
        number: "2625",
        n: 1,
        first: "2026-09-20T09:45:00+09:00",
        last: "2026-09-20T09:45:00+09:00",
      },
    ]);
  });

  it("does not keep a page that is not a telegram (an error page answered 200): a failure, taken next run", async () => {
    const db = d1();
    const r = await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:00:00Z"),
      fakeFetch({ long: feed([T1]), short: feed([T1]) }, false, "<html>maintenance</html>").get,
    );
    expect(r).toMatchObject({ ok: false, added: 0 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM typhoon_telegrams").get()).toEqual({ n: 0 });
    expect(db.raw.prepare("SELECT ok, error FROM typhoon_fetch_log").all()).toEqual([
      { ok: 0, error: "Error: 20260920004500_0_VPTW60_010000: not a telegram" },
    ]);
    const next = await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:05:00Z"),
      fakeFetch({ long: feed([T1]), short: feed([T1]) }).get,
    );
    expect(next).toMatchObject({ ok: true, added: 1 });
  });

  it("an empty feed is not read as「台風なし」: it is a gap", async () => {
    const db = d1();
    const r = await collectTyphoons(
      db,
      Date.parse("2026-09-20T01:00:00Z"),
      fakeFetch({ long: feed([]), short: feed([]) }).get,
    );
    expect(r.ok).toBe(false);
    expect((await archiveSummary(db)).gaps).toHaveLength(1);
  });

  it("reads the feed's entries", () => {
    expect(feedEntries(feed([T1]))).toEqual([
      {
        title: "台風解析・予報情報（５日予報）（Ｈ３０）",
        url: T1,
        updated: "2026-09-20T00:00:00Z",
      },
    ]);
  });
});

// 障害テスト（#299 P0）：D1 に書けない回・途中で切れた回のあとも、次の回で取り戻し、重ならない。
import { faulty } from "./faults";
import { ensureTyphoonSchema } from "../worker/src/typhoonArchive";
describe("台風の電文：障害のあと", () => {
  it("D1 に書けなかった回・途中で切れた回のあと、次の回で取り戻し、1通だけ", async () => {
    for (const opts of [{ failWrites: (q: string) => q.includes("INTO typhoon_telegrams"), times: 1 }, { cutAfterWrites: 0 }]) {
      const db = d1();
      await ensureTyphoonSchema(db);
      const feeds = { long: feed([T1, W1]), short: feed([T1, W1]) };
      await collectTyphoons(faulty(db, opts).db, Date.parse("2026-09-20T01:00:00Z"), fakeFetch(feeds).get).catch(() => {});
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM typhoon_telegrams").get()).toEqual({ n: 0 });
      await collectTyphoons(db, Date.parse("2026-09-20T01:05:00Z"), fakeFetch(feeds).get);
      await collectTyphoons(db, Date.parse("2026-09-20T01:10:00Z"), fakeFetch(feeds).get);
      expect(db.raw.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d FROM typhoon_telegrams").get()).toEqual({ n: 1, d: 1 });
    }
  });
});

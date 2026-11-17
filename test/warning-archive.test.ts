// 警報・注意報の電文 (worker/src/warningArchive.ts) on a D1 stand-in, with JMA's own telegrams of #267
// (test/fixtures/warnings, 出典：気象庁) behind a made-up 随時 feed: 高知県's VPWW53 and VPWW55〜61 are
// kept as issued, once each; a feed or a telegram that could not be read is logged and taken on a later
// run; and the copy in R2 reads back to the same telegram.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { health } from "../worker/src/health";
import { type Bucket, copyTelegrams, gunzip } from "../worker/src/r2Archive";
import { collectWarnings, FEED_LONG, FEED_SHORT } from "../worker/src/warningArchive";
import { d1 } from "./d1";

const DIR = new URL("./fixtures/warnings/", import.meta.url);
const NAMES = readdirSync(DIR).map((f) => f.replace(/\.xml$/, "")).sort();
const telegram = (name: string) => readFileSync(new URL(`${name}.xml`, DIR), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const BASE = "https://www.data.jma.go.jp/developer/xml/data";
const updatedOf = (name: string) => `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T${name.slice(8, 10)}:${name.slice(10, 12)}:${name.slice(12, 14)}Z`;
const entry = (name: string) => `<entry><title>t</title><updated>${updatedOf(name)}</updated><link type="application/xml" href="${BASE}/${name}.xml"/></entry>`;
const feed = (names: string[]) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${names.map(entry).join("")}</feed>`;

/** 高知県's VPWW53 and R06 telegrams among the samples (the ones to keep), written out. */
const KOCHI = [
  "20261110192917_0_VPWW59_390000",
  "20261115134151_0_VPWW53_390000",
  "20261116191810_0_VPWW58_390000",
  "20261116191823_0_VPWW53_390000",
  "20261117010534_0_VPWW58_390000",
  "20261117010549_0_VPWW53_390000",
  "20261117044257_0_VPHW50_390000",
  "20261117044910_0_VPWW61_390000",
  "20261117044919_0_VPWW53_390000",
];

function server(names: string[], opts: { feedDown?: boolean; broken?: Set<string>; extra?: Record<string, string> } = {}) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    if (url === FEED_SHORT || url === FEED_LONG) {
      if (opts.feedDown) return { ok: false, status: 503, text: async () => "" };
      return { ok: true, status: 200, text: async () => feed(names) };
    }
    const name = /data\/([^/]+)\.xml$/.exec(url)?.[1] ?? "";
    if (opts.broken?.has(name)) return { ok: false, status: 500, text: async () => "" };
    const body = opts.extra?.[name] ?? telegram(name);
    return { ok: true, status: 200, text: async () => body };
  };
  return { get, asked };
}

const T0 = Date.parse("2026-11-17T14:00:00+09:00");
const MIN = 60_000;

describe("警報・注意報の電文：集める", () => {
  it("keeps 高知県's VPWW53, VPWW55〜61 and the 竜巻注意 news (VPHW50) as issued, once each; not VPWW54, 早期注意, other prefectures", async () => {
    expect(NAMES).toHaveLength(14); // the samples of #267: also VPWW54, VPFD60・61, VPFW60, VPHW50, and 大阪's VPWW55
    const db = d1();
    const s = server(NAMES);
    const r = await collectWarnings(db, T0, s.get);
    expect(r).toMatchObject({ added: KOCHI.length, ok: true, leftOver: 0, feed: FEED_LONG }); // the first run reads the 7 days
    const kept = db.raw.prepare("SELECT id, kind, office, url, issued_at, fetched_at, hash, xml, parser FROM warning_telegrams ORDER BY id").all() as Record<string, unknown>[];
    expect(kept.map((k) => k.id)).toEqual(KOCHI);
    for (const k of kept) {
      const xml = telegram(String(k.id));
      expect(k.xml).toBe(xml); // whole, as JMA issued it
      expect(k.hash).toBe(sha(xml));
      expect(k.office).toBe("390000");
      expect(k.kind).toBe(/_(VP[A-Z]{2}\d\d)_/.exec(String(k.id))![1]);
      expect(k.url).toBe(`${BASE}/${k.id}.xml`);
      expect(k.issued_at).toMatch(/^2026-11-\d\dT\d\d:\d\d:00\+09:00$/); // JMA's 発表時刻, JST
      expect(k.fetched_at).toBe(new Date(T0).toISOString()); // UTC
      expect(k.parser).toBe(0); // not read yet
    }
    expect(kept.find((k) => k.id === "20261116191823_0_VPWW53_390000")?.issued_at).toBe("2026-11-17T04:18:00+09:00");
    expect(db.raw.prepare("SELECT feed, ok, entries, wanted, added, left_over, error FROM warning_fetch_log").all()).toEqual([
      { feed: "long", ok: 1, entries: NAMES.length, wanted: KOCHI.length, added: KOCHI.length, left_over: 0, error: null },
    ]);
  });

  it("does not keep (nor fetch) a telegram twice, even when the feed lists it twice", async () => {
    const db = d1();
    const twice = [...NAMES, KOCHI[0]];
    expect((await collectWarnings(db, T0, server(twice).get)).added).toBe(KOCHI.length);
    const s = server(twice);
    const again = await collectWarnings(db, T0 + 5 * MIN, s.get);
    expect(again).toMatchObject({ added: 0, ok: true, feed: FEED_SHORT }); // the short feed, once it is caught up
    expect(s.asked).toEqual([FEED_SHORT]); // nothing fetched again
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM warning_telegrams").get()).toEqual({ n: KOCHI.length });
  });

  it("logs a run that could not read the feed, and takes what it missed on the next", async () => {
    const db = d1();
    await collectWarnings(db, T0, server(KOCHI.slice(0, 2)).get);
    const down = await collectWarnings(db, T0 + 5 * MIN, server(KOCHI, { feedDown: true }).get);
    expect(down).toMatchObject({ ok: false, added: 0 });
    expect(db.raw.prepare("SELECT ok, error FROM warning_fetch_log WHERE ok = 0").all()).toEqual([{ ok: 0, error: "Error: feed HTTP 503" }]);
    const next = await collectWarnings(db, T0 + 10 * MIN, server(KOCHI).get);
    expect(next).toMatchObject({ ok: true, added: KOCHI.length - 2 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM warning_telegrams").get()).toEqual({ n: KOCHI.length });
  });

  it("after a stretch it could not read (longer than the short feed reaches), reads the long feed", async () => {
    const db = d1();
    await collectWarnings(db, T0, server([]).get); // "no entries": a failure
    await collectWarnings(db, T0 + 5 * MIN, server(KOCHI.slice(0, 1)).get);
    for (let i = 1; i <= 3; i++) await collectWarnings(db, T0 + i * 3 * 3_600_000, server(KOCHI, { feedDown: true }).get);
    const back = await collectWarnings(db, T0 + 10 * 3_600_000, server(KOCHI).get);
    expect(back).toMatchObject({ feed: FEED_LONG, ok: true, added: KOCHI.length - 1 });
  });

  it("logs a telegram that could not be fetched, keeps the rest, and takes it on the next run", async () => {
    const db = d1();
    const bad = KOCHI[1];
    const r = await collectWarnings(db, T0, server(KOCHI, { broken: new Set([bad]) }).get);
    expect(r).toMatchObject({ ok: false, added: KOCHI.length - 1 });
    expect(db.raw.prepare("SELECT ok, error FROM warning_fetch_log").get()).toEqual({ ok: 0, error: `Error: ${bad}: HTTP 500` });
    const s = server(KOCHI);
    expect(await collectWarnings(db, T0 + 5 * MIN, s.get)).toMatchObject({ ok: true, added: 1 });
    expect(s.asked.filter((u) => u.endsWith(`${bad}.xml`))).toHaveLength(1);
  });

  it("does not keep a page that is not a telegram", async () => {
    const db = d1();
    const r = await collectWarnings(db, T0, server(KOCHI.slice(0, 1), { extra: { [KOCHI[0]]: "<html>maintenance</html>" } }).get);
    expect(r).toMatchObject({ ok: false, added: 0 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM warning_telegrams").get()).toEqual({ n: 0 });
  });

  it("catches a long backlog up over runs, the oldest first (the one nearest to falling out of the feed)", async () => {
    const db = d1();
    const xml = telegram(KOCHI[0]);
    const many = Array.from({ length: 40 }, (_, i) => {
      const stamp = new Date(Date.UTC(2026, 10, 10, 0, 0) + i * 3 * 3_600_000).toISOString().slice(0, 19).replace(/[-:T]/g, "");
      return `${stamp}_0_VPWW53_390000`;
    });
    const s = server(many, { extra: Object.fromEntries(many.map((n) => [n, xml])) });
    const first = await collectWarnings(db, T0, s.get);
    expect(first).toMatchObject({ added: 25, leftOver: 15 });
    expect(db.raw.prepare("SELECT MIN(id) AS a, MAX(id) AS b FROM warning_telegrams").get()).toEqual({ a: many[0], b: many[24] });
    const second = await collectWarnings(db, T0 + 5 * MIN, s.get);
    expect(second).toMatchObject({ feed: FEED_LONG, added: 15, leftOver: 0 }); // still owed: the long feed again
  });
});

describe("警報・注意報の電文：R2 の写しと health", () => {
  function bucket() {
    const files = new Map<string, Uint8Array>();
    const b: Bucket = {
      put: async (k, v) => void files.set(k, new Uint8Array(v instanceof Uint8Array ? v : new Uint8Array(v))),
      get: async (k) => (files.has(k) ? { arrayBuffer: async () => files.get(k)!.slice().buffer } : null),
    };
    return { b, files };
  }

  it("copies each to telegrams/warning/YYYY-MM/<id>.xml.gz, and it reads back to the telegram", async () => {
    const db = d1();
    await collectWarnings(db, T0, server(KOCHI).get);
    const { b, files } = bucket();
    expect(await copyTelegrams(db, b, T0 + MIN)).toEqual({ copied: KOCHI.length, failed: 0 });
    for (const id of KOCHI) {
      const issued = (db.raw.prepare("SELECT issued_at FROM warning_telegrams WHERE id = ?").get(id) as { issued_at: string }).issued_at;
      const key = `telegrams/warning/${issued.slice(0, 7)}/${id}.xml.gz`;
      expect(new TextDecoder().decode(await gunzip(new Uint8Array(files.get(key)!)))).toBe(telegram(id));
    }
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM archive_copies WHERE source = 'warning'").get()).toEqual({ n: KOCHI.length });
    expect(await copyTelegrams(db, b, T0 + 2 * MIN)).toEqual({ copied: 0, failed: 0 }); // once
  });

  it("says in /api/health how many are kept, the latest of each kind, how many R2 has not, and the failures — counts only", async () => {
    const db = d1();
    expect((await health(db, T0)).state.warnings).toEqual({ telegrams: 0, latest: {}, notCopiedToR2: 0, lastOk: null, fetchFailuresLastDay: 0 });
    await collectWarnings(db, T0, server(KOCHI).get);
    await collectWarnings(db, T0 + 5 * MIN, server(KOCHI, { feedDown: true }).get);
    await copyTelegrams(db, bucket().b, T0 + 6 * MIN, 2);
    const h = await health(db, T0 + 10 * MIN);
    expect(h.state.warnings).toEqual({
      telegrams: KOCHI.length,
      latest: { VPHW50: "2026-11-17T13:42:00+09:00", VPWW53: "2026-11-17T13:49:00+09:00", VPWW58: "2026-11-17T10:05:00+09:00", VPWW59: "2026-11-11T04:29:00+09:00", VPWW61: "2026-11-17T13:49:00+09:00" },
      notCopiedToR2: KOCHI.length - 2,
      lastOk: new Date(T0).toISOString(),
      fetchFailuresLastDay: 1,
    });
    expect(h.waste.notCopiedToR2).toBe(KOCHI.length - 2);
    expect(h.tables.warning_telegrams).toEqual({ rows: KOCHI.length, lastDay: KOCHI.length });
  });
});

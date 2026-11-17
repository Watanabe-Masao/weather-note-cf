// 長い先の予報の電文 (worker/src/longRangeArchive.ts) on a D1 stand-in and a Map for the bucket: the 四国 1か月予報
// (VPCK50 370000), 早期天候情報 (VPAW51 370000) and the 2週間気温予報 (VPCK70 010000) of the regular feed kept in
// R2 gzipped and read back, a row each in D1 (no XML), nothing else of the feed, and the feed read every 30 minutes.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectLongRange, longRangeKey } from "../worker/src/longRangeArchive";
import { type Bucket, gunzip } from "../worker/src/r2Archive";
import { d1 } from "./d1";

const BASE = "https://www.data.jma.go.jp/developer/xml/data";
const NAMES = [
  "20261112050900_0_VPCK50_370000", // 四国地方１か月予報
  "20261112050900_0_VPCK50_340000", // 中国地方（ほかの地方）
  "20261117053000_0_VPCK70_010000", // ２週間気温予報（全国1通）
  "20261117050000_0_VPAW51_370000", // 早期天候情報（四国）
  "20261117020000_0_VPFD51_390000", // 府県天気予報（ここでは取らない）
];
const xmlOf = (name: string) => `<?xml version="1.0"?><Report><Control><Title>${name}</Title></Control><Head><ReportDateTime>2026-11-17T14:30:00+09:00</ReportDateTime></Head><Body>${"x".repeat(200)}</Body></Report>`;
const feed = (names: string[]) =>
  `<feed>${names.map((n) => `<entry><title>t</title><updated>${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}T${n.slice(8, 10)}:${n.slice(10, 12)}:00Z</updated><link type="application/xml" href="${BASE}/${n}.xml"/></entry>`).join("")}</feed>`;

function bucket() {
  const files = new Map<string, Uint8Array>();
  const b: Bucket = {
    async put(key, value) {
      files.set(key, new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)));
    },
    async get(key) {
      const f = files.get(key);
      return f ? { arrayBuffer: async () => f.slice().buffer } : null;
    },
  };
  return { b, files };
}
function server(names: string[]) {
  const seen: string[] = [];
  const get = async (url: string) => {
    seen.push(url);
    if (url.includes("/feed/")) return { ok: true, status: 200, text: async () => feed(names) };
    const n = /([^/]+)\.xml$/.exec(url)![1];
    return { ok: true, status: 200, text: async () => xmlOf(n) };
  };
  return { get, seen };
}
const T0 = Date.parse("2026-11-17T06:00:00Z");

describe("長い先の予報の電文", () => {
  it("keeps 四国's 1か月予報・早期天候情報 and the 2週間気温予報 in R2 (gzip, read back), a row each, nothing else", async () => {
    const db = d1();
    const { b, files } = bucket();
    const s = server(NAMES);
    expect(await collectLongRange(db, b, T0, s.get)).toEqual({ added: 3, leftOver: 0, ok: true });
    const rows = db.raw.prepare("SELECT id, kind, office, issued_at, hash, r2_key FROM longrange_telegrams ORDER BY id").all() as { id: string; kind: string; hash: string; r2_key: string }[];
    expect(rows.map((r) => r.id)).toEqual(["20261112050900_0_VPCK50_370000", "20261117050000_0_VPAW51_370000", "20261117053000_0_VPCK70_010000"]);
    for (const r of rows) {
      expect(r.r2_key).toBe(longRangeKey(r.id, "2026-11-17T14:30:00+09:00"));
      const back = new TextDecoder().decode(await gunzip(new Uint8Array(files.get(r.r2_key)!.slice().buffer)));
      expect(createHash("sha256").update(back).digest("hex")).toBe(r.hash);
    }
    expect(s.seen[0]).toContain("regular_l.xml"); // the first run reads the long feed
  });

  it("reads the feed every 30 minutes, the short one after an ok run, and keeps a telegram once", async () => {
    const db = d1();
    const { b } = bucket();
    await collectLongRange(db, b, T0, server(NAMES).get);
    expect(await collectLongRange(db, b, T0 + 5 * 60_000, server(NAMES).get)).toEqual({ added: 0, leftOver: 0, ok: true, skipped: true });
    const s = server(NAMES);
    expect(await collectLongRange(db, b, T0 + 31 * 60_000, s.get)).toEqual({ added: 0, leftOver: 0, ok: true });
    expect(s.seen).toEqual(["https://www.data.jma.go.jp/developer/xml/feed/regular.xml"]);
  });

  it("logs a feed that cannot be read", async () => {
    const db = d1();
    const get = async () => ({ ok: false, status: 503, text: async () => "" });
    expect(await collectLongRange(db, bucket().b, T0, get)).toEqual({ added: 0, leftOver: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, error FROM longrange_fetch_log").get()).toEqual({ ok: 0, error: "Error: feed HTTP 503" });
  });
});

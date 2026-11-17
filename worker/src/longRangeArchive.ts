// 長い先の予報を残す (KC-01/02, research/keep-candidates, 2026-11-18): JMA's telegrams of the forecasts far
// ahead, kept as issued — 地方１か月予報 (VPCK50) and 早期天候情報 (VPAW51) of the region of the stations
// (四国: 370000, shared/stationPlaces.ts), and the ２週間気温予報 (VPCK70, one telegram for the whole country,
// 010000, with 高知 among its points). They come from the regular feed (定時) and are not kept by JMA for
// long, like the forecasts (forecastArchive.ts).
//
// Kept in R2 only, gzipped (telegrams/longrange/<yyyy-mm>/<id>.xml.gz; VPCK70 is about 750 KB a day), read
// back and checked against the telegram's hash before it counts; D1 keeps a row for each (no XML). Reading
// the values (高知's 2週間気温予報 …) is a later step. The feed is read every 30 minutes (these come daily or
// weekly; the short feed reaches about 10 hours), the long one (7 days) the first time and after a gap.
// 出典：気象庁（防災情報XML）。

import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Db } from "./accounts";
import { type Bucket, gunzip, gzip } from "./r2Archive";
import { feedEntries, telegramId, type FeedEntry } from "./typhoonArchive";

export const LONG_RANGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS longrange_telegrams (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    office TEXT NOT NULL,
    url TEXT NOT NULL,
    issued_at TEXT,
    fetched_at TEXT NOT NULL,
    hash TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    r2_key TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS longrange_telegrams_kind ON longrange_telegrams (kind, issued_at)",
  `CREATE TABLE IF NOT EXISTS longrange_fetch_log (
    at TEXT PRIMARY KEY,
    feed TEXT NOT NULL,
    ok INTEGER NOT NULL,
    entries INTEGER NOT NULL,
    wanted INTEGER NOT NULL,
    added INTEGER NOT NULL,
    left_over INTEGER NOT NULL,
    error TEXT
  )`,
];

const FEED_SHORT = "https://www.data.jma.go.jp/developer/xml/feed/regular.xml";
const FEED_LONG = "https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml";
/** Read the feed at most this often. */
const EVERY_MS = 30 * 60_000;
const SHORT_REACH_MS = 8 * 3_600_000;
const LOG_DAYS = 400;
/** Telegrams fetched in one run (VPCK70 is large). */
const PER_RUN = 3;

/** What is kept: the kind and the offices (the regions of the stations, or the whole country). */
export const LONG_RANGE_KINDS: Record<string, readonly string[]> = {
  VPCK50: [...new Set(Object.values(STATION_PLACES).map((p) => p.longRange.regionOffice))],
  VPAW51: [...new Set(Object.values(STATION_PLACES).map((p) => p.longRange.regionOffice))],
  VPCK70: ["010000"],
};

const kindOf = (url: string) => /_(VP[A-Z]{2}\d\d)_/.exec(url)?.[1] ?? "";
const officeOfUrl = (url: string) => /_(\d{6})\.xml$/.exec(url)?.[1] ?? "";
const issuedOf = (xml: string) => /<ReportDateTime>([^<]+)<\/ReportDateTime>/.exec(xml)?.[1] ?? null;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (b: Uint8Array<ArrayBuffer>) => hex(await crypto.subtle.digest("SHA-256", b));

export const longRangeKey = (id: string, issuedAt: string | null) => `telegrams/longrange/${issuedAt ? issuedAt.slice(0, 7) : "unknown"}/${id}.xml.gz`;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

const ready = new WeakMap<Db, Promise<void>>();
export function ensureLongRangeSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const q of LONG_RANGE_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

/** One scheduled run: every 30 minutes, read the regular feed and keep the new long-range telegrams in R2. */
export async function collectLongRange(db: Db, bucket: Bucket, now = Date.now(), get: Fetcher = defaultFetch): Promise<{ added: number; leftOver: number; ok: boolean; skipped?: true }> {
  await ensureLongRangeSchema(db);
  const last = await db.prepare("SELECT at, left_over FROM longrange_fetch_log ORDER BY at DESC LIMIT 1").first<{ at: string; left_over: number }>();
  if (last && now - Date.parse(last.at) < EVERY_MS && !last.left_over) return { added: 0, leftOver: 0, ok: true, skipped: true };
  const lastOk = await db.prepare("SELECT at FROM longrange_fetch_log WHERE ok = 1 ORDER BY at DESC LIMIT 1").first<{ at: string }>();
  const feed = !lastOk || now - Date.parse(lastOk.at) > SHORT_REACH_MS || (last?.left_over ?? 0) > 0 ? FEED_LONG : FEED_SHORT;
  const at = new Date(now).toISOString();
  const log = (ok: boolean, entries: number, wanted: number, added: number, leftOver: number, error: string | null) =>
    db
      .prepare("INSERT OR REPLACE INTO longrange_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(at, feed === FEED_LONG ? "long" : "short", ok ? 1 : 0, entries, wanted, added, leftOver, error)
      .run();
  let entries: FeedEntry[];
  try {
    const r = await get(feed);
    if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
    entries = feedEntries(await r.text());
    if (!entries.length) throw new Error("feed: no entries");
  } catch (e) {
    await log(false, 0, 0, 0, 0, String(e).slice(0, 300));
    return { added: 0, leftOver: 0, ok: false };
  }
  const wanted = entries.filter((e) => LONG_RANGE_KINDS[kindOf(e.url)]?.includes(officeOfUrl(e.url)));
  const fresh: FeedEntry[] = [];
  for (const e of wanted) if (!(await db.prepare("SELECT 1 FROM longrange_telegrams WHERE id = ?").bind(telegramId(e.url)).first())) fresh.push(e);
  fresh.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  let added = 0;
  let failed: string | null = null;
  for (const e of fresh.slice(0, PER_RUN)) {
    const id = telegramId(e.url);
    try {
      const r = await get(e.url);
      if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
      const xml = await r.text();
      if (!xml.includes("<Report")) throw new Error(`${id}: not a telegram`);
      const raw = new Uint8Array(new TextEncoder().encode(xml));
      const hash = await sha256(raw);
      const issued = issuedOf(xml);
      const key = longRangeKey(id, issued);
      const zipped = await gzip(raw);
      await bucket.put(key, zipped, { httpMetadata: { contentType: "application/gzip" }, customMetadata: { sha256: hash, source: e.url } });
      // It counts only once it reads back whole (as the telegrams' copies, r2Archive.ts).
      const back = await bucket.get(key);
      if (!back || (await sha256(await gunzip(new Uint8Array(await back.arrayBuffer())))) !== hash) throw new Error(`${id}: read back`);
      await db
        .prepare("INSERT OR IGNORE INTO longrange_telegrams (id, kind, office, url, issued_at, fetched_at, hash, bytes, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, kindOf(e.url), officeOfUrl(e.url), e.url, issued, at, hash, zipped.length, key)
        .run();
      added++;
    } catch (err) {
      failed = String(err).slice(0, 300);
    }
  }
  const leftOver = Math.max(0, fresh.length - PER_RUN);
  await log(!failed, entries.length, wanted.length, added, leftOver, failed);
  await db.prepare("DELETE FROM longrange_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { added, leftOver, ok: !failed };
}

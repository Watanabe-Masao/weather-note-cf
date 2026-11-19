// 当時の発表を残す (#220): JMA's typhoon telegrams (台風解析・予報情報, VPTW6x) from its XML feed
// (防災情報XML, PULL型), kept as JMA issued them, every one, for good. Run by the scheduled task
// every 5 minutes (index.ts): the short feed (about 10 hours) each time; the long feed (7 days) the
// first time, and after a stretch it could not read, to catch up. JMA names each telegram uniquely
// (a correction is a new telegram, with its own name), so a name already kept is not fetched again.
//
// Kept apart (2026-11-16 review): the telegram itself (its XML, so it can be read again by a later
// parser), its reading (parsed, with the parser's version), when JMA issued it and when we fetched it,
// and every run's outcome — read with no typhoon telegram is a result too, and a run that failed is
// a gap, kept as such. Nothing kept is written over. The best track (scripts/typhoon-tracks.ts) is
// another series. 出典：気象庁（防災情報XML）。

import { parseTyphoonXml, TYPHOON_XML_PARSER } from "../../shared/typhoonXml";
import type { Db } from "./accounts";
import { doneOnce } from "./once";

export const TYPHOON_ARCHIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS typhoon_telegrams (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    number TEXT,
    issued_at TEXT,
    target_at TEXT,
    fetched_at TEXT NOT NULL,
    hash TEXT NOT NULL,
    xml TEXT NOT NULL,
    parsed TEXT,
    parser INTEGER NOT NULL,
    problems TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS typhoon_telegrams_number ON typhoon_telegrams (number, issued_at)",
  `CREATE TABLE IF NOT EXISTS typhoon_fetch_log (
    at TEXT PRIMARY KEY,
    feed TEXT NOT NULL,
    ok INTEGER NOT NULL,
    entries INTEGER NOT NULL,
    typhoon_entries INTEGER NOT NULL,
    added INTEGER NOT NULL,
    error TEXT
  )`,
];

const FEED_SHORT = "https://www.data.jma.go.jp/developer/xml/feed/extra.xml";
const FEED_LONG = "https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml";
/** The short feed reaches about 10 hours back: after a gap longer than this, read the long one. */
const SHORT_REACH_MS = 8 * 3_600_000;
/** The run log is kept this long (the telegrams are kept for good). */
const LOG_DAYS = 400;
const TYPHOON_TITLE = /台風解析・予報情報/;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface FeedEntry {
  title: string;
  url: string;
  updated: string;
}

/** The feed's entries (Atom): title, link, updated. */
export function feedEntries(atom: string): FeedEntry[] {
  return [...atom.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => ({
    title: /<title>([^<]*)<\/title>/.exec(m[1])?.[1] ?? "",
    url: /<link[^>]*href="([^"]+)"/.exec(m[1])?.[1] ?? "",
    updated: /<updated>([^<]*)<\/updated>/.exec(m[1])?.[1] ?? "",
  }));
}

/** A telegram's name in the feed (…/data/20261111094118_0_VPTW60_010000.xml) and its code. */
export const telegramId = (url: string) =>
  /([^/]+)\.xml$/.exec(url)?.[1] ?? url;
export const telegramKind = (url: string) =>
  /_(VPTW\d\d)_/.exec(url)?.[1] ?? "VPTW6x";

type Fetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetcher = (url) =>
  fetch(url, { signal: AbortSignal.timeout(20_000) });

// Once per database per isolate (a test makes a database of its own).
const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureTyphoonSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of TYPHOON_ARCHIVE_SCHEMA) await db.prepare(q).run();
  });
}

/** One scheduled run: read the feed, keep the new typhoon telegrams, log the run. */
export async function collectTyphoons(
  db: Db,
  now = Date.now(),
  get: Fetcher = defaultFetch,
): Promise<{ added: number; feed: string; ok: boolean }> {
  await ensureTyphoonSchema(db);
  const at = new Date(now).toISOString();
  const lastOk = await db
    .prepare(
      "SELECT at FROM typhoon_fetch_log WHERE ok = 1 ORDER BY at DESC LIMIT 1",
    )
    .first<{ at: string }>();
  const feed =
    !lastOk || now - Date.parse(lastOk.at) > SHORT_REACH_MS
      ? FEED_LONG
      : FEED_SHORT;
  const log = (
    ok: boolean,
    entries: number,
    ty: number,
    added: number,
    error: string | null,
  ) =>
    db
      .prepare(
        "INSERT OR REPLACE INTO typhoon_fetch_log (at, feed, ok, entries, typhoon_entries, added, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        at,
        feed === FEED_LONG ? "long" : "short",
        ok ? 1 : 0,
        entries,
        ty,
        added,
        error,
      )
      .run();
  let entries: FeedEntry[];
  try {
    const r = await get(feed);
    if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
    entries = feedEntries(await r.text());
    if (!entries.length) throw new Error("feed: no entries");
  } catch (e) {
    await log(false, 0, 0, 0, String(e).slice(0, 300));
    return { added: 0, feed, ok: false };
  }
  const typhoon = entries.filter(
    (e) => TYPHOON_TITLE.test(e.title) && /VPTW\d\d/.test(e.url),
  );
  let added = 0;
  let failed: string | null = null;
  for (const e of typhoon) {
    const id = telegramId(e.url);
    if (
      await db
        .prepare("SELECT 1 FROM typhoon_telegrams WHERE id = ?")
        .bind(id)
        .first()
    )
      continue;
    try {
      const r = await get(e.url);
      if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
      const xml = await r.text();
      // A page that is not a telegram (an error page answered 200 …) is not kept: a failure, tried again next run.
      if (!xml.includes("<Report")) throw new Error(`${id}: not a telegram`);
      const t = parseTyphoonXml(xml, telegramKind(e.url));
      await db
        .prepare(
          "INSERT OR IGNORE INTO typhoon_telegrams (id, kind, url, number, issued_at, target_at, fetched_at, hash, xml, parsed, parser, problems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          t.kind,
          e.url,
          t.number,
          t.issuedAt || null,
          t.targetAt,
          at,
          await sha256(xml),
          xml,
          JSON.stringify(t),
          TYPHOON_XML_PARSER,
          t.problems.length ? t.problems.join("／") : null,
        )
        .run();
      added++;
    } catch (err) {
      failed = String(err).slice(0, 300);
    }
  }
  await log(!failed, entries.length, typhoon.length, added, failed);
  // The run log is kept LOG_DAYS (a year and a bit: a season beside the one before).
  await db
    .prepare("DELETE FROM typhoon_fetch_log WHERE at < ?")
    .bind(new Date(now - LOG_DAYS * 86_400_000).toISOString())
    .run();
  return { added, feed, ok: !failed };
}

/** For the administrator: what has been kept, and the runs that could not read (the gaps). */
export async function archiveSummary(db: Db) {
  await ensureTyphoonSchema(db);
  const telegrams = await db
    .prepare(
      "SELECT number, COUNT(*) AS n, MIN(issued_at) AS first, MAX(issued_at) AS last FROM typhoon_telegrams GROUP BY number ORDER BY last DESC LIMIT 50",
    )
    .all();
  const problems = await db
    .prepare(
      "SELECT id, problems FROM typhoon_telegrams WHERE problems IS NOT NULL ORDER BY issued_at DESC LIMIT 20",
    )
    .all();
  const runs = await db
    .prepare(
      "SELECT COUNT(*) AS n, SUM(ok) AS ok, MIN(at) AS first, MAX(at) AS last FROM typhoon_fetch_log",
    )
    .first();
  const gaps = await db
    .prepare(
      "SELECT at, feed, error FROM typhoon_fetch_log WHERE ok = 0 ORDER BY at DESC LIMIT 50",
    )
    .all();
  return {
    telegrams: telegrams.results,
    problems: problems.results,
    runs,
    gaps: gaps.results,
  };
}

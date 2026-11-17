// 警報・注意報の電文を残す (2026-11-17): JMA's warning telegrams for 高知県 (390000), kept as JMA issued
// them — 気象特別警報・警報・注意報 (VPWW53) and the new 気象警報・注意報（Ｒ０６） (VPWW55〜61: 大雨・
// 土砂・高潮・暴風・波浪・大雪・その他注意報). While both are issued both are kept; after VPWW53 ends
// (令和10年度, planned) the R06 ones go on alone. Not kept: the 時系列 (VPWP50, about 1 MB each) and
// VPWW54. Nothing from before (no import). The groundwork: research/warnings (#267).
//
// The same way as the forecast telegrams (forecastArchive.ts): the 随時 feed (extra) each run — the short
// one (about 10 hours), the long one (7 days) the first time, after a stretch it could not read, and while
// telegrams are owed. Each telegram is kept whole (its XML) with its id, kind, when JMA issued it (JST, as
// JMA writes it), when it was fetched (UTC), and its hash; it is read later (parser = 0: not read yet).
// A run's outcome is logged, a failed run as a gap.
//
// Warnings are not issued on a schedule, so there is no "should have come by now" watch (as for the
// forecasts): only failures to fetch are logged, and told in /api/health. A telegram that falls out of
// the long feed (7 days) is taken to be lost (whether JMA still serves it is to be checked). 出典：気象庁（防災情報XML）。

import type { Db } from "./accounts";
import { feedEntries, telegramId, type FeedEntry } from "./typhoonArchive";

export const WARNING_ARCHIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS warning_telegrams (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    office TEXT NOT NULL,
    url TEXT NOT NULL,
    issued_at TEXT,
    fetched_at TEXT NOT NULL,
    hash TEXT NOT NULL,
    xml TEXT NOT NULL,
    parsed TEXT,
    parser INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS warning_telegrams_office ON warning_telegrams (office, kind, issued_at)",
  `CREATE TABLE IF NOT EXISTS warning_fetch_log (
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

export const FEED_SHORT = "https://www.data.jma.go.jp/developer/xml/feed/extra.xml";
export const FEED_LONG = "https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml";
/** The short feed reaches about 10 hours back (#267: 212 entries): after a gap longer than this, read the long one. */
const SHORT_REACH_MS = 8 * 3_600_000;
const LOG_DAYS = 400;
/** A run fetches at most this many telegrams (a scheduled run's subrequests are few); the rest wait for the next. */
const PER_RUN = 25;
/** The kinds kept: VPWW53 and the R06 ones (VPWW55〜61). */
export const WARNING_KINDS = ["VPWW53", "VPWW55", "VPWW56", "VPWW57", "VPWW58", "VPWW59", "VPWW60", "VPWW61"] as const;
/** The offices kept: 高知県 only (2026-11-17). */
export const WARNING_OFFICES = ["390000"] as const;

const kindOf = (url: string) => /_(VP[A-Z]{2}\d\d)_/.exec(url)?.[1] ?? "";
const officeOfUrl = (url: string) => /_(\d{6})\.xml$/.exec(url)?.[1] ?? "";
const issuedOf = (xml: string) => /<ReportDateTime>([^<]+)<\/ReportDateTime>/.exec(xml)?.[1] ?? null;
export const isWanted = (url: string) =>
  (WARNING_KINDS as readonly string[]).includes(kindOf(url)) && (WARNING_OFFICES as readonly string[]).includes(officeOfUrl(url));

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

const ready = new WeakMap<Db, Promise<void>>();
export function ensureWarningSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const q of WARNING_ARCHIVE_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

/** One scheduled run: read the 随時 feed, keep 高知県's new warning telegrams, log the run. */
export async function collectWarnings(db: Db, now = Date.now(), get: Fetcher = defaultFetch): Promise<{ added: number; leftOver: number; ok: boolean; feed: string }> {
  await ensureWarningSchema(db);
  const at = new Date(now).toISOString();
  const lastOk = await db.prepare("SELECT at FROM warning_fetch_log WHERE ok = 1 ORDER BY at DESC LIMIT 1").first<{ at: string }>();
  // A run that left telegrams for the next keeps to the long feed until it has them all.
  const owing = await db.prepare("SELECT left_over FROM warning_fetch_log ORDER BY at DESC LIMIT 1").first<{ left_over: number }>();
  const feed = !lastOk || now - Date.parse(lastOk.at) > SHORT_REACH_MS || (owing?.left_over ?? 0) > 0 ? FEED_LONG : FEED_SHORT;
  const log = (ok: boolean, entries: number, wanted: number, added: number, leftOver: number, error: string | null) =>
    db
      .prepare("INSERT OR REPLACE INTO warning_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
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
    return { added: 0, leftOver: 0, ok: false, feed };
  }
  // The same telegram can be listed more than once (the feed is updated in place): once each.
  const wanted = [...new Map(entries.filter((e) => isWanted(e.url)).map((e) => [telegramId(e.url), e])).values()];
  const fresh: FeedEntry[] = [];
  for (const e of wanted) if (!(await db.prepare("SELECT 1 FROM warning_telegrams WHERE id = ?").bind(telegramId(e.url)).first())) fresh.push(e);
  // The oldest first: a telegram near the end of the long feed's reach is the one that cannot wait.
  fresh.sort((a, b) => (a.updated < b.updated ? -1 : 1));
  let added = 0;
  let failed: string | null = null;
  for (const e of fresh.slice(0, PER_RUN)) {
    const id = telegramId(e.url);
    try {
      const r = await get(e.url);
      if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
      const xml = await r.text();
      if (!xml.includes("<Report")) throw new Error(`${id}: not a telegram`);
      await db
        .prepare("INSERT OR IGNORE INTO warning_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, kindOf(e.url), officeOfUrl(e.url), e.url, issuedOf(xml), at, await sha256(xml), xml)
        .run();
      added++;
    } catch (err) {
      failed = String(err).slice(0, 300);
    }
  }
  const leftOver = Math.max(0, fresh.length - PER_RUN);
  await log(!failed, entries.length, wanted.length, added, leftOver, failed);
  await db.prepare("DELETE FROM warning_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { added, leftOver, ok: !failed, feed };
}

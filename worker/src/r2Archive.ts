// R2 (weather-note-archive): what is kept as files, beside the database (N-1, 2026-11-17).
//
//  1. The telegrams as JMA issued them (予報 forecast_telegrams, 台風 typhoon_telegrams, 警報・注意報
//     warning_telegrams), each gzipped
//     under telegrams/<source>/<yyyy-mm>/<id>.xml.gz. A copy counts only once it has been read back,
//     unzipped and found to have the telegram's own hash (archive_copies). Until every telegram has a
//     checked copy the database keeps its XML too; taking the XML out of the database is a separate
//     step, asked for first (it cannot be undone).
//  2. The surface weather charts of each day (#249), which JMA does not keep for ever: the 3-hourly
//     実況 (quick PNG) and the 予想天気図 (24・48時間) as listed, under wxchart/… with JMA's own names.
//     Each saved chart is a row (wxchart_saved); each run's outcome is logged (wxchart_fetch_log), so a
//     stop can be told. A chart not out yet is tried again on a later run, not counted as lost.
// Run by the scheduled job a few at a time. 出典：気象庁（防災情報XML・気象庁ホームページ）。

import { CHART_HOURS, forecastCharts, quickChartUrl } from "../../shared/wxchart";
import type { Db } from "./accounts";

/** The part of R2's bucket used here (the binding ARCHIVE; a Map stands in for it in the tests). */
export interface Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export const R2_ARCHIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS archive_copies (
    source TEXT NOT NULL,
    id TEXT NOT NULL,
    key TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    copied_at TEXT NOT NULL,
    PRIMARY KEY (source, id)
  )`,
  `CREATE TABLE IF NOT EXISTS wxchart_saved (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    valid_at TEXT NOT NULL,
    base_at TEXT,
    url TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS wxchart_saved_valid ON wxchart_saved (kind, valid_at)",
  `CREATE TABLE IF NOT EXISTS wxchart_fetch_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    saved INTEGER NOT NULL,
    waiting INTEGER NOT NULL,
    error TEXT
  )`,
];

/** Telegrams copied in one run (each is put, read back and checked). */
export const COPY_PER_RUN = 20;
/** Charts saved in one run. */
export const CHARTS_PER_RUN = 6;
/** A 実況 chart is looked for this long after its time (JMA puts it out within about two hours). */
const QUICK_AFTER_MS = 2 * 3_600_000;
/** …and given up after this long (JMA keeps them; a later run of a day back is enough). */
const QUICK_DAYS = 2;
const LOG_DAYS = 400;
const H = 3_600_000;

const SOURCES = [
  { source: "forecast", table: "forecast_telegrams" },
  { source: "typhoon", table: "typhoon_telegrams" },
  { source: "warning", table: "warning_telegrams" },
] as const;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json?(): Promise<unknown>; text(): Promise<string> }>;
const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

const ready = new WeakMap<Db, Promise<void>>();
export function ensureR2Schema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const q of R2_ARCHIVE_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (b: Uint8Array<ArrayBuffer>) => hex(await crypto.subtle.digest("SHA-256", b));
const through = async (data: Uint8Array<ArrayBuffer>, t: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(t)).arrayBuffer());
export const gzip = (data: Uint8Array<ArrayBuffer>) => through(data, new CompressionStream("gzip"));
export const gunzip = (data: Uint8Array<ArrayBuffer>) => through(data, new DecompressionStream("gzip"));

/** Where a telegram's copy goes: by source and the month it was issued (JST), under its own id. */
export const telegramKey = (source: string, id: string, issuedAt: string | null) =>
  `telegrams/${source}/${issuedAt ? issuedAt.slice(0, 7) : "unknown"}/${id}.xml.gz`;

/**
 * Copies telegrams that have no checked copy yet, newest first: gzipped, put, read back, unzipped and
 * compared with the telegram's hash (the SHA-256 of its XML, kept when it was fetched). Only a copy that
 * matches is recorded. Returns how many were copied and how many did not match or failed.
 */
export async function copyTelegrams(db: Db, bucket: Bucket, now = Date.now(), limit = COPY_PER_RUN): Promise<{ copied: number; failed: number }> {
  await ensureR2Schema(db);
  let copied = 0;
  let failed = 0;
  let left = limit;
  for (const { source, table } of SOURCES) {
    if (left <= 0) break;
    let rows: { id: string; issued_at: string | null; hash: string; xml: string }[];
    try {
      rows = (
        await db
          .prepare(
            `SELECT t.id, t.issued_at, t.hash, t.xml FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM archive_copies c WHERE c.source = ? AND c.id = t.id) ORDER BY t.issued_at DESC LIMIT ?`,
          )
          .bind(source, left)
          .all<{ id: string; issued_at: string | null; hash: string; xml: string }>()
      ).results;
    } catch {
      continue; // a table not made yet (a new database)
    }
    for (const r of rows) {
      left--;
      try {
        const raw = new Uint8Array(new TextEncoder().encode(r.xml));
        // The telegram's hash is of its XML as kept; a row whose XML does not give it again is not copied.
        if ((await sha256(raw)) !== r.hash) throw new Error("hash");
        const key = telegramKey(source, r.id, r.issued_at);
        const zipped = await gzip(raw);
        await bucket.put(key, zipped, { httpMetadata: { contentType: "application/gzip" }, customMetadata: { sha256: r.hash, source, id: r.id } });
        const back = await bucket.get(key);
        if (!back || (await sha256(await gunzip(new Uint8Array(await back.arrayBuffer())))) !== r.hash) throw new Error("read back");
        await db
          .prepare("INSERT OR REPLACE INTO archive_copies (source, id, key, bytes, sha256, copied_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(source, r.id, key, zipped.length, r.hash, new Date(now).toISOString())
          .run();
        copied++;
      } catch (e) {
        failed++;
        console.error("weather-note: archive copy", source, r.id, e instanceof Error ? e.message : e);
      }
    }
  }
  return { copied, failed };
}

/** A JST time (ms) as a 実況 chart's day and hour. */
const jstDayHour = (t: number) => {
  const d = new Date(t + 9 * H);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
};

/** The 3-hourly 実況 charts of the last QUICK_DAYS days that should be out by `now`, newest first. */
export function dueQuickCharts(now: number): { url: string; key: string; valid: string }[] {
  const out: { url: string; key: string; valid: string }[] = [];
  for (let back = 0; back <= QUICK_DAYS; back++) {
    const { date } = jstDayHour(now - back * 24 * H);
    for (const hour of [...CHART_HOURS].reverse()) {
      const valid = `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`;
      if (Date.parse(valid) + QUICK_AFTER_MS > now) continue;
      const url = quickChartUrl(date, hour);
      out.push({ url, key: `wxchart/quick/${date.slice(0, 7)}/${url.split("/").pop()}`, valid });
    }
  }
  return out;
}

/**
 * Saves the charts not saved yet: the 実況 of the last days that should be out, and the 予想天気図 JMA
 * lists now (only the latest is listed, so a run that misses one cannot take it later). A chart that is
 * not there yet (404) waits for a later run. Returns what was saved and what waits.
 */
export async function saveCharts(db: Db, bucket: Bucket, now = Date.now(), get: Fetcher = defaultFetch, limit = CHARTS_PER_RUN): Promise<{ saved: number; waiting: number; ok: boolean }> {
  await ensureR2Schema(db);
  const at = new Date(now).toISOString();
  const want: { url: string; key: string; kind: "quick" | "forecast"; valid: string; base: string | null }[] = [];
  let error: string | null = null;
  try {
    const r = await get("https://www.jma.go.jp/bosai/weather_map/data/list.json");
    if (!r.ok) throw new Error(`weather_map list ${r.status}`);
    for (const c of forecastCharts(JSON.parse(await r.text())))
      want.push({ url: c.url, key: `wxchart/forecast/${c.base.slice(0, 7)}/${c.url.split("/").pop()}`, kind: "forecast", valid: c.valid, base: c.base });
  } catch (e) {
    error = String(e instanceof Error ? e.message : e).slice(0, 300);
  }
  for (const q of dueQuickCharts(now)) want.push({ ...q, kind: "quick", base: null });
  const saved = new Set(
    (
      await db
        .prepare("SELECT key FROM wxchart_saved WHERE key IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(want.map((w) => w.key)))
        .all<{ key: string }>()
    ).results.map((r) => r.key),
  );
  const todo = want.filter((w) => !saved.has(w.key));
  let done = 0;
  let waiting = 0;
  for (const w of todo.slice(0, limit)) {
    try {
      const r = await get(w.url);
      if (r.status === 404) {
        waiting++;
        continue;
      }
      if (!r.ok) throw new Error(`${w.url.split("/").pop()}: HTTP ${r.status}`);
      const body = new Uint8Array(await r.arrayBuffer());
      if (body.length < 100 || body[0] !== 0x89 || body[1] !== 0x50) throw new Error(`${w.url.split("/").pop()}: not a PNG`);
      await bucket.put(w.key, body, { httpMetadata: { contentType: "image/png" }, customMetadata: { source: w.url, valid: w.valid } });
      await db
        .prepare("INSERT OR REPLACE INTO wxchart_saved (key, kind, valid_at, base_at, url, bytes, sha256, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(w.key, w.kind, w.valid, w.base, w.url, body.length, await sha256(body), at)
        .run();
      done++;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  waiting += Math.max(0, todo.length - limit);
  await db.prepare("INSERT OR REPLACE INTO wxchart_fetch_log (at, ok, saved, waiting, error) VALUES (?, ?, ?, ?, ?)").bind(at, error ? 0 : 1, done, waiting, error).run();
  await db.prepare("DELETE FROM wxchart_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved: done, waiting, ok: !error };
}

/** How far the copies have come, for the administrator (and the step that takes the XML out of the database). */
export async function r2Summary(db: Db) {
  await ensureR2Schema(db);
  const out: Record<string, { telegrams: number; copied: number }> = {};
  for (const { source, table } of SOURCES) {
    try {
      const n = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      const c = await db.prepare("SELECT COUNT(*) AS n FROM archive_copies WHERE source = ?").bind(source).first<{ n: number }>();
      out[source] = { telegrams: n?.n ?? 0, copied: c?.n ?? 0 };
    } catch {
      out[source] = { telegrams: 0, copied: 0 };
    }
  }
  const charts = await db.prepare("SELECT kind, COUNT(*) AS n, MAX(valid_at) AS latest FROM wxchart_saved GROUP BY kind").all<{ kind: string; n: number; latest: string }>();
  return { telegrams: out, charts: charts.results };
}

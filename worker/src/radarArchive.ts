// 雨雲レーダーの保存 (RD-01/02, 2026-11-17): every 30 minutes, the 実況 tiles around Kochi (shared/radar.ts) put in R2
// as JMA gives them, under radar/hrpns/<JST month>/<JMA's UTC name>/<z>/<x>/<y>.png. JMA's list holds about
// 3 hours, so a time missed by one run is taken by a later one while it is listed (a time that drops out
// of the list unsaved is lost: the hourly look tells when the saving stops, healthJudge.ts).
// Each saved tile is a row (radar_saved, its time in JST); each run's outcome is logged (radar_fetch_log).
// 出典：気象庁ホームページ「雨雲の動き」。

import { isKeptRadarTime, jstOfRadarTime, RADAR_LIST_URL, radarTiles, radarTileUrl, type RadarListItem } from "../../shared/radar";
import type { Db } from "./accounts";
import type { Bucket } from "./r2Archive";

export const RADAR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS radar_saved (
    key TEXT PRIMARY KEY,
    valid_at TEXT NOT NULL,
    jma_time TEXT NOT NULL,
    z INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS radar_saved_valid ON radar_saved (valid_at)",
  `CREATE TABLE IF NOT EXISTS radar_fetch_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    saved INTEGER NOT NULL,
    waiting INTEGER NOT NULL,
    error TEXT
  )`,
];

/** Tiles saved in one run: one time's 3×3 (a backlog of earlier times is taken over the next runs). */
export const RADAR_PER_RUN = 9;
const LOG_DAYS = 400;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;
const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

const ready = new WeakMap<Db, Promise<void>>();
export function ensureRadarSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const q of RADAR_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const radarKey = (jmaTime: string, z: number, x: number, y: number) =>
  `radar/hrpns/${jstOfRadarTime(jmaTime).slice(0, 7)}/${jmaTime}/${z}/${x}/${y}.png`;

/**
 * Saves the tiles not saved yet of the kept times JMA lists now, newest first. Returns what was saved
 * and how many tiles still wait (for a later run).
 */
export async function saveRadar(db: Db, bucket: Bucket, now = Date.now(), get: Fetcher = defaultFetch, limit = RADAR_PER_RUN): Promise<{ saved: number; waiting: number; ok: boolean }> {
  await ensureRadarSchema(db);
  const at = new Date(now).toISOString();
  let error: string | null = null;
  let times: string[] = [];
  try {
    const r = await get(RADAR_LIST_URL);
    if (!r.ok) throw new Error(`nowc list ${r.status}`);
    const list = JSON.parse(await r.text()) as RadarListItem[];
    // The 実況 only (basetime = validtime), of the kept times, newest first.
    times = [...new Set(list.filter((i) => i.basetime === i.validtime && isKeptRadarTime(i.validtime)).map((i) => i.validtime))].sort().reverse();
  } catch (e) {
    error = String(e instanceof Error ? e.message : e).slice(0, 300);
  }
  const want = times.flatMap((t) => radarTiles().map((p) => ({ t, ...p, key: radarKey(t, p.z, p.x, p.y) })));
  const saved = new Set(
    want.length
      ? (
          await db
            .prepare("SELECT key FROM radar_saved WHERE key IN (SELECT value FROM json_each(?))")
            .bind(JSON.stringify(want.map((w) => w.key)))
            .all<{ key: string }>()
        ).results.map((r) => r.key)
      : [],
  );
  const todo = want.filter((w) => !saved.has(w.key));
  let done = 0;
  for (const w of todo.slice(0, limit)) {
    try {
      const url = radarTileUrl(w.t, w.t, w.z, w.x, w.y);
      const r = await get(url);
      if (!r.ok) throw new Error(`${w.t}/${w.z}/${w.x}/${w.y}: HTTP ${r.status}`);
      const body = new Uint8Array(await r.arrayBuffer());
      if (body.length < 50 || body[0] !== 0x89 || body[1] !== 0x50) throw new Error(`${w.t}/${w.z}/${w.x}/${w.y}: not a PNG`);
      await bucket.put(w.key, body, { httpMetadata: { contentType: "image/png" }, customMetadata: { source: url, valid: jstOfRadarTime(w.t) } });
      await db
        .prepare("INSERT OR REPLACE INTO radar_saved (key, valid_at, jma_time, z, x, y, bytes, sha256, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(w.key, jstOfRadarTime(w.t), w.t, w.z, w.x, w.y, body.length, hex(await crypto.subtle.digest("SHA-256", body)), at)
        .run();
      done++;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  const waiting = Math.max(0, todo.length - done);
  await db.prepare("INSERT OR REPLACE INTO radar_fetch_log (at, ok, saved, waiting, error) VALUES (?, ?, ?, ?, ?)").bind(at, error ? 0 : 1, done, waiting, error).run();
  await db.prepare("DELETE FROM radar_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved: done, waiting, ok: !error };
}

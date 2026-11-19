// 雨雲レーダーと解析雨量の保存 (RD-01/02, KC-01, 2026-11-17): every 30 minutes, the tiles around Kochi (shared/radar.ts)
// put in R2 as JMA gives them — the radar's 実況 under radar/hrpns/<JST month>/<JMA's UTC name>/<z>/<x>/<y>.png,
// the 解析雨量 under radar/rasrf/<JST month>/<JMA's UTC name>/<member>/<z>/<x>/<y>.png (its list holds about 12 hours). JMA's list holds about
// 3 hours, so a time missed by one run is taken by a later one while it is listed — the ones about to drop out first (RADAR_RESCUE_MS); a time that drops out
// of the list unsaved is lost: the hourly look tells when the saving stops, healthJudge.ts).
// Each saved tile is a row (radar_saved, its time in JST); each run's outcome is logged (radar_fetch_log).
// 出典：気象庁ホームページ「雨雲の動き」。

import { isKeptRadarTime, jstOfRadarTime, RADAR_LIST_URL, radarTiles, radarTileUrl, RASRF_LIST_URL, rasrfTileUrl, type RadarListItem } from "../../shared/radar";
import type { Db } from "./accounts";
import type { Bucket } from "./r2Archive";
import { doneOnce } from "./once";
import { FEED_REACH_MS } from "./completeness";
import { noteListed } from "./listed";

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
/**
 * 取り戻しの順（#299 P1、2026-11-19）：一覧から間もなく消える時刻（一覧の長さ − この幅より古い）を先に、古い順で。
 * それ以外は新しい順のまま。止まったあとに新しい順だけで取ると、消えかけの古い時刻を取り逃すため。
 * 1回の枚数は増やさない（無料枠の外への問い合わせは1回の起動で 50 まで、ほかの段と分け合う）。
 */
export const RADAR_RESCUE_MS = 60 * 60_000;
const LOG_DAYS = 400;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;
const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureRadarSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of RADAR_SCHEMA) await db.prepare(q).run();
  });
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const radarKey = (jmaTime: string, z: number, x: number, y: number) =>
  `radar/hrpns/${jstOfRadarTime(jmaTime).slice(0, 7)}/${jmaTime}/${z}/${x}/${y}.png`;
export const rasrfKey = (jmaTime: string, member: string, z: number, x: number, y: number) =>
  `radar/rasrf/${jstOfRadarTime(jmaTime).slice(0, 7)}/${jmaTime}/${member}/${z}/${x}/${y}.png`;

/** What is kept: the radar (雨雲の動き, an intensity) and the 解析雨量 (an amount), each from its own list. */
interface Product {
  name: "hrpns" | "rasrf";
  list: string;
  /** The listed (time, member) pairs to keep, newest first. */
  pick: (list: RadarListItem[]) => { t: string; member: string }[];
  url: (t: string, member: string, z: number, x: number, y: number) => string;
  key: (t: string, member: string, z: number, x: number, y: number) => string;
}
const newestFirst = (a: { t: string; member: string }, b: { t: string; member: string }) => (a.t === b.t ? a.member.localeCompare(b.member) : a.t < b.t ? 1 : -1);
const uniq = (xs: { t: string; member: string }[]) => [...new Map(xs.map((x) => [`${x.t}/${x.member}`, x])).values()];
export const RADAR_PRODUCTS: Product[] = [
  {
    name: "hrpns",
    list: RADAR_LIST_URL,
    // The 実況 only (basetime = validtime), of the kept times.
    pick: (list) => uniq(list.filter((i) => i.basetime === i.validtime && isKeptRadarTime(i.validtime)).map((i) => ({ t: i.validtime, member: "none" }))).sort(newestFirst),
    url: (t, _m, z, x, y) => radarTileUrl(t, t, z, x, y),
    key: (t, _m, z, x, y) => radarKey(t, z, x, y),
  },
  {
    name: "rasrf",
    list: RASRF_LIST_URL,
    // The 解析 only (basetime = validtime), of the kept times, each member listed.
    pick: (list) =>
      uniq(
        list
          .filter((i) => i.basetime === i.validtime && isKeptRadarTime(i.validtime) && (!i.elements || i.elements.includes("rasrf")))
          .map((i) => ({ t: i.validtime, member: i.member ?? "none" })),
      ).sort(newestFirst),
    url: (t, m, z, x, y) => rasrfTileUrl(t, m, t, z, x, y),
    key: (t, m, z, x, y) => rasrfKey(t, m, z, x, y),
  },
];

/**
 * Saves the tiles not saved yet of the kept times JMA lists now, newest first, for each product (up to
 * `limit` tiles each). Returns what was saved and how many tiles still wait (for a later run).
 */
export async function saveRadar(db: Db, bucket: Bucket, now = Date.now(), get: Fetcher = defaultFetch, limit = RADAR_PER_RUN, products = RADAR_PRODUCTS): Promise<{ saved: number; waiting: number; ok: boolean }> {
  await ensureRadarSchema(db);
  const at = new Date(now).toISOString();
  let error: string | null = null;
  let done = 0;
  let waiting = 0;
  for (const p of products) {
    let pairs: { t: string; member: string }[] = [];
    try {
      const r = await get(p.list);
      if (!r.ok) throw new Error(`${p.name} list ${r.status}`);
      pairs = p.pick(JSON.parse(await r.text()) as RadarListItem[]);
      // 一覧に載っていた時刻（取れなかった／出ていない、の見分けの証拠。listed.ts）
      await noteListed(db, `radar:${p.name}`, pairs.map((x) => jstOfRadarTime(x.t)), now);
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
    const want = pairs.flatMap(({ t, member }) => radarTiles().map((q) => ({ t, member, ...q, key: p.key(t, member, q.z, q.x, q.y) })));
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
    const left = want.filter((w) => !saved.has(w.key));
    // 間もなく一覧から消える時刻を先に（古い順）、残りは新しい順のまま。
    const ms = (t: string) => Date.parse(jstOfRadarTime(t));
    const newest = pairs.length ? Math.max(...pairs.map((x) => ms(x.t))) : 0;
    const edge = newest - (FEED_REACH_MS[p.name] - RADAR_RESCUE_MS);
    const soon = left.filter((w) => ms(w.t) < edge).sort((a, b) => ms(a.t) - ms(b.t));
    const todo = [...soon, ...left.filter((w) => ms(w.t) >= edge)];
    let mine = 0;
    for (const w of todo.slice(0, limit)) {
      const name = `${p.name} ${w.t}/${w.z}/${w.x}/${w.y}`;
      try {
        const url = p.url(w.t, w.member, w.z, w.x, w.y);
        const r = await get(url);
        if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
        const body = new Uint8Array(await r.arrayBuffer());
        if (body.length < 50 || body[0] !== 0x89 || body[1] !== 0x50) throw new Error(`${name}: not a PNG`);
        await bucket.put(w.key, body, { httpMetadata: { contentType: "image/png" }, customMetadata: { source: url, valid: jstOfRadarTime(w.t) } });
        await db
          .prepare("INSERT OR REPLACE INTO radar_saved (key, valid_at, jma_time, z, x, y, bytes, sha256, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(w.key, jstOfRadarTime(w.t), w.t, w.z, w.x, w.y, body.length, hex(await crypto.subtle.digest("SHA-256", body)), at)
          .run();
        mine++;
      } catch (e) {
        error = String(e instanceof Error ? e.message : e).slice(0, 300);
      }
    }
    done += mine;
    waiting += Math.max(0, todo.length - mine);
  }
  await db.prepare("INSERT OR REPLACE INTO radar_fetch_log (at, ok, saved, waiting, error) VALUES (?, ?, ?, ?, ?)").bind(at, error ? 0 : 1, done, waiting, error).run();
  await db.prepare("DELETE FROM radar_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved: done, waiting, ok: !error };
}

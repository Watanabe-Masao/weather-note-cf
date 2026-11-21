// アメダスの10分ごとの観測（気象庁 bosai の地点の JSON）を、原本のまま R2 に残す（2026-11-21、KC-04）。
//
// 気象庁はこの JSON を約10日しか置かない（KC-04：-10日は 200、-12日は 404）。過去の気象データ（etrn）は
// 1時間ごと・10分ごとの表を長く公開し、視程と天気（自動観測）は時別値の表にある。ただし**10分値の表に視程の
// 列は無い**ので、視程の10分値はここで残さないと後から取れない（ほかの項目は原本として一緒に残る）。
//
// 3時間ごとのファイル（{YYYYMMDD}_{HH}.json、10分ごと18回分）を、その3時間が終わってから取り、gzip して
// amedas/point/<地点>/<yyyy-mm>/<YYYYMMDD>_<HH>.json.gz に置く。保存した1つずつが行（amedas_saved）、
// 毎回の結果が記録（amedas_fetch_log）。まだ出ていない（404）ファイルは後の回に取る。気象庁が置かなく
// なる前（LOOKBACK_DAYS 日）までさかのぼって、取りこぼしを埋める。出典：気象庁ホームページ（アメダス）。

import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Db } from "./accounts";
import { doneOnce } from "./once";
import { type Bucket, gzip } from "./r2Archive";
import { retryingFetch } from "./retry";

export const AMEDAS_ARCHIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS amedas_saved (
    key TEXT PRIMARY KEY,
    point TEXT NOT NULL,
    block_at TEXT NOT NULL,
    times INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS amedas_saved_block ON amedas_saved (point, block_at)",
  `CREATE TABLE IF NOT EXISTS amedas_fetch_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    saved INTEGER NOT NULL,
    waiting INTEGER NOT NULL,
    error TEXT
  )`,
];

/** 気象庁が置く約10日より手前まで、さかのぼって取りこぼしを埋める。 */
export const LOOKBACK_DAYS = 8;
/** 3時間が終わってから、この時間がたったファイルを取る（最後の10分の値が入るのを待つ）。 */
const AFTER_MS = 20 * 60_000;
/** 1回に保存するファイルの数（初めは 8日 × 8 = 64 個を、何回かに分けて）。 */
export const FILES_PER_RUN = 8;
const LOG_DAYS = 400;
const H = 3_600_000;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;
// 一時的な失敗（5xx・429・接続の切れ）は、待ちを延ばしながら3回まで（retry.ts）。
const defaultFetch: Fetcher = retryingFetch(20_000);

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureAmedasSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of AMEDAS_ARCHIVE_SCHEMA) await db.prepare(q).run();
  });
}

/** 保存するアメダスの地点（STATION_PLACES の amedas）。 */
export const amedasPoints = () => [...new Set(Object.values(STATION_PLACES).map((p) => p.amedas))];

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** 3時間ごとのファイルの名前（日本時間の日付と始まりの時）と、R2 の置き場所。 */
export const amedasUrl = (point: string, day: string, hour: number) =>
  `https://www.jma.go.jp/bosai/amedas/data/point/${point}/${day.replaceAll("-", "")}_${String(hour).padStart(2, "0")}.json`;
export const amedasKey = (point: string, day: string, hour: number) =>
  `amedas/point/${point}/${day.slice(0, 7)}/${day.replaceAll("-", "")}_${String(hour).padStart(2, "0")}.json.gz`;

/** 終わってから AFTER_MS たった3時間のファイル（LOOKBACK_DAYS 日前まで）、新しい順。 */
export function dueBlocks(point: string, now: number): { url: string; key: string; blockAt: string }[] {
  const out: { url: string; key: string; blockAt: string }[] = [];
  // 日本時間の「いま」が入る3時間の始まり。
  const j = new Date(now + 9 * H);
  const start = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), Math.floor(j.getUTCHours() / 3) * 3) - 9 * H;
  for (let t = start; t > now - LOOKBACK_DAYS * 24 * H; t -= 3 * H) {
    if (t + 3 * H + AFTER_MS > now) continue;
    const d = new Date(t + 9 * H);
    const day = d.toISOString().slice(0, 10);
    const hour = d.getUTCHours();
    out.push({ url: amedasUrl(point, day, hour), key: amedasKey(point, day, hour), blockAt: `${day}T${String(hour).padStart(2, "0")}:00:00+09:00` });
  }
  return out;
}

/**
 * まだ保存していない3時間のファイルを、新しい順に FILES_PER_RUN まで取って R2 に置く。JSON として読めて、
 * 10分ごとの時刻が1つ以上あるものだけを保存する。まだ出ていない（404）ものは待ちとして数える。
 */
export async function saveAmedas(db: Db, bucket: Bucket, now = Date.now(), get: Fetcher = defaultFetch, limit = FILES_PER_RUN): Promise<{ saved: number; waiting: number; ok: boolean }> {
  await ensureAmedasSchema(db);
  const at = new Date(now).toISOString();
  const want = amedasPoints().flatMap((p) => dueBlocks(p, now).map((b) => ({ ...b, point: p })));
  const saved = new Set(
    (
      await db
        .prepare("SELECT key FROM amedas_saved WHERE key IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(want.map((w) => w.key)))
        .all<{ key: string }>()
    ).results.map((r) => r.key),
  );
  const todo = want.filter((w) => !saved.has(w.key));
  // 取るものが無い回（3時間のうち大半の5分ごとの回）は、記録も書かない（毎回 1 行ずつ、意味の無い記録が増えていた）。
  // 新しい3時間は3時間ごとに出るので、うまくいった記録の間は3時間ほど（見張りは半日で注意）。
  if (!todo.length) return { saved: 0, waiting: 0, ok: true };
  let error: string | null = null;
  let count = 0;
  let waiting = 0;
  for (const w of todo.slice(0, limit)) {
    const name = w.url.split("/").slice(-2).join("/");
    try {
      const r = await get(w.url);
      if (r.status === 404) {
        waiting++;
        continue;
      }
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      const body = new Uint8Array(await r.arrayBuffer());
      let times = 0;
      try {
        times = Object.keys(JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>).length;
      } catch {
        throw new Error(`${name}: not JSON`);
      }
      if (!times) throw new Error(`${name}: no observations`);
      const zipped = await gzip(body);
      await bucket.put(w.key, zipped, { httpMetadata: { contentType: "application/gzip" }, customMetadata: { source: w.url, block: w.blockAt } });
      await db
        .prepare("INSERT OR REPLACE INTO amedas_saved (key, point, block_at, times, bytes, sha256, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(w.key, w.point, w.blockAt, times, zipped.length, hex(await crypto.subtle.digest("SHA-256", body)), at)
        .run();
      count++;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  waiting += Math.max(0, todo.length - limit);
  await db.prepare("INSERT OR REPLACE INTO amedas_fetch_log (at, ok, saved, waiting, error) VALUES (?, ?, ?, ?, ?)").bind(at, error ? 0 : 1, count, waiting, error).run();
  await db.prepare("DELETE FROM amedas_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved: count, waiting, ok: !error };
}

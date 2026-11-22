// 原本の別系統への控え（#370 の2つ目、2026-11-22 渡辺さん「Google ドライブで」）。
//
// R2 に置いた原本（電文の写し・長い先の予報・アメダスの10分値・天気図・雨雲と解析雨量）は、気象庁が消すと二度と
// 取れない。R2 と D1 は同じ Cloudflare の中なので、別の会社（Google ドライブ）にも控えを置く。
//
//   1日ずつ（日本時間でその日に R2 に保存したもの）を tar にまとめ（300ファイルを超える日は分けて `<日付>_1of3.tar` など）、`<日付>.tar` としてドライブの
//   「weather-note-archive」フォルダに置く。中に manifest.json（鍵・表・大きさ・sha256）を入れる。
//   置いたら読み戻して sha256 が同じかを確かめ、確かめられた日だけを offsite_copies に「済み」として残す。
//   まだの日は、定時処理（5分ごと）の1回に1つずつ、古い日から（初回は取り始めの日までさかのぼる）。
//
// 権限は drive.file（このアプリが作ったファイルだけ触れる。ほかのファイルは見えない）。鍵は渡辺さんが Cloudflare の
// 秘密の値に入れる（GDRIVE_CLIENT_ID・GDRIVE_CLIENT_SECRET・GDRIVE_REFRESH_TOKEN）。無ければ何もしない（未設定）。
// ドライブのファイルを消したり置き換えたりはしない（同じ日をもう一度置くときは、新しいファイルとして置く）。
// 肌感の記録などのユーザーのデータは入れない（入れるかは別に決める）。

import type { Db } from "./accounts";
import type { Bucket } from "./r2Archive";
import { doneOnce } from "./once";
import { retryingFetch } from "./retry";

const H = 3_600_000;
const DAY = 24 * H;
/** その日が終わってから置くまで（その日の最後の保存が入りきるのを待つ）。 */
const AFTER_MS = 1 * H;
const FOLDER = "weather-note-archive";
/** 1つの tar の上限（Worker のメモリに収まるように）。超えたら置かずに失敗として残す。 */
const MAX_BYTES = 60 * 1024 * 1024;
const LOG_DAYS = 400;
/** 1つの tar に入れるファイルの数（R2 を読む回数が、定時処理の1回の決まりの内に収まるように）。1日が多ければ分ける。 */
export const PART_FILES = 300;

export interface DriveEnv {
  GDRIVE_CLIENT_ID?: string;
  GDRIVE_CLIENT_SECRET?: string;
  GDRIVE_REFRESH_TOKEN?: string;
}
export const driveConfigured = (e: DriveEnv) => !!(e.GDRIVE_CLIENT_ID && e.GDRIVE_CLIENT_SECRET && e.GDRIVE_REFRESH_TOKEN);

export const OFFSITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS offsite_copies (
    day TEXT NOT NULL,
    part INTEGER NOT NULL,
    parts INTEGER NOT NULL,
    name TEXT NOT NULL,
    file_id TEXT NOT NULL,
    files INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    PRIMARY KEY (day, part)
  )`,
  `CREATE TABLE IF NOT EXISTS offsite_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS offsite_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    day TEXT,
    error TEXT
  )`,
];
const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureOffsiteSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of OFFSITE_SCHEMA) await db.prepare(q).run();
  });
}

/** R2 に置いたものの記録（表・鍵・その日を決める保存の時刻・大きさ・sha256）。表がまだ無いものは飛ばす。 */
const SOURCES: { table: string; key: string; at: string; extra: string }[] = [
  { table: "archive_copies", key: "key", at: "copied_at", extra: "sha256" },
  { table: "longrange_telegrams", key: "r2_key", at: "fetched_at", extra: "hash" },
  { table: "amedas_saved", key: "key", at: "fetched_at", extra: "sha256" },
  { table: "wxchart_saved", key: "key", at: "fetched_at", extra: "sha256" },
  { table: "radar_saved", key: "key", at: "fetched_at", extra: "sha256" },
];

async function soft<T>(f: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (/no such table/i.test(String(e))) return empty;
    throw e;
  }
}

const jstDay = (ms: number) => new Date(ms + 9 * H).toISOString().slice(0, 10);
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** まだ置いていない日（古い順）：保存の始まりの日から、終わって1時間たった日まで。 */
export async function pendingDays(db: Db, now: number): Promise<string[]> {
  await ensureOffsiteSchema(db);
  // 保存の始まりの日は一度見つけたら offsite_state に残す（毎回すべての表を読まない）。
  let first = (await db.prepare("SELECT value FROM offsite_state WHERE key = 'first'").first<{ value: string }>())?.value ?? null;
  if (!first) {
    for (const s of SOURCES) {
      const r = await soft(() => db.prepare(`SELECT MIN(date(${s.at}, '+9 hours')) AS d FROM ${s.table}`).first<{ d: string | null }>(), null);
      if (r?.d && (!first || r.d < first)) first = r.d;
    }
    if (!first) return [];
    await db.prepare("INSERT OR REPLACE INTO offsite_state (key, value) VALUES ('first', ?)").bind(first).run();
  }
  const last = jstDay(now - AFTER_MS - DAY); // 終わって1時間たった日のうち、いちばん新しい日
  // 分けた日は、全部の部分を置き終えた日だけが済み。
  const have = new Set((await db.prepare("SELECT day FROM offsite_copies GROUP BY day HAVING COUNT(*) >= MAX(parts)").all<{ day: string }>()).results.map((r) => r.day));
  const out: string[] = [];
  for (let d = first; d <= last; d = addDay(d, 1)) if (!have.has(d)) out.push(d);
  return out;
}

export type DayFile = { key: string; table: string; bytes: number; sha256: string };

/** その日に R2 に保存したもの（鍵の重なりは1つに）。 */
export async function filesOfDay(db: Db, day: string): Promise<DayFile[]> {
  // 保存の時刻は UTC の ISO（…Z）。日本時間のその日の 0時〜翌0時。
  const from = new Date(Date.parse(`${day}T00:00:00+09:00`)).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00+09:00`) + DAY).toISOString();
  const seen = new Map<string, { key: string; table: string; sha: string }>();
  for (const s of SOURCES) {
    const rows = await soft(
      async () =>
        (
          await db
            .prepare(`SELECT ${s.key} AS key, ${s.extra} AS sha FROM ${s.table} WHERE ${s.at} >= ? AND ${s.at} < ? ORDER BY ${s.key}`)
            .bind(from, to)
            .all<{ key: string; sha: string }>()
        ).results,
      [],
    );
    for (const r of rows) if (!seen.has(r.key)) seen.set(r.key, { key: r.key, table: s.table, sha: r.sha });
  }
  return [...seen.values()].map((x) => ({ key: x.key, table: x.table, bytes: 0, sha256: x.sha }));
}

// ---- tar（ustar）：ヘッダー512バイト＋中身を512バイトの倍数に。最後に空の512バイトを2つ。----
const enc = new TextEncoder();
function header(name: string, size: number, mtime: number): Uint8Array {
  const h = new Uint8Array(512);
  let prefix = "";
  let base = name;
  if (enc.encode(name).length > 100) {
    const i = name.lastIndexOf("/", 154);
    prefix = name.slice(0, i);
    base = name.slice(i + 1);
  }
  const put = (s: string, at: number, len: number) => h.set(enc.encode(s).slice(0, len), at);
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, "0");
  put(base, 0, 100);
  put(oct(0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  put("        ", 148, 8);
  put("0", 156, 1);
  put("ustar\u000000", 257, 8);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\u0000 `, 148, 8);
  return h;
}
export function tar(entries: { name: string; data: Uint8Array }[], mtime: number): Uint8Array {
  let size = 1024;
  for (const e of entries) size += 512 + Math.ceil(e.data.length / 512) * 512;
  const out = new Uint8Array(size);
  let at = 0;
  for (const e of entries) {
    out.set(header(e.name, e.data.length, mtime), at);
    at += 512;
    out.set(e.data, at);
    at += Math.ceil(e.data.length / 512) * 512;
  }
  return out;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (b: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));

/** その日の part 番目（1から）の tar を作る（R2 から読む）。無いファイルは manifest に missing として残す。 */
export async function bundleDay(db: Db, bucket: Bucket, day: string, now: number, done: Set<number> = new Set(), partFiles = PART_FILES) {
  const all = await filesOfDay(db, day);
  const parts = Math.max(1, Math.ceil(all.length / partFiles));
  let part = 1;
  while (done.has(part)) part++;
  const files = all.slice((part - 1) * partFiles, part * partFiles);
  const entries: { name: string; data: Uint8Array }[] = [];
  const missing: string[] = [];
  let total = 0;
  for (const f of files) {
    const o = await bucket.get(f.key);
    if (!o) {
      missing.push(f.key);
      continue;
    }
    const data = new Uint8Array(await o.arrayBuffer());
    f.bytes = data.length;
    total += data.length;
    if (total > MAX_BYTES) throw new Error(`${day}: ${Math.round(total / 1_048_576)}MB を超えた（${MAX_BYTES / 1_048_576}MB まで）`);
    entries.push({ name: f.key, data });
  }
  const manifest = {
    v: 1,
    day,
    part,
    parts,
    madeAt: new Date(now).toISOString(),
    note: "Weather Note の R2 の原本の控え（日本時間でこの日に保存したもの）。sha256 は電文・長い先の予報は元の XML の、ほかはファイルそのものの値。出典：気象庁。",
    files: files.filter((f) => !missing.includes(f.key)),
    missing,
  };
  const body = tar([{ name: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 1)) }, ...entries], now);
  return { body, files: entries.length, missing, part, parts, name: parts === 1 ? `${day}.tar` : `${day}_${part}of${parts}.tar` };
}

// ---- Google ドライブ ----
type Get = (url: string, init?: RequestInit) => Promise<Response>;

/** 鍵や応答の中身はエラーの文言に入れない（状態の番号と、Google の error の種類だけ）。 */
async function fail(what: string, r: Response): Promise<never> {
  let kind = "";
  try {
    const j = (await r.json()) as { error?: string | { status?: string } };
    kind = typeof j.error === "string" ? j.error : (j.error?.status ?? "");
  } catch {
    /* 中身は読まない */
  }
  throw new Error(`${what}: HTTP ${r.status}${kind ? ` ${kind}` : ""}`);
}

export class Drive {
  private token: string | null = null;
  constructor(
    private env: Required<DriveEnv>,
    private get: Get = retryingFetch(30_000),
  ) {}
  private async auth(): Promise<string> {
    if (this.token) return this.token;
    const r = await this.get("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.env.GDRIVE_CLIENT_ID, client_secret: this.env.GDRIVE_CLIENT_SECRET, refresh_token: this.env.GDRIVE_REFRESH_TOKEN, grant_type: "refresh_token" }).toString(),
    });
    if (!r.ok) await fail("ドライブの鍵", r);
    this.token = ((await r.json()) as { access_token: string }).access_token;
    return this.token;
  }
  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    return this.get(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await this.auth()}` } });
  }
  /** このアプリが作ったフォルダ（無ければ作る）。 */
  async folder(): Promise<string> {
    const q = encodeURIComponent(`name = '${FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const r = await this.call(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
    if (!r.ok) await fail("ドライブのフォルダを探す", r);
    const found = ((await r.json()) as { files: { id: string }[] }).files[0];
    if (found) return found.id;
    const c = await this.call("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }),
    });
    if (!c.ok) await fail("ドライブのフォルダを作る", c);
    return ((await c.json()) as { id: string }).id;
  }
  /** 置く（resumable：始めて、1回で全部を送る）。ファイルの id を返す。 */
  async upload(folder: string, name: string, body: Uint8Array): Promise<string> {
    const s = await this.call("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "POST",
      headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "application/x-tar", "x-upload-content-length": String(body.length) },
      body: JSON.stringify({ name, parents: [folder], mimeType: "application/x-tar" }),
    });
    if (!s.ok) await fail("ドライブに置き始める", s);
    const at = s.headers.get("location");
    if (!at) throw new Error("ドライブに置き始める: 置き場所が返ってこない");
    const p = await this.get(at, { method: "PUT", headers: { "content-type": "application/x-tar" }, body: body as Uint8Array<ArrayBuffer> });
    if (!p.ok) await fail("ドライブに置く", p);
    return ((await p.json()) as { id: string }).id;
  }
  /** 読み戻す。 */
  async download(id: string): Promise<Uint8Array> {
    const r = await this.call(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    if (!r.ok) await fail("ドライブから読み戻す", r);
    return new Uint8Array(await r.arrayBuffer());
  }
}

export interface OffsiteResult {
  configured: boolean;
  day: string | null;
  files: number;
  bytes: number;
  missing: number;
  pending: number;
}

/** 定時処理の1回：まだの日を1日だけ置く。鍵が無ければ何もしない。 */
export async function copyOffsite(db: Db, bucket: Bucket, env: DriveEnv, now: number, drive?: Pick<Drive, "folder" | "upload" | "download">, partFiles = PART_FILES): Promise<OffsiteResult> {
  if (!driveConfigured(env)) return { configured: false, day: null, files: 0, bytes: 0, missing: 0, pending: 0 };
  const days = await pendingDays(db, now);
  const day = days[0];
  if (!day) return { configured: true, day: null, files: 0, bytes: 0, missing: 0, pending: 0 };
  const at = new Date(now).toISOString();
  try {
    const d = drive ?? new Drive(env as Required<DriveEnv>);
    const done = new Set((await db.prepare("SELECT part FROM offsite_copies WHERE day = ?").bind(day).all<{ part: number }>()).results.map((r) => r.part));
    const b = await bundleDay(db, bucket, day, now, done, partFiles);
    const sha = await sha256(b.body);
    let folder = (await db.prepare("SELECT value FROM offsite_state WHERE key = 'folder'").first<{ value: string }>())?.value;
    if (!folder) {
      folder = await d.folder();
      await db.prepare("INSERT OR REPLACE INTO offsite_state (key, value) VALUES ('folder', ?)").bind(folder).run();
    }
    const name = b.name;
    const id = await d.upload(folder, name, b.body);
    if ((await sha256(await d.download(id))) !== sha) throw new Error(`${name}: 読み戻した中身がちがう`);
    await db
      .prepare("INSERT OR REPLACE INTO offsite_copies (day, part, parts, name, file_id, files, bytes, sha256, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(day, b.part, b.parts, name, id, b.files, b.body.length, sha, at)
      .run();
    await db.prepare("INSERT OR REPLACE INTO offsite_log (at, ok, day, error) VALUES (?, 1, ?, ?)").bind(at, day, b.missing.length ? `R2 に無い ${b.missing.length}件` : null).run();
    await db.prepare("DELETE FROM offsite_log WHERE at < ?").bind(new Date(now - LOG_DAYS * DAY).toISOString()).run();
    const finished = done.size + 1 >= b.parts;
    return { configured: true, day, files: b.files, bytes: b.body.length, missing: b.missing.length, pending: days.length - (finished ? 1 : 0) };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    // フォルダが消された・見えなくなったときは、次の回に探し直す。
    if (/HTTP 404/.test(msg)) await db.prepare("DELETE FROM offsite_state WHERE key = 'folder'").run();
    await db.prepare("INSERT OR REPLACE INTO offsite_log (at, ok, day, error) VALUES (?, 0, ?, ?)").bind(at, day, msg).run();
    throw e;
  }
}

export type OffsiteSummary = {
  configured: boolean;
  lastDay: string | null;
  lastAt: string | null;
  days: number;
  bytes: number;
  pending: number;
  oldestPending: string | null;
  lastError: { at: string; day: string | null; error: string } | null;
};

/** 保守の画面・見張り・毎朝の点検に。 */
export async function offsiteSummary(db: Db, now: number, env: DriveEnv): Promise<OffsiteSummary> {
  await ensureOffsiteSchema(db);
  const c = await db.prepare("SELECT MAX(day) AS lastDay, MAX(uploaded_at) AS lastAt, COUNT(DISTINCT day) AS days, COALESCE(SUM(bytes), 0) AS bytes FROM offsite_copies").first<{ lastDay: string | null; lastAt: string | null; days: number; bytes: number }>();
  const pend = await pendingDays(db, now);
  const err = await db.prepare("SELECT at, day, error FROM offsite_log WHERE ok = 0 AND at > COALESCE((SELECT MAX(at) FROM offsite_log WHERE ok = 1), '') ORDER BY at DESC LIMIT 1").first<{ at: string; day: string | null; error: string }>();
  return {
    configured: driveConfigured(env),
    lastDay: c?.lastDay ?? null,
    lastAt: c?.lastAt ?? null,
    days: c?.days ?? 0,
    bytes: c?.bytes ?? 0,
    pending: pend.length,
    oldestPending: pend[0] ?? null,
    lastError: err ?? null,
  };
}

export function offsiteLine(s: OffsiteSummary): string {
  if (!s.configured) return "・ドライブの控え：まだ設定されていません（鍵が入ると、保存の始まりの日から1日ずつ置きます）。";
  return `・ドライブの控え：${s.days}日分（${(s.bytes / 1_048_576).toFixed(1)}MB）、最後に置いた日 ${s.lastDay ?? "—"}${s.pending ? `・まだ ${s.pending}日（${s.oldestPending} から）` : "・遅れなし"}${s.lastError ? `・失敗：${s.lastError.error}` : ""}`;
}

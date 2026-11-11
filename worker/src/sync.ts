// β③: keeping a person's reports on the server, so they survive a lost phone and reach their other
// devices. There are no accounts. A person holds a 同期キー (sync key): 128 random bits that only
// their devices know. Each key has its own Durable Object (its own SQLite database), so the data
// of different people never share a table, a query or a lock.
//
//   key ──SHA-256──▶ Durable Object name ──▶ one SQLite database: that person's reports
//
// The server never stores the key itself, only its hash (as the object's name). Whoever holds the
// key can read and change those reports and nobody else can reach them; 128 bits cannot be
// guessed. Losing the key means losing the server copy (the devices keep theirs).
//
// The protocol is a log: every accepted change gets the next number (seq). A device sends the
// reports it changed and asks for everything after the last seq it has seen. A change is accepted
// only when it is newer (updatedAt) than the copy held, so devices that sync in any order end with
// the same reports. A deletion is a change too (deleted: true), so it reaches the other devices.

export const KEY_RE = /^[A-Z2-7]{26}$/;
/** Reports in one push. */
export const MAX_PUSH = 200;
/** Reports in one pull answer. */
export const PULL_PAGE = 200;
/** One report, as JSON. */
export const MAX_REPORT_BYTES = 64 * 1024;
/** Reports one key may hold (years of several reports a day). */
export const MAX_REPORTS = 20_000;

/** The sync key as typed or pasted: case, spaces and hyphens do not matter. */
export function normaliseKey(raw: string | null | undefined): string | null {
  const k = (raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  return KEY_RE.test(k) ? k : null;
}

export async function keyHash(key: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`weather-note-sync:${key}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the server needs from a report: the rest is kept as it came. */
export interface SyncReport {
  id: string;
  updatedAt: number;
  [k: string]: unknown;
}

export class SyncRefused extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function checkReports(raw: unknown): SyncReport[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SyncRefused("記録の形が正しくありません。");
  if (raw.length > MAX_PUSH) throw new SyncRefused(`一度に送れる記録は${MAX_PUSH}件までです。`);
  return raw.map((r) => {
    const ok =
      r &&
      typeof r === "object" &&
      typeof r.id === "string" &&
      r.id.length > 0 &&
      r.id.length <= 80 &&
      typeof r.updatedAt === "number" &&
      Number.isFinite(r.updatedAt) &&
      typeof r.at === "string";
    if (!ok) throw new SyncRefused("記録の形が正しくありません。");
    if (JSON.stringify(r).length > MAX_REPORT_BYTES) throw new SyncRefused("大きすぎる記録があります。");
    return r as SyncReport;
  });
}

/** The part of Durable Object SQL storage used here (also met by a test stand-in). */
export interface Sql {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] };
}

export interface PullAnswer {
  reports: SyncReport[];
  /** The last seq in this answer (ask after it next time). */
  seq: number;
  /** More changes are waiting after `seq`. */
  more: boolean;
}

/** One person's reports: the log and its rules. Pure SQL, no network. */
export class SyncCore {
  constructor(private sql: Sql) {
    sql.exec("CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS reports_seq ON reports (seq)");
    sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
  }

  private lastSeq(): number {
    const row = this.sql.exec("SELECT v FROM meta WHERE k = 'seq'").toArray()[0];
    return Number(row?.v ?? 0);
  }

  count(): number {
    return Number(this.sql.exec("SELECT COUNT(*) AS n FROM reports").toArray()[0]?.n ?? 0);
  }

  /** Keeps each report that is newer than the copy held. Returns how many were taken. */
  push(list: SyncReport[]): number {
    let seq = this.lastSeq();
    let total = this.count();
    let taken = 0;
    for (const r of list) {
      const held = this.sql.exec("SELECT updated_at FROM reports WHERE id = ?", r.id).toArray()[0];
      if (held && Number(held.updated_at) >= r.updatedAt) continue;
      if (!held && total >= MAX_REPORTS) throw new SyncRefused("保存できる記録の上限に達しました。", 413);
      seq += 1;
      this.sql.exec(
        "INSERT INTO reports (id, updated_at, seq, body) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at, seq = excluded.seq, body = excluded.body",
        r.id,
        r.updatedAt,
        seq,
        JSON.stringify(r),
      );
      if (!held) total += 1;
      taken += 1;
    }
    if (taken) this.sql.exec("INSERT INTO meta (k, v) VALUES ('seq', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", seq);
    return taken;
  }

  /** The changes after `since`, oldest first, one page at a time. */
  pull(since: number): PullAnswer {
    const rows = this.sql.exec("SELECT seq, body FROM reports WHERE seq > ? ORDER BY seq LIMIT ?", since, PULL_PAGE).toArray();
    return {
      reports: rows.map((r) => JSON.parse(String(r.body)) as SyncReport),
      seq: rows.length ? Number(rows[rows.length - 1].seq) : Math.max(since, 0),
      more: rows.length === PULL_PAGE,
    };
  }

  /** Removes the server copy of every report of this key (the devices keep theirs). */
  erase(): void {
    this.sql.exec("DELETE FROM reports");
    this.sql.exec("DELETE FROM meta");
  }
}

/** One sync key's store. Its storage is SQLite (wrangler.jsonc: new_sqlite_classes). */
export class ReportSync {
  private core: SyncCore;
  constructor(state: { storage: { sql: Sql } }) {
    this.core = new SyncCore(state.storage.sql);
  }

  async fetch(req: Request): Promise<Response> {
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    try {
      if (req.method === "DELETE") {
        this.core.erase();
        return json({ erased: true });
      }
      const body = (await req.json()) as { push?: unknown; since?: unknown };
      const taken = this.core.push(checkReports(body.push));
      const since = typeof body.since === "number" && Number.isInteger(body.since) && body.since >= 0 ? body.since : null;
      const pulled = since == null ? null : this.core.pull(since);
      return json({ taken, total: this.core.count(), ...(pulled ?? {}) });
    } catch (e) {
      if (e instanceof SyncRefused) return json({ error: e.message }, e.status);
      console.error("weather-note: sync failure", e);
      return json({ error: "同期に失敗しました。時間をおいて再試行してください。" }, 500);
    }
  }
}

/** Where the Worker sends a sync request: the key's own store. */
export interface SyncEnv {
  SYNC?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
  };
}

const MAX_BODY = MAX_PUSH * MAX_REPORT_BYTES;

/** POST /api/sync (push and pull) and DELETE /api/sync (erase the server copy). */
export async function handleSync(req: Request, env: SyncEnv): Promise<Response> {
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "POST か DELETE で送ってください。" }, 405);
  const key = normaliseKey(req.headers.get("Authorization")?.replace(/^Bearer\s+/i, ""));
  if (!key) return json({ error: "同期キーが正しくありません。" }, 401);
  if (!env.SYNC) return json({ error: "同期はこのサーバーではまだ使えません。" }, 503);
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BODY) return json({ error: "一度に送る量が多すぎます。" }, 413);
  const stub = env.SYNC.get(env.SYNC.idFromName(await keyHash(key)));
  const res = await stub.fetch(new Request("https://sync/", { method: req.method, body: req.method === "POST" ? await req.text() : undefined }));
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

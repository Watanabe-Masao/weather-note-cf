// Accounts, reports on the server, and the ground for analysis (one D1 database).
//
// Who can use it: only people the administrator issued an account to. There is no sign-up. The
// administrator adds a person in the app's 管理 screen; the server makes a login ID's password (16
// random characters, shown once) and keeps only a salted hash of it. The very first administrator
// is made once, with a setup code set as a secret (SETUP_CODE) in Cloudflare.
//
// What a logged-in person can reach: their own reports only. Whose reports they are is decided
// here from the session, never from anything the app sends. The database itself is not reachable
// from the internet; only this Worker's binding can query it.
//
// The ground for analysis: every report keeps its whole body plus the columns analysis filters on;
// each person has a research ID (random, unrelated to the login ID); consent to research is kept as
// a history (given, withdrawn, with its version). The view `research_reports` shows only the
// reports of people whose latest answer is "yes", under their research ID.

export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
/** The part of D1 used here (also met by the tests' SQLite stand-in). */
export interface Db {
  prepare(query: string): Stmt;
  batch(statements: Stmt[]): Promise<unknown[]>;
}

export interface AccountsEnv {
  DB?: Db;
  SETUP_CODE?: string;
}

import {
  checkSettings,
  checkSubscription,
  NOTIFY_SCHEMA,
  removeSubscription,
  rememberOrigin,
  reportMessage,
  saveSettings,
  saveSubscription,
  sendToUser,
  settingsOf,
  vapidKeys,
} from "./notify";

// ---- schema ----------------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;
export const RESEARCH_CONSENT_VERSION = 2; // 2: taking consent back also removes you from copies already exported (#45)

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    pw_hash TEXT NOT NULL,
    pw_salt TEXT NOT NULL,
    pw_iter INTEGER NOT NULL,
    research_id TEXT NOT NULL UNIQUE,
    sync_seq INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    created_at INTEGER NOT NULL,
    last_login INTEGER,
    disabled_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)",
  `CREATE TABLE IF NOT EXISTS reports (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL,
    station TEXT,
    sensation INTEGER,
    exposure TEXT,
    wind_felt TEXT,
    sky TEXT,
    body TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  "CREATE INDEX IF NOT EXISTS reports_user_seq ON reports (user_id, seq)",
  `CREATE TABLE IF NOT EXISTS consents (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL,
    granted INTEGER NOT NULL,
    at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS consents_user ON consents (user_id, kind, at)",
  `CREATE VIEW IF NOT EXISTS research_reports AS
    SELECT u.research_id, r.id AS report_id, r.at, r.station, r.sensation, r.exposure, r.wind_felt, r.sky, r.body
    FROM reports r JOIN users u ON u.id = r.user_id
    WHERE r.deleted = 0 AND (
      SELECT c.granted FROM consents c
      WHERE c.user_id = r.user_id AND c.kind = 'research'
      ORDER BY c.at DESC, c.rowid DESC LIMIT 1
    ) = 1`,
  // v2 (review 2026-11-12): a report made before the person's last withdrawal stays out after they
  // consent again — it went with the old research ID, and showing it under the new one would tie
  // the two IDs together (the report ID is the same). The first view stays for old deployments.
  `CREATE VIEW IF NOT EXISTS research_reports_v2 AS
    SELECT u.research_id, r.id AS report_id, r.at, r.station, r.sensation, r.exposure, r.wind_felt, r.sky, r.body
    FROM reports r JOIN users u ON u.id = r.user_id
    WHERE r.deleted = 0 AND (
      SELECT c.granted FROM consents c
      WHERE c.user_id = r.user_id AND c.kind = 'research'
      ORDER BY c.at DESC, c.rowid DESC LIMIT 1
    ) = 1 AND r.at > coalesce((
      SELECT strftime('%Y-%m-%dT%H:%M:%fZ', max(c.at) / 1000.0, 'unixepoch') FROM consents c
      WHERE c.user_id = r.user_id AND c.kind = 'research' AND c.granted = 0
    ), '')`,
  // v3 (review #86): v2 with when each row last arrived, so one run of pages can be cut at the
  // moment it started (a report synced during the run, with an older time, would otherwise fall
  // behind the cursor and be missed by that run only).
  `CREATE VIEW IF NOT EXISTS research_reports_v3 AS
    SELECT u.research_id, r.id AS report_id, r.at, r.station, r.sensation, r.exposure, r.wind_felt, r.sky, r.body, r.received_at
    FROM reports r JOIN users u ON u.id = r.user_id
    WHERE r.deleted = 0 AND (
      SELECT c.granted FROM consents c
      WHERE c.user_id = r.user_id AND c.kind = 'research'
      ORDER BY c.at DESC, c.rowid DESC LIMIT 1
    ) = 1 AND r.at > coalesce((
      SELECT strftime('%Y-%m-%dT%H:%M:%fZ', max(c.at) / 1000.0, 'unixepoch') FROM consents c
      WHERE c.user_id = r.user_id AND c.kind = 'research' AND c.granted = 0
    ), '')`,
];

// The research data that left the server (#45): every export is logged, and every withdrawal
// (consent taken back, account deleted) is kept by research ID, so exported copies can drop it.
const RESEARCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS research_withdrawals (
    research_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    reason TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS export_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    path TEXT NOT NULL,
    first INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    dataset TEXT
  )`,
  // A token for taking the research data out (#55): read-only, short-lived, stored as a hash,
  // shown once. A new one replaces the old; it can be revoked.
  // The administrator typed the password again on this session (#86): the research data needs it
  // within REAUTH_MS, so a phone left unlocked does not open everyone's reports.
  `CREATE TABLE IF NOT EXISTS session_reauth (
    token_hash TEXT PRIMARY KEY,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS export_tokens (
    token_hash TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
];

/** How long typing the password again opens the research data (#86). */
export const REAUTH_MS = 15 * 60_000;
/** The status that asks for the password again (the app shows a password field). */
export const REAUTH_STATUS = 428;

/** Whether this session typed the password again recently enough. */
async function reauthed(db: Db, req: Request, now: number): Promise<boolean> {
  const token = cookieOf(req, COOKIE);
  if (!token) return false;
  const row = await db.prepare("SELECT at FROM session_reauth WHERE token_hash = ?").bind(await sha256(token)).first<{ at: number }>();
  return !!row && now - row.at <= REAUTH_MS;
}

/** How long an export token lasts. */
export const EXPORT_TOKEN_MS = 24 * 3600_000;
/** Rows per page of the research export. */
export const RESEARCH_PAGE = 1000;
/** At most this many late rows on a run's last page (a run is minutes; more would be a very large sync). */
const RESEARCH_LATE_MAX = 2_000;

/**
 * A report as it leaves for research (#55): without the account it belongs to (`owner`), which
 * would tie the research ID back to the person.
 */
export function forResearch(report: Record<string, unknown>): Record<string, unknown> {
  const { owner: _owner, ...rest } = report;
  return rest;
}

const ready = new WeakMap<Db, Promise<void>>();
const ALL_SCHEMA = [...SCHEMA, ...NOTIFY_SCHEMA, ...RESEARCH_SCHEMA];

/** Creates the tables once per database (idempotent: safe on every cold start). */
export function ensureSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const q of ALL_SCHEMA) await db.prepare(q).run();
      const row = await db.prepare("SELECT v FROM schema_version").first<{ v: number }>();
      if (!row) await db.prepare("INSERT INTO schema_version (v) VALUES (?)").bind(SCHEMA_VERSION).run();
    })();
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

// ---- secrets ---------------------------------------------------------------------------------

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // no 0/O, 1/l/I

/** A new password: 16 characters (about 93 bits), without letters that look alike. */
export function newPassword(): string {
  let out = "";
  while (out.length < 16) {
    for (const b of random(32)) if (b < 224 && out.length < 16) out += PW_ALPHABET[b % 56]; // 224 = 4·56: no bias
  }
  return out;
}

export const newId = () => hex(random(16));

/**
 * The stored form of a password. Passwords are always made by the server (never chosen by people),
 * so they are long and random; a moderate PBKDF2 count is enough and keeps login fast on Workers.
 */
export const PW_ITER = 20_000;
export async function hashPassword(password: string, salt: string, iter = PW_ITER): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, key, 256);
  return hex(bits);
}

const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

/** Equal strings in time that does not depend on where they differ. */
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

// ---- sessions --------------------------------------------------------------------------------

export const COOKIE = "wn_session";
export const SESSION_DAYS = 180;
const DAY = 86_400_000;
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60_000;

const cookieOf = (req: Request, name: string) =>
  (req.headers.get("Cookie") ?? "")
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === name)?.[1] ?? null;

const sessionCookie = (token: string, maxAge: number) =>
  `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export interface User {
  id: string;
  login_id: string;
  name: string | null;
  role: "user" | "admin";
  research_id: string;
  disabled_at: number | null;
}

async function startSession(db: Db, userId: string, now: number): Promise<string> {
  const token = btoa(String.fromCharCode(...random(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY, now)
    .run();
  return token;
}

/** The person behind the request's session, or null. A session in use is extended (180 days). */
export async function currentUser(db: Db, req: Request, now = Date.now()): Promise<User | null> {
  const token = cookieOf(req, COOKIE);
  if (!token) return null;
  const h = await sha256(token);
  const row = await db
    .prepare(
      "SELECT s.expires_at, s.last_seen, u.id, u.login_id, u.name, u.role, u.research_id, u.disabled_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    )
    .bind(h)
    .first<User & { expires_at: number; last_seen: number }>();
  if (!row || row.expires_at < now || row.disabled_at) return null;
  if (now - row.last_seen > DAY) await db.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?").bind(now, now + SESSION_DAYS * DAY, h).run();
  return { id: row.id, login_id: row.login_id, name: row.name, role: row.role, research_id: row.research_id, disabled_at: row.disabled_at };
}

// ---- requests --------------------------------------------------------------------------------

export class Refused extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

const LOGIN_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const loginIdOf = (v: unknown) => {
  if (typeof v !== "string" || !LOGIN_RE.test(v.trim())) throw new Refused("ログインIDは3〜32文字の英数字（. _ - も可）です。");
  return v.trim();
};

/** POST only from this site, as JSON (with SameSite=Strict, this closes cross-site requests). */
async function body(req: Request): Promise<Record<string, unknown>> {
  const origin = req.headers.get("Origin");
  if (origin && origin !== new URL(req.url).origin) throw new Refused("このサイトからの操作ではありません。", 403);
  if (!(req.headers.get("Content-Type") ?? "").includes("application/json")) throw new Refused("送り方が正しくありません。", 415);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") throw new Refused("送り方が正しくありません。");
  return b;
}

/**
 * Removes everything of one person. The research ID is kept only in the withdrawals, so exported
 * copies drop the person too (#45).
 */
async function deleteAccount(db: Db, who: { id: string; research_id: string }, now: number) {
  await db.batch([
    db.prepare("INSERT INTO research_withdrawals (research_id, at, reason) VALUES (?, ?, 'account-deleted')").bind(who.research_id, now),
    ...["reports", "sessions", "consents", "push_subscriptions", "notify_settings", "notify_log"].map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(who.id)),
    db.prepare("DELETE FROM users WHERE id = ?").bind(who.id),
  ]);
}

/**
 * One page of the research view, logged (who, when, which page, how many). Paged by key (time,
 * research ID, report ID), so reports added meanwhile neither repeat nor go missing. Reports
 * leave without the account they belong to; the first page lists the withdrawn research IDs.
 */
/**
 * One page of the consenting people's reports, in order of (time, research ID, report ID). The
 * cursor carries when the run began (`asOf`). A report synced during the run with an older time
 * falls behind the cursor, so the last page also brings every row that arrived or changed during
 * the run behind it (`late`); readers keep the newest copy of each report (review #86). Nothing is
 * left out — leaving rows out would make the PC export trim them from its older copies. A cursor
 * from before (3 parts) still reads, without the late rows.
 */
async function researchPage(db: Db, adminId: string, path: string, afterParam: string | null, dataset: string | null, now: number) {
  let after: string[] | null = null;
  try {
    if (afterParam) after = JSON.parse(atob(afterParam.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    throw new Refused("ページの指定が正しくありません。");
  }
  if (after && !(Array.isArray(after) && (after.length === 3 || after.length === 4) && after.every((v) => typeof v === "string"))) throw new Refused("ページの指定が正しくありません。");
  if (after?.length === 4 && !/^\d{1,16}$/.test(after[3])) throw new Refused("ページの指定が正しくありません。");
  const asOf = after ? (after.length === 4 ? Number(after[3]) : null) : now;
  const rows = (
    await (after
      ? db
          .prepare("SELECT research_id, report_id, at, body FROM research_reports_v3 WHERE (at, research_id, report_id) > (?, ?, ?) ORDER BY at, research_id, report_id LIMIT ?")
          .bind(after[0], after[1], after[2], RESEARCH_PAGE)
      : db.prepare("SELECT research_id, report_id, at, body FROM research_reports_v3 ORDER BY at, research_id, report_id LIMIT ?").bind(RESEARCH_PAGE)
    ).all<{ research_id: string; report_id: string; at: string; body: string }>()
  ).results;
  // The in-app analysis reads every page each time it opens: one line per opening (the first page,
  // with the whole count), so the log does not fill with pages (#60). Exports log every page.
  if (path !== "/api/admin/analysis") {
    await db.prepare("INSERT INTO export_log (admin_id, at, path, first, rows, dataset) VALUES (?, ?, ?, ?, ?, ?)").bind(adminId, now, path, after ? 1 : 0, rows.length, dataset).run();
  } else if (!after) {
    const total = (await db.prepare("SELECT COUNT(*) AS n FROM research_reports_v3").first<{ n: number }>())?.n ?? rows.length;
    await db.prepare("INSERT INTO export_log (admin_id, at, path, first, rows, dataset) VALUES (?, ?, ?, 0, ?, NULL)").bind(adminId, now, path, total).run();
  }
  const last = rows[rows.length - 1];
  const next = rows.length === RESEARCH_PAGE ? btoa(JSON.stringify([last.at, last.research_id, last.report_id, String(asOf ?? now)])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
  // The last page of a run that began on a later page: the rows that arrived or changed during it
  // behind this page's end (the cursor had passed them). On the first page nothing is behind.
  const late =
    next == null && after && asOf != null
      ? (
          await db
            .prepare("SELECT research_id, report_id, at, body FROM research_reports_v3 WHERE received_at > ? AND (at, research_id, report_id) <= (?, ?, ?) ORDER BY at, research_id, report_id LIMIT ?")
            .bind(asOf, last?.at ?? after[0], last?.research_id ?? after[1], last?.report_id ?? after[2], RESEARCH_LATE_MAX)
            .all<{ research_id: string; report_id: string; at: string; body: string }>()
        ).results
      : [];
  const withdrawn = after
    ? undefined
    : (await db.prepare("SELECT research_id, at, reason FROM research_withdrawals ORDER BY at").all<{ research_id: string; at: number; reason: string }>()).results.map((w) => ({ researchId: w.research_id, at: w.at, reason: w.reason }));
  return {
    exportedAt: now,
    rows: [...rows, ...late].map((r) => ({ researchId: r.research_id, report: forResearch(JSON.parse(r.body)) })),
    next,
    ...(withdrawn ? { withdrawn } : {}),
    ...(late.length ? { late: late.length, lateCapped: late.length === RESEARCH_LATE_MAX } : {}),
  };
}

async function researchConsent(db: Db, userId: string): Promise<{ granted: boolean; version: number | null; at: number | null }> {
  const c = await db
    .prepare("SELECT granted, version, at FROM consents WHERE user_id = ? AND kind = 'research' ORDER BY at DESC, rowid DESC LIMIT 1")
    .bind(userId)
    .first<{ granted: number; version: number; at: number }>();
  return { granted: c?.granted === 1, version: c?.version ?? null, at: c?.at ?? null };
}

async function me(db: Db, u: User) {
  return { id: u.id, loginId: u.login_id, name: u.name, role: u.role, research: await researchConsent(db, u.id), consentVersion: RESEARCH_CONSENT_VERSION };
}

async function createUser(db: Db, loginId: string, name: string | null, role: "user" | "admin", now: number) {
  const taken = await db.prepare("SELECT 1 FROM users WHERE login_id = ?").bind(loginId).first();
  if (taken) throw new Refused("そのログインIDはもう使われています。", 409);
  const password = newPassword();
  const salt = hex(random(16));
  const id = newId();
  await db
    .prepare("INSERT INTO users (id, login_id, name, role, pw_hash, pw_salt, pw_iter, research_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, loginId, name, role, await hashPassword(password, salt), salt, PW_ITER, newId(), now)
    .run();
  return { id, loginId, password };
}

// ---- reports on the server (the sync log, per person) -----------------------------------------

export const MAX_PUSH = 200;
export const PULL_PAGE = 200;
export const MAX_REPORT_BYTES = 64 * 1024;
export const MAX_REPORTS = 20_000;

interface ReportIn {
  id: string;
  updatedAt: number;
  at: string;
  deleted?: boolean;
  station?: unknown;
  sensation?: unknown;
  exposure?: unknown;
  windFelt?: unknown;
  sky?: unknown;
}

const oneOf = (v: unknown, list: readonly string[]) => v === undefined || (typeof v === "string" && list.includes(v));
const intIn = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * The values the analysis reads, checked before a report is kept (review 2026-11-12): one bad
 * report used to stop the research build, and an unknown answer was counted as another one.
 * Deleted reports (tombstones) only need their time.
 */
export function validReport(r: Record<string, unknown>): boolean {
  if (typeof r.at !== "string" || r.at.length > 40 || !Number.isFinite(Date.parse(r.at))) return false;
  if (r.deleted === true) return true;
  if (!intIn(r.sensation, -3, 3)) return false;
  if (!oneOf(r.thermalPreference, ["warmer", "same", "cooler"]) || !oneOf(r.drinkPreference, ["warm", "either", "cold"])) return false;
  if (r.preferenceVersion !== undefined && !intIn(r.preferenceVersion, 1, 100)) return false;
  if (r.scaleVersion !== undefined && !intIn(r.scaleVersion, 1, 100)) return false;
  const snap = r.snapshot as Record<string, unknown> | null | undefined;
  if (snap && typeof snap === "object" && snap.minute !== undefined && !intIn(snap.minute, 0, 59)) return false;
  // What could be seen before answering (#116): its answers on the same scale as the answer.
  const ctx = r.context as Record<string, unknown> | null | undefined;
  if (ctx != null) {
    if (typeof ctx !== "object") return false;
    const level = (v: unknown) => v === null || v === undefined || intIn(v, -3, 3);
    if (!level(ctx.firstSensation) || !level(ctx.sensationAtPrediction)) return false;
    if (ctx.picks !== undefined && !intIn(ctx.picks, 0, 1000)) return false;
    if (ctx.shownLevel != null && !intIn(ctx.shownLevel, 0, 6)) return false;
  }
  const c = r.comfort as Record<string, unknown> | null | undefined;
  if (c && typeof c === "object" && !(Array.isArray(c.probs) && c.probs.length === 7 && c.probs.every((p) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1)))
    return false;
  return true;
}

export function checkReports(raw: unknown): ReportIn[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Refused("記録の形が正しくありません。");
  if (raw.length > MAX_PUSH) throw new Refused(`一度に送れる記録は${MAX_PUSH}件までです。`);
  return raw.map((r) => {
    const ok =
      r && typeof r === "object" && typeof r.id === "string" && r.id.length > 0 && r.id.length <= 80 && typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) && typeof r.at === "string";
    if (!ok) throw new Refused("記録の形が正しくありません。");
    if (JSON.stringify(r).length > MAX_REPORT_BYTES) throw new Refused("大きすぎる記録があります。");
    return r as ReportIn;
  }).filter((r) => {
    // A report with values the analysis cannot read is not kept, but does not block the others
    // (the whole push failing would stop this person's sync for good).
    if (validReport(r as unknown as Record<string, unknown>)) return true;
    console.warn("weather-note: report skipped (values)", r.id);
    return false;
  });
}

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/**
 * Keeps each report that is newer than the copy held. Every write gets this person's next number
 * (seq), in one transaction, so two devices pushing at once never share a number; the upsert's
 * condition keeps the newer copy even if both read the old one.
 */
export async function pushReports(db: Db, userId: string, list: ReportIn[], now: number): Promise<number> {
  if (!list.length) return 0;
  // D1 takes at most 100 values per statement, so the lookup goes in pieces.
  const held = new Map<string, number>();
  for (let i = 0; i < list.length; i += 90) {
    const ids = list.slice(i, i + 90).map((r) => r.id);
    const rows = await db
      .prepare(`SELECT id, updated_at FROM reports WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
      .bind(userId, ...ids)
      .all<{ id: string; updated_at: number }>();
    for (const r of rows.results) held.set(r.id, r.updated_at);
  }
  const fresh = list.filter((r) => !held.has(r.id) || held.get(r.id)! < r.updatedAt);
  if (!fresh.length) return 0;
  const added = fresh.filter((r) => !held.has(r.id)).length;
  if (added) {
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE user_id = ?").bind(userId).first<{ n: number }>())?.n ?? 0;
    if (n + added > MAX_REPORTS) throw new Refused("保存できる記録の上限に達しました。", 413);
  }
  const statements = fresh.map((r, k) =>
    db
      .prepare(
        `INSERT INTO reports (user_id, id, seq, updated_at, deleted, at, station, sensation, exposure, wind_felt, sky, body, received_at)
         VALUES (?, ?, (SELECT sync_seq FROM users WHERE id = ?) + ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, id) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at, deleted = excluded.deleted, at = excluded.at,
           station = excluded.station, sensation = excluded.sensation, exposure = excluded.exposure, wind_felt = excluded.wind_felt, sky = excluded.sky,
           body = excluded.body, received_at = excluded.received_at
         WHERE excluded.updated_at > reports.updated_at`,
      )
      .bind(userId, r.id, userId, k + 1, r.updatedAt, r.deleted ? 1 : 0, r.at, str(r.station), int(r.sensation), str(r.exposure), str(r.windFelt), str(r.sky), JSON.stringify(r), now),
  );
  statements.push(db.prepare("UPDATE users SET sync_seq = sync_seq + ? WHERE id = ?").bind(fresh.length, userId));
  await db.batch(statements);
  return fresh.length;
}

export async function pullReports(db: Db, userId: string, since: number) {
  const rows = (
    await db.prepare("SELECT seq, body FROM reports WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?").bind(userId, since, PULL_PAGE).all<{ seq: number; body: string }>()
  ).results;
  return {
    reports: rows.map((r) => JSON.parse(r.body)),
    seq: rows.length ? rows[rows.length - 1].seq : Math.max(since, 0),
    more: rows.length === PULL_PAGE,
  };
}

// ---- routes ----------------------------------------------------------------------------------

export const ACCOUNT_PATHS = ["/api/auth/", "/api/me/", "/api/reports/", "/api/admin/", "/api/push/"];
export const isAccountPath = (p: string) => ACCOUNT_PATHS.some((x) => p.startsWith(x));

export async function handleAccounts(req: Request, env: AccountsEnv, now = Date.now()): Promise<Response> {
  try {
    const db = env.DB;
    if (!db) throw new Refused("記録の保存はこのサーバーではまだ使えません。", 503);
    await ensureSchema(db);
    const path = new URL(req.url).pathname;
    const method = req.method;
    const post = method === "POST";
    if (!post && method !== "GET") throw new Refused("この操作はできません。", 405);

    // -- signing in --
    if (path === "/api/auth/me" && !post) {
      const u = await currentUser(db, req, now);
      const empty = !(await db.prepare("SELECT 1 FROM users LIMIT 1").first());
      return json({ user: u ? await me(db, u) : null, setup: empty && !!env.SETUP_CODE });
    }
    if (path === "/api/auth/login" && post) {
      const b = await body(req);
      const loginId = typeof b.loginId === "string" ? b.loginId.trim() : "";
      const password = typeof b.password === "string" ? b.password.trim() : "";
      const wrong = new Refused("ログインIDかパスワードが違います。", 401);
      const u = await db
        .prepare("SELECT id, pw_hash, pw_salt, pw_iter, failed, locked_until, disabled_at FROM users WHERE login_id = ?")
        .bind(loginId)
        .first<{ id: string; pw_hash: string; pw_salt: string; pw_iter: number; failed: number; locked_until: number | null; disabled_at: number | null }>();
      if (!u) {
        await hashPassword(password, "no-such-user"); // the same work either way: timing does not tell IDs apart
        throw wrong;
      }
      if (u.locked_until && u.locked_until > now) throw new Refused("続けて間違えたため、しばらくログインできません。15分ほどおいてお試しください。", 429);
      const ok = await same(await hashPassword(password, u.pw_salt, u.pw_iter), u.pw_hash);
      if (!ok) {
        const failed = u.failed + 1;
        await db
          .prepare("UPDATE users SET failed = ?, locked_until = ? WHERE id = ?")
          .bind(failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? now + LOCK_MS : null, u.id)
          .run();
        throw wrong;
      }
      if (u.disabled_at) throw wrong;
      await db.prepare("UPDATE users SET failed = 0, locked_until = NULL, last_login = ? WHERE id = ?").bind(now, u.id).run();
      const token = await startSession(db, u.id, now);
      const user = (await currentUser(db, new Request(req.url, { headers: { Cookie: `${COOKIE}=${token}` } }), now))!;
      return json({ user: await me(db, user) }, 200, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86_400) });
    }
    if (path === "/api/auth/logout" && post) {
      await body(req);
      const token = cookieOf(req, COOKIE);
      if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }
    if (path === "/api/auth/setup" && post) {
      const b = await body(req);
      if (!env.SETUP_CODE) throw new Refused("初期設定はできません。", 403);
      if (await db.prepare("SELECT 1 FROM users LIMIT 1").first()) throw new Refused("初期設定はもう済んでいます。", 409);
      if (typeof b.code !== "string" || !(await same(b.code.trim(), env.SETUP_CODE))) throw new Refused("初期設定コードが違います。", 403);
      const made = await createUser(db, loginIdOf(b.loginId), typeof b.name === "string" ? b.name.slice(0, 40) : null, "admin", now);
      const token = await startSession(db, made.id, now);
      const user = (await currentUser(db, new Request(req.url, { headers: { Cookie: `${COOKIE}=${token}` } }), now))!;
      return json({ user: await me(db, user), password: made.password }, 200, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86_400) });
    }

    // -- the research export (#45, #55): only with an export token, never with a login --
    if (path === "/api/admin/research" && !post) {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const t = token
        ? await db.prepare("SELECT t.admin_id, t.expires_at, t.revoked_at FROM export_tokens t JOIN users u ON u.id = t.admin_id AND u.role = 'admin' AND u.disabled_at IS NULL WHERE t.token_hash = ?").bind(await sha256(token)).first<{ admin_id: string; expires_at: number; revoked_at: number | null }>()
        : null;
      if (!t || t.revoked_at || t.expires_at < now) throw new Refused("取り出し用のトークンが必要です（管理画面で発行。24時間有効）。", 401);
      const q = new URL(req.url).searchParams;
      return json(await researchPage(db, t.admin_id, path, q.get("after"), q.get("dataset")?.slice(0, 80) ?? null, now));
    }

    // -- everything below needs a session --
    const u = await currentUser(db, req, now);
    if (!u) throw new Refused("ログインしてください。", 401);

    if (path === "/api/me/consent" && post) {
      const b = await body(req);
      if (typeof b.granted !== "boolean") throw new Refused("同意の答えが正しくありません。");
      // Taking consent back is also told to the exported copies (#45).
      // The person gets a new research ID: the old one stays withdrawn for good, and consenting
      // again starts under the new one (#55).
      // One transaction: the answer, and with a withdrawal its record and the new ID, together.
      const answer = db.prepare("INSERT INTO consents (user_id, kind, version, granted, at) VALUES (?, 'research', ?, ?, ?)").bind(u.id, RESEARCH_CONSENT_VERSION, b.granted ? 1 : 0, now);
      if (!b.granted && (await researchConsent(db, u.id)).granted)
        await db.batch([
          db.prepare("INSERT INTO research_withdrawals (research_id, at, reason) VALUES (?, ?, 'consent-withdrawn')").bind(u.research_id, now),
          db.prepare("UPDATE users SET research_id = ? WHERE id = ?").bind(newId(), u.id),
          answer,
        ]);
      else await answer.run();
      return json({ user: await me(db, u) });
    }
    if (path === "/api/me/delete" && post) {
      // The person deletes their own account (#55), confirmed by the password. An administrator
      // cannot: someone has to stay able to manage the accounts.
      const b = await body(req);
      if (u.role === "admin") throw new Refused("管理者のアカウントは、ここからは削除できません。");
      const row = await db.prepare("SELECT pw_hash, pw_salt, pw_iter FROM users WHERE id = ?").bind(u.id).first<{ pw_hash: string; pw_salt: string; pw_iter: number }>();
      const password = typeof b.password === "string" ? b.password.trim() : "";
      if (!row || !(await same(await hashPassword(password, row.pw_salt, row.pw_iter), row.pw_hash))) throw new Refused("パスワードが違います。", 403);
      await deleteAccount(db, u, now);
      return json({ deleted: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }
    // -- notifications --
    if (path === "/api/me/notify") {
      if (post) {
        let settings;
        try {
          settings = checkSettings(await body(req));
        } catch (e) {
          if (e instanceof Refused) throw e;
          throw new Refused((e as Error).message);
        }
        await saveSettings(db, u.id, settings, now);
      }
      const devices = (await db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").bind(u.id).first<{ n: number }>())?.n ?? 0;
      return json({ settings: await settingsOf(db, u.id), devices });
    }
    if (path === "/api/push/key" && !post) return json({ publicKey: (await vapidKeys(db)).publicKey });
    if (path === "/api/push/subscribe" && post) {
      const b = await body(req);
      let sub;
      try {
        sub = checkSubscription(b);
      } catch (e) {
        throw new Refused((e as Error).message);
      }
      await saveSubscription(db, u, sub, now);
      await rememberOrigin(db, new URL(req.url).origin);
      return json({ ok: true });
    }
    if (path === "/api/push/unsubscribe" && post) {
      const b = await body(req);
      if (typeof b.endpoint === "string") await removeSubscription(db, u, b.endpoint);
      return json({ ok: true });
    }
    if (path === "/api/push/test" && post) {
      await body(req);
      const n = await sendToUser(db, u.id, reportMessage(now, true), now);
      if (!n) throw new Refused("通知を送れる端末がありません。この端末で通知をオンにしてください。", 409);
      return json({ devices: n });
    }

    if (path === "/api/reports/sync" && post) {
      const b = await body(req);
      const taken = await pushReports(db, u.id, checkReports(b.push), now);
      const since = typeof b.since === "number" && Number.isInteger(b.since) && b.since >= 0 ? b.since : null;
      const total = (await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND deleted = 0").bind(u.id).first<{ n: number }>())?.n ?? 0;
      return json({ taken, total, ...(since == null ? {} : await pullReports(db, u.id, since)) });
    }

    // -- the administrator --
    if (path.startsWith("/api/admin/")) {
      if (u.role !== "admin") throw new Refused("管理者だけの操作です。", 403);
      if (path === "/api/admin/users" && !post) {
        const users = (
          await db
            .prepare(
              `SELECT u.id, u.login_id, u.name, u.role, u.created_at, u.last_login, u.disabled_at,
                (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id AND r.deleted = 0) AS reports,
                (SELECT c.granted FROM consents c WHERE c.user_id = u.id AND c.kind = 'research' ORDER BY c.at DESC, c.rowid DESC LIMIT 1) AS research
               FROM users u ORDER BY u.created_at`,
            )
            .all()
        ).results;
        return json({ users });
      }
      if (path === "/api/admin/users" && post) {
        const b = await body(req);
        const made = await createUser(db, loginIdOf(b.loginId), typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 40) : null, "user", now);
        return json(made);
      }
      if ((path === "/api/admin/users/reset" || path === "/api/admin/users/disable") && post) {
        const b = await body(req);
        const target = typeof b.id === "string" ? await db.prepare("SELECT id, role FROM users WHERE id = ?").bind(b.id).first<{ id: string; role: string }>() : null;
        if (!target) throw new Refused("そのユーザーは見つかりません。", 404);
        if (path.endsWith("/reset")) {
          const password = newPassword();
          const salt = hex(random(16));
          await db.batch([
            db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, failed = 0, locked_until = NULL WHERE id = ?").bind(await hashPassword(password, salt), salt, PW_ITER, target.id),
            db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id), // the old password's sessions end too
          ]);
          return json({ id: target.id, password });
        }
        if (target.id === u.id) throw new Refused("自分自身は停止できません。");
        const disabled = b.disabled !== false;
        await db.batch([
          db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").bind(disabled ? now : null, target.id),
          ...(disabled ? [db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id)] : []),
        ]);
        return json({ id: target.id, disabled });
      }
      if (path === "/api/admin/users/delete" && post) {
        // Deleting an account removes everything of the person; the research ID is kept only in
        // the withdrawals, so exported copies drop it too (#45). The login ID must be typed back.
        const b = await body(req);
        const target = typeof b.id === "string" ? await db.prepare("SELECT id, login_id, research_id FROM users WHERE id = ?").bind(b.id).first<{ id: string; login_id: string; research_id: string }>() : null;
        if (!target) throw new Refused("そのユーザーは見つかりません。", 404);
        if (target.id === u.id) throw new Refused("自分自身は削除できません。");
        if (typeof b.confirm !== "string" || b.confirm.trim().toLowerCase() !== target.login_id.toLowerCase()) throw new Refused("確認のため、ログインIDを正しく入れてください。");
        await deleteAccount(db, target, now);
        return json({ id: target.id, deleted: true });
      }
      if (path === "/api/admin/reauth" && post) {
        const b = await body(req);
        const row = await db.prepare("SELECT pw_hash, pw_salt, pw_iter FROM users WHERE id = ?").bind(u.id).first<{ pw_hash: string; pw_salt: string; pw_iter: number }>();
        const password = typeof b.password === "string" ? b.password.trim() : "";
        if (!row || !(await same(await hashPassword(password, row.pw_salt, row.pw_iter), row.pw_hash))) throw new Refused("パスワードが違います。", 403);
        await db.prepare("INSERT OR REPLACE INTO session_reauth (token_hash, at) VALUES (?, ?)").bind(await sha256(cookieOf(req, COOKIE)!), now).run();
        return json({ until: now + REAUTH_MS });
      }
      // Everyone's reports, and the token to take them out: only with the password typed again lately.
      const REAUTH = "研究用のデータを開くには、パスワードをもう一度入れてください（15分有効）。";
      if (path === "/api/admin/analysis" && !post && !(await reauthed(db, req, now))) throw new Refused(REAUTH, REAUTH_STATUS);
      if (path === "/api/admin/analysis" && !post) {
        // The in-app analysis (iPhone only): the same view, read with the administrator's login.
        // The app keeps it in memory only and never stores it, so a withdrawal reaches it the
        // next time it is opened.
        return json(await researchPage(db, u.id, path, new URL(req.url).searchParams.get("after"), null, now));
      }
      if (path === "/api/admin/export-token") {
        if (post) {
          const b = await body(req);
          // Revoking needs nothing more; a new token needs the password typed again lately.
          if (b.revoke !== true && !(await reauthed(db, req, now))) throw new Refused(REAUTH, REAUTH_STATUS);
          await db.prepare("UPDATE export_tokens SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at > ?").bind(now, now).run();
          if (b.revoke === true) return json({ active: null });
          const token = hex(random(32));
          await db.prepare("INSERT INTO export_tokens (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), u.id, now, now + EXPORT_TOKEN_MS).run();
          return json({ token, active: { expiresAt: now + EXPORT_TOKEN_MS } });
        }
        const a = await db.prepare("SELECT expires_at FROM export_tokens WHERE revoked_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1").bind(now).first<{ expires_at: number }>();
        return json({ active: a ? { expiresAt: a.expires_at } : null });
      }
      if (path === "/api/admin/exports" && !post) {
        const log = (await db.prepare("SELECT e.at, e.path, e.first, e.rows, e.dataset, u.login_id AS admin FROM export_log e LEFT JOIN users u ON u.id = e.admin_id ORDER BY e.id DESC LIMIT 200").all()).results;
        return json({ log });
      }
    }
    throw new Refused("見つかりません。", 404);
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message }, e.status);
    console.error("weather-note: accounts failure", e);
    return json({ error: "処理に失敗しました。時間をおいて再試行してください。" }, 500);
  }
}

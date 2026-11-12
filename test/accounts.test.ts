import { beforeEach, describe, expect, it } from "vitest";
import { COOKIE, LOCK_MS, MAX_FAILED, newPassword, PULL_PAGE, RESEARCH_CONSENT_VERSION } from "../worker/src/accounts";
import worker from "../worker/src/index";
import { d1 } from "./d1";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const ORIGIN = "https://wn.test";
const SETUP_CODE = "setup-code-for-tests";

let env: { DB: ReturnType<typeof d1>; SETUP_CODE?: string };
beforeEach(() => {
  env = { DB: d1(), SETUP_CODE };
});

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string | null; origin?: string; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie) headers.Cookie = `${COOKIE}=${init.cookie}`;
  if (init.origin) headers.Origin = init.origin;
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await worker.fetch(
    new Request(ORIGIN + path, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
    env,
    ctx,
  );
  const set = res.headers.get("Set-Cookie");
  const cookie = set?.match(new RegExp(`${COOKIE}=([^;]*)`))?.[1] ?? null;
  return { status: res.status, body: (await res.json()) as Record<string, any>, cookie, setCookie: set, cache: res.headers.get("Cache-Control") };
}

/** The research export, with a fresh export token issued by the administrator (#55). */
async function research(adminCookie: string, query = "") {
  const token = (await call("/api/admin/export-token", { body: {}, cookie: adminCookie })).body.token as string;
  return call(`/api/admin/research${query}`, { token });
}

/** The first administrator, made with the setup code. */
async function admin() {
  const r = await call("/api/auth/setup", { body: { code: SETUP_CODE, loginId: "masao", name: "渡辺" } });
  expect(r.status).toBe(200);
  return { cookie: r.cookie!, password: r.body.password as string };
}

async function issue(adminCookie: string, loginId: string) {
  const r = await call("/api/admin/users", { body: { loginId }, cookie: adminCookie });
  expect(r.status).toBe(200);
  return r.body as { id: string; loginId: string; password: string };
}

const login = (loginId: string, password: string) => call("/api/auth/login", { body: { loginId, password } });
const rep = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({ id, updatedAt, at: "2026-11-11T03:00:00.000Z", station: "47893", sensation: 1, exposure: "sun", windFelt: "weak", ...extra });

describe("passwords", () => {
  it("are 16 characters without look-alike letters", () => {
    const all = Array.from({ length: 300 }, newPassword);
    expect(new Set(all).size).toBe(300);
    for (const p of all) expect(p).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{16}$/);
  });
});

describe("setup: the first administrator", () => {
  it("needs the setup code, works once, and then logs in", async () => {
    expect((await call("/api/auth/me")).body).toEqual({ user: null, setup: true });
    expect((await call("/api/auth/setup", { body: { code: "wrong", loginId: "masao" } })).status).toBe(403);
    const a = await admin();
    expect(a.password).toHaveLength(16);
    const me = await call("/api/auth/me", { cookie: a.cookie });
    expect(me.body.user).toMatchObject({ loginId: "masao", role: "admin" });
    expect(me.body.setup).toBe(false);
    expect((await call("/api/auth/setup", { body: { code: SETUP_CODE, loginId: "other" } })).status).toBe(409);
  });

  it("is closed when no setup code is set on the server", async () => {
    env.SETUP_CODE = undefined;
    expect((await call("/api/auth/me")).body.setup).toBe(false);
    expect((await call("/api/auth/setup", { body: { code: "", loginId: "masao" } })).status).toBe(403);
  });
});

describe("login", () => {
  it("only for issued accounts; the session cookie is HttpOnly, Secure, SameSite=Strict, /api only", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    expect((await login("tanaka", "nope")).status).toBe(401);
    expect((await login("nobody", p.password)).body.error).toBe((await login("tanaka", "nope")).body.error); // no hint which was wrong
    const ok = await login("TANAKA", ` ${p.password} `); // ID ignores case; stray spaces from copying are fine
    expect(ok.status).toBe(200);
    expect(ok.setCookie).toMatch(/HttpOnly/);
    expect(ok.setCookie).toMatch(/Secure/);
    expect(ok.setCookie).toMatch(/SameSite=Strict/);
    expect(ok.setCookie).toMatch(/Path=\/api;/);
    expect(ok.cache).toBe("no-store");
    expect((await call("/api/auth/me", { cookie: ok.cookie })).body.user.loginId).toBe("tanaka");
  });

  it(`locks an ID for 15 minutes after ${MAX_FAILED} wrong passwords`, async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    for (let i = 0; i < MAX_FAILED; i++) expect((await login("tanaka", "wrong")).status).toBe(401);
    expect((await login("tanaka", p.password)).status).toBe(429);
    env.DB.raw.prepare("UPDATE users SET locked_until = ? WHERE login_id = 'tanaka'").run(Date.now() - 1);
    expect((await login("tanaka", p.password)).status).toBe(200);
    void LOCK_MS;
  });

  it("logs out: the session stops working", async () => {
    const a = await admin();
    const out = await call("/api/auth/logout", { body: {}, cookie: a.cookie });
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await call("/api/auth/me", { cookie: a.cookie })).body.user).toBeNull();
  });

  it("refuses posts from another site and non-JSON posts", async () => {
    const a = await admin();
    expect((await call("/api/me/consent", { body: { granted: true }, cookie: a.cookie, origin: "https://evil.test" })).status).toBe(403);
    const res = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", body: "loginId=x", headers: { "Content-Type": "application/x-www-form-urlencoded" } }), env, ctx);
    expect(res.status).toBe(415);
  });
});

describe("the administrator", () => {
  it("issues, resets (old password and sessions end) and stops accounts; others cannot", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    expect((await call("/api/admin/users", { body: { loginId: "Tanaka" }, cookie: a.cookie })).status).toBe(409);
    const t = await login("tanaka", p.password);
    expect((await call("/api/admin/users", { cookie: t.cookie })).status).toBe(403);
    expect((await call("/api/admin/users", { body: { loginId: "x2" }, cookie: t.cookie })).status).toBe(403);

    const reset = await call("/api/admin/users/reset", { body: { id: p.id }, cookie: a.cookie });
    expect((await call("/api/auth/me", { cookie: t.cookie })).body.user).toBeNull();
    expect((await login("tanaka", p.password)).status).toBe(401);
    const t2 = await login("tanaka", reset.body.password);
    expect(t2.status).toBe(200);

    await call("/api/admin/users/disable", { body: { id: p.id }, cookie: a.cookie });
    expect((await call("/api/auth/me", { cookie: t2.cookie })).body.user).toBeNull();
    expect((await login("tanaka", reset.body.password)).status).toBe(401);
    await call("/api/admin/users/disable", { body: { id: p.id, disabled: false }, cookie: a.cookie });
    expect((await login("tanaka", reset.body.password)).status).toBe(200);

    const list = (await call("/api/admin/users", { cookie: a.cookie })).body.users as { login_id: string }[];
    expect(list.map((u) => u.login_id)).toEqual(["masao", "tanaka"]);
    expect(JSON.stringify(list)).not.toMatch(/pw_|password/);
  });

  it("never stores a password as it is", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const dump = JSON.stringify(env.DB.raw.prepare("SELECT * FROM users").all());
    expect(dump).not.toContain(p.password);
    expect(dump).not.toContain(a.password);
  });
});

describe("reports on the server", () => {
  it("are each person's own: whose they are comes from the session, not from what is sent", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const t = (await login("tanaka", p.password)).cookie;
    await call("/api/reports/sync", { body: { push: [rep("mine", 1)], userId: "someone-else" }, cookie: a.cookie });
    await call("/api/reports/sync", { body: { push: [rep("theirs", 1)] }, cookie: t });
    const mineSeen = await call("/api/reports/sync", { body: { since: 0 }, cookie: a.cookie });
    const theirsSeen = await call("/api/reports/sync", { body: { since: 0 }, cookie: t });
    expect(mineSeen.body.reports.map((r: { id: string }) => r.id)).toEqual(["mine"]);
    expect(theirsSeen.body.reports.map((r: { id: string }) => r.id)).toEqual(["theirs"]);
    // The same report id in two accounts is two reports.
    await call("/api/reports/sync", { body: { push: [rep("mine", 5)] }, cookie: t });
    expect((await call("/api/reports/sync", { body: { since: 0 }, cookie: a.cookie })).body.reports[0].updatedAt).toBe(1);
    expect((await call("/api/reports/sync", { body: { since: 0 } })).status).toBe(401);
  });

  it("keep the newer copy, pass deletions on, and come back page by page", async () => {
    const a = (await admin()).cookie;
    await call("/api/reports/sync", { body: { push: [rep("r1", 10, { sensation: 2 })] }, cookie: a });
    await call("/api/reports/sync", { body: { push: [rep("r1", 5, { sensation: -3 })] }, cookie: a });
    let r = await call("/api/reports/sync", { body: { since: 0 }, cookie: a });
    expect(r.body.reports).toEqual([rep("r1", 10, { sensation: 2 })]);
    await call("/api/reports/sync", { body: { push: [rep("r1", 20, { deleted: true })] }, cookie: a });
    r = await call("/api/reports/sync", { body: { since: r.body.seq }, cookie: a });
    expect(r.body.reports[0].deleted).toBe(true);
    expect(r.body.total).toBe(0);

    for (let i = 0; i < 3; i++)
      await call("/api/reports/sync", { body: { push: Array.from({ length: 150 }, (_, k) => rep(`p${i}-${k}`, 1)) }, cookie: a });
    let since = 0;
    let got = 0;
    let more = true;
    while (more) {
      const page = await call("/api/reports/sync", { body: { since }, cookie: a });
      got += page.body.reports.length;
      expect(page.body.reports.length).toBeLessThanOrEqual(PULL_PAGE);
      since = page.body.seq;
      more = page.body.more;
    }
    expect(got).toBe(451);
  });

  it("numbers every change once even when two devices push together", async () => {
    const a = (await admin()).cookie;
    await Promise.all([
      call("/api/reports/sync", { body: { push: [rep("a", 1), rep("b", 1)] }, cookie: a }),
      call("/api/reports/sync", { body: { push: [rep("c", 1), rep("d", 1)] }, cookie: a }),
    ]);
    const seqs = env.DB.raw.prepare("SELECT seq FROM reports ORDER BY seq").all().map((r) => Number((r as { seq: number }).seq));
    expect(new Set(seqs).size).toBe(4);
  });

  it("refuses malformed pushes", async () => {
    const a = (await admin()).cookie;
    expect((await call("/api/reports/sync", { body: { push: [{ id: 3 }] }, cookie: a })).status).toBe(400);
    expect((await call("/api/reports/sync", { body: { push: Array.from({ length: 201 }, (_, k) => rep(`x${k}`, 1)) }, cookie: a })).status).toBe(400);
  });
});

describe("the ground for analysis", () => {
  it("shows only consenting people's reports, under research IDs, and follows withdrawal", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const t = (await login("tanaka", p.password)).cookie!;
    await call("/api/reports/sync", { body: { push: [rep("m1", 1)] }, cookie: a.cookie });
    await call("/api/reports/sync", { body: { push: [rep("t1", 1, { owner: p.id }), rep("t2", 1, { deleted: true })] }, cookie: t });

    const researchRows = async () => (await research(a.cookie)).body.rows as { researchId: string; report: { id: string } }[];
    expect(await researchRows()).toEqual([]);
    const c = await call("/api/me/consent", { body: { granted: true }, cookie: t });
    expect(c.body.user.research.granted).toBe(true);
    const rows = await researchRows();
    expect(rows.map((r) => r.report.id)).toEqual(["t1"]); // deleted reports never show
    expect(rows[0].researchId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(rows)).not.toMatch(/tanaka|masao/);
    // The account the report belongs to never leaves with it (#55).
    const users = (await call("/api/admin/users", { cookie: a.cookie })).body.users as { id: string }[];
    for (const u of users) expect(JSON.stringify(rows)).not.toContain(u.id);
    expect(rows[0].report).not.toHaveProperty("owner");
    await call("/api/me/consent", { body: { granted: false }, cookie: t });
    expect(await researchRows()).toEqual([]);
    // Every answer is kept, with its version.
    const history = env.DB.raw.prepare("SELECT granted, version FROM consents ORDER BY at, rowid").all();
    expect(history).toEqual([
      { granted: 1, version: RESEARCH_CONSENT_VERSION },
      { granted: 0, version: RESEARCH_CONSENT_VERSION },
    ]);
    expect((await call("/api/admin/research", { cookie: t })).status).toBe(401);
    expect((await call("/api/admin/research", { cookie: a.cookie })).status).toBe(401); // a login is not enough
    expect((await call("/api/admin/export-token", { body: {}, cookie: t })).status).toBe(403);
  });
});

describe("without the database", () => {
  it("says the server is not ready", async () => {
    const res = await worker.fetch(new Request(ORIGIN + "/api/auth/me"), {}, ctx);
    expect(res.status).toBe(503);
  });
});

describe("#45: research data leaving the server", () => {
  it("logs every export, and tells exported copies whose consent was taken back", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const t = (await login("tanaka", p.password)).cookie!;
    await call("/api/reports/sync", { body: { push: [rep("t1", 1)] }, cookie: t });
    await call("/api/me/consent", { body: { granted: true }, cookie: t });
    const first = await research(a.cookie, "?dataset=ds-1");
    expect(first.body.rows).toHaveLength(1);
    expect(first.body.withdrawn).toEqual([]);
    const rid = first.body.rows[0].researchId;
    await call("/api/me/consent", { body: { granted: false }, cookie: t });
    await call("/api/me/consent", { body: { granted: false }, cookie: t }); // a second "no" is not a second withdrawal
    const again = await research(a.cookie);
    expect(again.body.rows).toEqual([]);
    expect(again.body.withdrawn).toEqual([expect.objectContaining({ researchId: rid, reason: "consent-withdrawn" })]);
    const log = (await call("/api/admin/exports", { cookie: a.cookie })).body.log as { rows: number; dataset: string | null; admin: string }[];
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ rows: 1, dataset: "ds-1", admin: "masao" });
    expect((await call("/api/admin/exports", { cookie: t })).status).toBe(403);
  });

  it("deletes an account and everything of it, keeping only the withdrawal of its research ID", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const t = (await login("tanaka", p.password)).cookie!;
    await call("/api/reports/sync", { body: { push: [rep("t1", 1)] }, cookie: t });
    await call("/api/me/consent", { body: { granted: true }, cookie: t });
    const rid = (await research(a.cookie)).body.rows[0].researchId;
    expect((await call("/api/admin/users/delete", { body: { id: p.id, confirm: "wrong" }, cookie: a.cookie })).status).toBe(400);
    expect((await call("/api/admin/users/delete", { body: { id: p.id, confirm: "tanaka" }, cookie: t })).status).toBe(403);
    expect((await call("/api/admin/users/delete", { body: { id: p.id, confirm: "TANAKA" }, cookie: a.cookie })).body).toEqual({ id: p.id, deleted: true });
    for (const table of ["users", "reports", "sessions", "consents"]) {
      const n = env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "users" ? "id" : "user_id"} = ?`).get(p.id) as { n: number };
      expect(n.n, table).toBe(0);
    }
    expect((await call("/api/auth/me", { cookie: t })).body.user).toBeNull();
    const after = await research(a.cookie);
    expect(after.body.rows).toEqual([]);
    expect(after.body.withdrawn).toEqual([expect.objectContaining({ researchId: rid, reason: "account-deleted" })]);
    const self = (await call("/api/auth/me", { cookie: a.cookie })).body.user.id;
    expect((await call("/api/admin/users/delete", { body: { id: self, confirm: "masao" }, cookie: a.cookie })).status).toBe(400);
  });
  it("lets a person delete their own account with the password, but not an administrator", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const t = (await login("tanaka", p.password)).cookie!;
    await call("/api/reports/sync", { body: { push: [rep("t1", 1)] }, cookie: t });
    await call("/api/me/consent", { body: { granted: true }, cookie: t });
    expect((await call("/api/me/delete", { body: { password: "wrong" }, cookie: t })).status).toBe(403);
    expect((await call("/api/auth/me", { cookie: t })).body.user).not.toBeNull();
    const done = await call("/api/me/delete", { body: { password: p.password }, cookie: t });
    expect(done.body).toEqual({ deleted: true });
    expect((await call("/api/auth/me", { cookie: t })).body.user).toBeNull();
    expect((await call("/api/auth/login", { body: { loginId: "tanaka", password: p.password } })).status).toBe(401);
    const exported = await research(a.cookie);
    expect(exported.body.rows).toEqual([]);
    expect(exported.body.withdrawn).toEqual([expect.objectContaining({ reason: "account-deleted" })]);
    expect((await call("/api/me/delete", { body: { password: "x" }, cookie: a.cookie })).status).toBe(400);
  });
  it("export tokens: read-only, one at a time, expire and can be revoked (#55)", async () => {
    const a = await admin();
    const first = (await call("/api/admin/export-token", { body: {}, cookie: a.cookie })).body;
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("/api/admin/export-token", { cookie: a.cookie })).body.active).toEqual({ expiresAt: expect.any(Number) });
    expect((await call("/api/admin/research", { token: first.token })).status).toBe(200);
    expect((await call("/api/admin/users", { token: first.token })).status).toBe(401); // nothing else
    const second = (await call("/api/admin/export-token", { body: {}, cookie: a.cookie })).body;
    expect((await call("/api/admin/research", { token: first.token })).status).toBe(401); // replaced
    expect((await call("/api/admin/research", { token: second.token })).status).toBe(200);
    await call("/api/admin/export-token", { body: { revoke: true }, cookie: a.cookie });
    expect((await call("/api/admin/research", { token: second.token })).status).toBe(401);
    const third = (await call("/api/admin/export-token", { body: {}, cookie: a.cookie })).body;
    env.DB.raw.prepare("UPDATE export_tokens SET expires_at = 1").run();
    expect((await call("/api/admin/research", { token: third.token })).status).toBe(401);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM export_tokens WHERE token_hash = ?").get(third.token)).toEqual({ n: 0 }); // only the hash is kept
  });

  it("a new research ID after taking consent back, so consenting again is not purged (#55)", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const t = (await login("tanaka", p.password)).cookie!;
    await call("/api/reports/sync", { body: { push: [rep("t1", 1)] }, cookie: t });
    await call("/api/me/consent", { body: { granted: true }, cookie: t });
    const before = (await research(a.cookie)).body.rows[0].researchId;
    await call("/api/me/consent", { body: { granted: false }, cookie: t });
    await call("/api/me/consent", { body: { granted: true }, cookie: t });
    const now = await research(a.cookie);
    expect(now.body.rows[0].researchId).not.toBe(before);
    expect(now.body.withdrawn).toEqual([expect.objectContaining({ researchId: before })]);
  });

  it("pages by key: every report once, in order", async () => {
    const a = await admin();
    await call("/api/me/consent", { body: { granted: true }, cookie: a.cookie });
    const many = Array.from({ length: 2300 }, (_, i) => rep(`r${i}`, 1, { at: new Date(Date.UTC(2026, 10, 1, 0, Math.floor(i / 3))).toISOString() }));
    for (let i = 0; i < many.length; i += 200) await call("/api/reports/sync", { body: { push: many.slice(i, i + 200) }, cookie: a.cookie });
    const token = (await call("/api/admin/export-token", { body: {}, cookie: a.cookie })).body.token;
    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const page: { body: Record<string, any> } = await call(`/api/admin/research${after ? `?after=${after}` : ""}`, { token });
      seen.push(...page.body.rows.map((r: { report: { id: string } }) => r.report.id));
      after = page.body.next;
      pages++;
    } while (after);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(2300);
    expect(seen).toHaveLength(2300);
  });
  it("the in-app analysis reads the same view with the administrator's login, logged (iPhone only)", async () => {
    const a = await admin();
    const p = await issue(a.cookie, "tanaka");
    const t = (await login("tanaka", p.password)).cookie!;
    await call("/api/reports/sync", { body: { push: [rep("t1", 1, { owner: p.id })] }, cookie: t });
    await call("/api/me/consent", { body: { granted: true }, cookie: t });
    const r = await call("/api/admin/analysis", { cookie: a.cookie });
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].report).not.toHaveProperty("owner");
    expect((await call("/api/admin/analysis", { cookie: t })).status).toBe(403);
    const log = (await call("/api/admin/exports", { cookie: a.cookie })).body.log;
    expect(log[0]).toMatchObject({ path: "/api/admin/analysis", rows: 1, admin: "masao" });
    // A later page of the same opening adds no line.
    await call("/api/admin/analysis?after=" + btoa(JSON.stringify(["0", "", ""])).replace(/=+$/, ""), { cookie: a.cookie });
    expect((await call("/api/admin/exports", { cookie: a.cookie })).body.log).toHaveLength(log.length);
  });
});

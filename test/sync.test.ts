import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { checkReports, keyHash, MAX_PUSH, normaliseKey, PULL_PAGE, ReportSync, type Sql, SyncCore, type SyncEnv } from "../worker/src/sync";
import worker from "../worker/src/index";

/** Durable Object SQL storage, played by Node's SQLite. */
function sqlite(): Sql {
  const db = new DatabaseSync(":memory:");
  // Like Durable Object storage, a statement runs at once; toArray only hands back its rows.
  return {
    exec: (q, ...b) => {
      const st = db.prepare(q);
      const rows = /^\s*SELECT/i.test(q) ? (st.all(...b) as Record<string, unknown>[]) : (st.run(...b), []);
      return { toArray: () => rows };
    },
  };
}

const rep = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({ id, updatedAt, at: "2026-11-11T03:00:00.000Z", sensation: 0, ...extra });
const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A Durable Object namespace whose objects live in memory, one per name. */
function namespace(): SyncEnv["SYNC"] & { names: Set<string> } {
  const objects = new Map<string, ReportSync>();
  const names = new Set<string>();
  return {
    names,
    idFromName: (n: string) => (names.add(n), n),
    get: (id: unknown) => {
      const n = String(id);
      if (!objects.has(n)) objects.set(n, new ReportSync({ storage: { sql: sqlite() } }));
      return objects.get(n)!;
    },
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const call = async (env: SyncEnv, key: string | null, body: unknown, method = "POST") => {
  const res = await worker.fetch(
    new Request("https://example.test/api/sync", {
      method,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    env,
    ctx,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("sync key", () => {
  it("ignores case, spaces and hyphens, and refuses anything else", () => {
    expect(normaliseKey("abcd-efgh ijkl-mnop-qrst-uvwx-yz")).toBe(KEY);
    expect(normaliseKey("ABCD")).toBeNull();
    expect(normaliseKey("ABCDEFGHIJKLMNOPQRSTUVWXY1")).toBeNull(); // 1 is not base32
    expect(normaliseKey(null)).toBeNull();
  });

  it("is never stored: the store is named by its hash", async () => {
    const h = await keyHash(KEY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(KEY);
  });
});

describe("one person's log", () => {
  it("keeps the newer copy, whatever order the devices send in", () => {
    const a = new SyncCore(sqlite());
    expect(a.push([rep("r1", 100, { sensation: 1 })])).toBe(1);
    expect(a.push([rep("r1", 50, { sensation: -2 })])).toBe(0); // older: ignored
    expect(a.push([rep("r1", 100, { sensation: 3 })])).toBe(0); // same time: the held copy stays
    expect(a.push([rep("r1", 200, { sensation: 2 })])).toBe(1);
    expect(a.pull(0).reports).toEqual([rep("r1", 200, { sensation: 2 })]);
    expect(a.count()).toBe(1);
  });

  it("hands out changes after the last seq seen, page by page, and passes deletions on", () => {
    const a = new SyncCore(sqlite());
    a.push(Array.from({ length: PULL_PAGE }, (_, i) => rep(`r${i}`, 10)));
    a.push([rep("x", 10)]);
    const first = a.pull(0);
    expect(first.reports).toHaveLength(PULL_PAGE);
    expect(first.more).toBe(true);
    const second = a.pull(first.seq);
    expect(second.reports.map((r) => r.id)).toEqual(["x"]);
    expect(second.more).toBe(false);
    a.push([rep("r0", 20, { deleted: true })]);
    const third = a.pull(second.seq);
    expect(third.reports).toEqual([rep("r0", 20, { deleted: true })]);
    expect(a.pull(third.seq)).toEqual({ reports: [], seq: third.seq, more: false });
  });

  it("refuses malformed or oversized pushes", () => {
    expect(() => checkReports([{ id: 1 }])).toThrow();
    expect(() => checkReports("x")).toThrow();
    expect(() => checkReports(Array.from({ length: MAX_PUSH + 1 }, (_, i) => rep(`r${i}`, 1)))).toThrow();
    expect(() => checkReports([rep("big", 1, { blob: "x".repeat(70_000) })])).toThrow();
    expect(checkReports(undefined)).toEqual([]);
  });

  it("erases only the server copy", () => {
    const a = new SyncCore(sqlite());
    a.push([rep("r1", 1)]);
    a.erase();
    expect(a.count()).toBe(0);
    expect(a.pull(0).reports).toEqual([]);
  });
});

describe("/api/sync with several people", () => {
  it("gives every key its own store: one person never sees another's reports", async () => {
    const SYNC = namespace();
    const env = { SYNC };
    const other = "ZYXWVUTSRQPONMLKJIHGFEDCBA";
    await call(env, KEY, { push: [rep("mine", 1)] });
    await call(env, other, { push: [rep("theirs", 1)] });
    const a = await call(env, KEY, { since: 0 });
    const b = await call(env, other, { since: 0 });
    expect((a.body.reports as { id: string }[]).map((r) => r.id)).toEqual(["mine"]);
    expect((b.body.reports as { id: string }[]).map((r) => r.id)).toEqual(["theirs"]);
    expect(SYNC.names.size).toBe(2);
    expect([...SYNC.names].some((n) => n.includes(KEY))).toBe(false);
  });

  it("brings a second device up to date, including its own changes", async () => {
    const env = { SYNC: namespace() };
    const phone = await call(env, KEY, { push: [rep("a", 1), rep("b", 1)], since: 0 });
    expect(phone.body).toMatchObject({ taken: 2, total: 2, seq: 2, more: false });
    const tablet = await call(env, KEY, { push: [rep("c", 5)], since: 0 });
    expect((tablet.body.reports as { id: string }[]).map((r) => r.id)).toEqual(["a", "b", "c"]);
    const again = await call(env, KEY, { since: phone.body.seq });
    expect((again.body.reports as { id: string }[]).map((r) => r.id)).toEqual(["c"]);
  });

  it("refuses a missing or wrong key, other methods, and a server without the store", async () => {
    const env = { SYNC: namespace() };
    expect((await call(env, null, { since: 0 })).status).toBe(401);
    expect((await call(env, "short", { since: 0 })).status).toBe(401);
    expect((await call({}, KEY, { since: 0 })).status).toBe(503);
    expect((await call(env, KEY, { push: [{ id: 3 }] })).status).toBe(400);
    const get = await worker.fetch(new Request("https://example.test/api/sync"), env, ctx);
    expect(get.status).toBe(405);
  });

  it("erases the server copy with DELETE", async () => {
    const env = { SYNC: namespace() };
    await call(env, KEY, { push: [rep("a", 1)] });
    expect((await call(env, KEY, null, "DELETE")).body).toEqual({ erased: true });
    expect((await call(env, KEY, { since: 0 })).body.reports).toEqual([]);
  });
});



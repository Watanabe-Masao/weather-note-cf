import { describe, expect, it } from "vitest";
import type { Report } from "../../src/beta/reports";
import { isMine, leavingReports, newerThanLocal, startState, type SyncDeps, syncOnce } from "../../src/beta/sync";
import { checkReports, ensureSchema, pullReports, pushReports } from "../../worker/src/accounts";
import { d1 } from "../d1";

const rep = (id: string, updatedAt: number, extra: Partial<Report> = {}) => ({ id, updatedAt, at: "2026-11-11T03:00:00.000Z", sensation: 0, ...extra }) as unknown as Report;

async function server() {
  const db = d1();
  await ensureSchema(db);
  for (const id of ["A", "B"])
    db.raw.prepare("INSERT INTO users (id, login_id, pw_hash, pw_salt, pw_iter, research_id, created_at) VALUES (?, ?, 'h', 's', 1, ?, 0)").run(id, id.toLowerCase(), `r${id}`);
  return db;
}

/** A device: its own IndexedDB (a map) talking to the server as `userId`. */
function device(db: Awaited<ReturnType<typeof server>>, clock: { t: number }, shared?: Map<string, Report>) {
  const store = shared ?? new Map<string, Report>();
  let calls = 0;
  const deps = (userId: string): SyncDeps => ({
    all: async () => [...store.values()],
    merge: async (list) => list.forEach((r) => store.set(r.id, r)),
    post: async (body) => {
      calls += 1;
      const b = body as { push: unknown; since: number };
      await pushReports(db, userId, checkReports(b.push) as never, clock.t);
      const n = db.raw.prepare("SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND deleted = 0").get(userId) as { n: number };
      return { ...(await pullReports(db, userId, b.since)), total: n.n };
    },
    now: () => clock.t,
  });
  return { store, deps, calls: () => calls };
}

describe("whose reports", () => {
  it("are the logged-in person's own, plus those made before any login", () => {
    expect(isMine(rep("x", 1), "A")).toBe(true);
    expect(isMine(rep("x", 1, { owner: "A" }), "A")).toBe(true);
    expect(isMine(rep("x", 1, { owner: "B" }), "A")).toBe(false);
  });

  it("takes from the server only what is newer than its own copy", () => {
    const local = [rep("a", 10), rep("b", 10)];
    expect(newerThanLocal(local, [rep("a", 5), rep("b", 20), rep("c", 1)]).map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("two devices of one person", () => {
  it("end with the same reports, deletions included, and adopt the reports made before logging in", async () => {
    const db = await server();
    const clock = { t: 1000 };
    const phone = device(db, clock);
    const tablet = device(db, clock);
    phone.store.set("p1", rep("p1", 900)); // made before the first login
    tablet.store.set("t1", rep("t1", 950, { owner: "A" }));

    let ps = await syncOnce(startState("A"), phone.deps("A"));
    let ts = await syncOnce(startState("A"), tablet.deps("A"));
    ps = await syncOnce(ps, phone.deps("A"));
    expect([...phone.store.keys()].sort()).toEqual(["p1", "t1"]);
    expect([...tablet.store.keys()].sort()).toEqual(["p1", "t1"]);
    expect(phone.store.get("p1")?.owner).toBe("A");
    expect(phone.store.get("p1")?.updatedAt).toBe(900); // owning is not an edit
    expect(ps.total).toBe(2);

    clock.t = 2000;
    tablet.store.set("p1", rep("p1", 2000, { deleted: true, owner: "A" }));
    ts = await syncOnce(ts, tablet.deps("A"));
    ps = await syncOnce(ps, phone.deps("A"));
    expect(phone.store.get("p1")?.deleted).toBe(true);
    expect(ps.total).toBe(1);
    void ts;
  });

  it("sends many reports in chunks and follows the server's pages", async () => {
    const db = await server();
    const clock = { t: 5000 };
    const a = device(db, clock);
    for (let i = 0; i < 450; i++) a.store.set(`r${i}`, rep(`r${i}`, 100, { owner: "A" }));
    await syncOnce(startState("A"), a.deps("A"));
    expect(a.calls()).toBeGreaterThanOrEqual(5);
    const b = device(db, clock);
    await syncOnce(startState("A"), b.deps("A"));
    expect(b.store.size).toBe(450);
  });

  it("keeps its place when the server cannot be reached, and says why", async () => {
    const s0 = { ...startState("A"), seq: 7, pushedAt: 3 };
    const s = await syncOnce(s0, {
      all: async () => [rep("x", 10)],
      merge: async () => {},
      post: async () => {
        throw new Error("通信できませんでした。");
      },
    });
    expect(s).toMatchObject({ seq: 7, pushedAt: 3, error: "通信できませんでした。" });
  });
});

describe("one device shared by two people", () => {
  it("never sends one person's reports to the other's account", async () => {
    const db = await server();
    const clock = { t: 1000 };
    const shared = new Map<string, Report>();
    const dev = device(db, clock, shared);
    shared.set("a1", rep("a1", 900, { owner: "A" }));
    shared.set("b1", rep("b1", 900, { owner: "B" }));
    await syncOnce(startState("A"), dev.deps("A"));
    await syncOnce(startState("B"), dev.deps("B"));
    const ids = (u: string) => (db.raw.prepare("SELECT id FROM reports WHERE user_id = ? ORDER BY id").all(u) as { id: string }[]).map((r) => r.id);
    expect(ids("A")).toEqual(["a1"]);
    expect(ids("B")).toEqual(["b1"]);
  });

  it("at logout removes only what the server already has", async () => {
    const db = await server();
    const clock = { t: 1000 };
    const dev = device(db, clock);
    dev.store.set("old", rep("old", 900, { owner: "A" }));
    const s = await syncOnce(startState("A"), dev.deps("A"));
    dev.store.set("new", rep("new", 1500, { owner: "A" })); // made after the last sync (offline)
    dev.store.set("other", rep("other", 100, { owner: "B" }));
    expect(leavingReports([...dev.store.values()], s)).toEqual(["old"]);
    expect(leavingReports([...dev.store.values()], startState("A"))).toEqual([]); // never synced: nothing leaves
  });
});

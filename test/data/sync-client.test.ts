import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { formatKey, newerThanLocal, newSyncKey, normaliseKey, startState, type SyncDeps, syncOnce } from "../../src/beta/sync";
import type { Report } from "../../src/beta/reports";
import { checkReports, type Sql, SyncCore } from "../../worker/src/sync";

function sqlite(): Sql {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (q, ...b) => {
      const st = db.prepare(q);
      const rows = /^\s*SELECT/i.test(q) ? (st.all(...b) as Record<string, unknown>[]) : (st.run(...b), []);
      return { toArray: () => rows };
    },
  };
}

const rep = (id: string, updatedAt: number, extra: Partial<Report> = {}) => ({ id, updatedAt, at: "2026-11-11T03:00:00.000Z", sensation: 0, ...extra }) as unknown as Report;

/** A device: its own IndexedDB (a map) talking to the shared server log. */
function device(server: SyncCore, clock: { t: number }) {
  const db = new Map<string, Report>();
  let calls = 0;
  const deps: SyncDeps = {
    all: async () => [...db.values()],
    merge: async (list) => list.forEach((r) => db.set(r.id, r)),
    post: async (_key, body) => {
      calls += 1;
      const b = body as { push: unknown; since: number };
      server.push(checkReports(b.push));
      return { ...server.pull(b.since), total: server.count() } as unknown as Awaited<ReturnType<SyncDeps["post"]>>;
    },
    now: () => clock.t,
  };
  return { db, deps, calls: () => calls };
}

describe("sync key on the device", () => {
  it("makes 26 base32 letters, readable in groups of four, that the server accepts", () => {
    const keys = new Set(Array.from({ length: 200 }, newSyncKey));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(normaliseKey(k)).toBe(k);
    expect(formatKey("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ");
    expect(normaliseKey(" abcd-efgh-ijkl-mnop-qrst-uvwx-yz ")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });

  it("takes from the server only what is newer than its own copy", () => {
    const local = [rep("a", 10), rep("b", 10)];
    expect(newerThanLocal(local, [rep("a", 5), rep("b", 20), rep("c", 1)]).map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("two devices with one key", () => {
  it("end with the same reports, deletions included, and only send what changed", async () => {
    const server = new SyncCore(sqlite());
    const clock = { t: 1000 };
    const phone = device(server, clock);
    const tablet = device(server, clock);
    phone.db.set("p1", rep("p1", 900));
    tablet.db.set("t1", rep("t1", 950));

    let ps = await syncOnce(startState("K"), phone.deps);
    let ts = await syncOnce(startState("K"), tablet.deps);
    ps = await syncOnce(ps, phone.deps);
    expect([...phone.db.keys()].sort()).toEqual(["p1", "t1"]);
    expect([...tablet.db.keys()].sort()).toEqual(["p1", "t1"]);
    expect(ps.total).toBe(2);

    // Deleting on the tablet reaches the phone.
    clock.t = 2000;
    tablet.db.set("p1", rep("p1", 2000, { deleted: true }));
    ts = await syncOnce(ts, tablet.deps);
    ps = await syncOnce(ps, phone.deps);
    expect(phone.db.get("p1")?.deleted).toBe(true);

    // Nothing changed: nothing is sent (the push is empty) and nothing comes back.
    const before = server.pull(0).seq;
    ps = await syncOnce(ps, phone.deps);
    expect(server.pull(0).seq).toBe(before);
    expect(ps.error).toBeNull();
    void ts;
  });

  it("sends many reports in chunks and follows the server's pages", async () => {
    const server = new SyncCore(sqlite());
    const clock = { t: 5000 };
    const a = device(server, clock);
    for (let i = 0; i < 450; i++) a.db.set(`r${i}`, rep(`r${i}`, 100));
    const s = await syncOnce(startState("K"), a.deps);
    expect(server.count()).toBe(450);
    expect(a.calls()).toBeGreaterThanOrEqual(5); // 100 per push
    const b = device(server, clock);
    await syncOnce(startState("K"), b.deps);
    expect(b.db.size).toBe(450);
    expect(s.seq).toBe(450);
  });

  it("keeps its place when the server cannot be reached, and says why", async () => {
    const s0 = { ...startState("K"), seq: 7, pushedAt: 3 };
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

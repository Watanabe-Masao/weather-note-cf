// #86 P2: deleting one's account while a sync runs, and when the device's clean-up fails.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Report } from "../../src/beta/reports";

const store = new Map<string, Report>();
let me: { id: string } | null = { id: "u1" };
const listeners: (() => void)[] = [];
let failDrop = false;
let releaseSync: (() => void) | null = null;
const apiCalls: string[] = [];

vi.mock("../../src/account/account", () => ({
  api: vi.fn(async (path: string) => {
    apiCalls.push(path);
    if (path === "/api/me/delete") return { deleted: true };
    return {};
  }),
  currentMe: () => me,
  onAccountChanged: (fn: () => void) => (listeners.push(fn), () => {}),
  logOut: vi.fn(async () => {
    me = null;
    listeners.forEach((fn) => fn());
  }),
  refreshAccount: vi.fn(async () => {}),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useEffect: (fn: () => void) => void fn() }));
vi.mock("../../src/account/push", () => ({ turnOffDevice: vi.fn(async () => {}) }));
vi.mock("../../src/beta/useReports", () => ({
  reports: {
    all: async () => [...store.values()],
    merge: async (list: Report[]) => list.forEach((r) => store.set(r.id, r)),
    drop: async (ids: string[]) => {
      if (failDrop) throw new Error("db");
      ids.forEach((id) => store.delete(id));
    },
  },
  onReportsChanged: () => () => {},
}));
vi.mock("../../src/beta/sync", () => ({
  loadSync: (userId: string) => ({ userId, since: 0 }),
  saveSync: () => {},
  leavingReports: () => [],
  // A slow sync: it merges what it "got" only when released (after the deletion is done).
  syncOnce: async (start: unknown, deps: { merge: (l: Report[]) => Promise<void> }) => {
    await new Promise<void>((r) => (releaseSync = r));
    await deps.merge([{ id: "back", owner: "u1" } as Report]);
    return start;
  },
}));

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
vi.stubGlobal("window", { addEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

beforeEach(() => {
  store.clear();
  mem.clear();
  me = { id: "u1" };
  failDrop = false;
  apiCalls.length = 0;
});

describe("deleting one's account", () => {
  it("a sync still running after the wait writes nothing back", async () => {
    vi.useFakeTimers();
    const { deleteAccountAndLeave, useAutoSync } = await import("../../src/beta/useSync");
    useAutoSync(); // logged in: a sync starts and hangs
    store.set("r1", { id: "r1", owner: "u1" } as Report);
    const done = deleteAccountAndLeave("pw");
    await vi.advanceTimersByTimeAsync(6000); // longer than the 5 s wait
    const result = await done;
    releaseSync?.(); // the slow sync now tries to merge
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(result.local).toBe(true);
    expect([...store.keys()]).toEqual([]);
    expect(me).toBeNull();
  });

  it("logs out and tells the person when the device's reports could not be removed", async () => {
    vi.useFakeTimers();
    const { deleteAccountAndLeave, DELETION_NOTE_KEY } = await import("../../src/beta/useSync");
    listeners.forEach((fn) => fn()); // logged in again
    store.set("r1", { id: "r1", owner: "u1" } as Report);
    failDrop = true;
    const done = deleteAccountAndLeave("pw");
    await vi.advanceTimersByTimeAsync(6000);
    const result = await done;
    releaseSync?.();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(result.local).toBe(false);
    expect(me).toBeNull();
    expect(mem.get(DELETION_NOTE_KEY)).toContain("消せませんでした");
  });
});

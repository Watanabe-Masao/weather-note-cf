// The reports on the server (worker/src/accounts.ts): sending this device's changes and taking the
// changes from the person's other devices.
//
// A device remembers, per account, the last seq it has seen and when it last sent its changes. One
// sync: send every report of this person changed since then (in chunks), and take every change
// after the last seq, keeping a report only when it is newer than the copy here. Reports stay in
// IndexedDB as before; the server copy makes them survive a lost phone and reach other devices.
//
// Whose a report is: `owner` (the account's id). A report made before the first login has none and
// is taken by the first account that syncs on this device. A device shared by two people keeps each
// person's reports apart: only the logged-in person's reports are sent, shown and learnt from.

import type { Report } from "./reports";

const CHUNK = 100;

export interface SyncState {
  userId: string;
  /** The last change seen from the server. */
  seq: number;
  /** Changes on this device from this time on (ms) are sent next time. */
  pushedAt: number;
  /** When the last sync finished (ms), and how many reports the server then held. */
  lastSync: number | null;
  total: number | null;
  error: string | null;
}

const keyOf = (userId: string) => `weather-note-sync:${userId}`;

export function loadSync(userId: string): SyncState {
  try {
    const s = JSON.parse(localStorage.getItem(keyOf(userId)) ?? "null") as SyncState | null;
    if (s && s.userId === userId) return s;
  } catch {
    // fall through
  }
  return startState(userId);
}

export function saveSync(s: SyncState): void {
  try {
    localStorage.setItem(keyOf(s.userId), JSON.stringify(s));
  } catch {
    // Storage blocked: the next sync starts over (harmless: the server keeps the newer copies).
  }
}

/** A fresh state: everything of this person on the device is sent, everything on the server taken. */
export const startState = (userId: string): SyncState => ({ userId, seq: 0, pushedAt: 0, lastSync: null, total: null, error: null });

/** This person's reports on the device: their own, and those made before any login. */
export const isMine = (r: Report, userId: string) => r.owner == null || r.owner === userId;

/** The reports from the server that are newer than this device's copy (or new to it). */
export function newerThanLocal(local: Report[], remote: Report[]): Report[] {
  const held = new Map(local.map((r) => [r.id, r.updatedAt]));
  const out = new Map<string, Report>();
  for (const r of remote) {
    const mine = held.get(r.id);
    if (mine != null && mine >= r.updatedAt) continue;
    const seen = out.get(r.id);
    if (!seen || seen.updatedAt < r.updatedAt) out.set(r.id, r);
  }
  return [...out.values()];
}

interface Answer {
  reports?: Report[];
  seq?: number;
  more?: boolean;
  total?: number;
}

export interface SyncDeps {
  all(): Promise<Report[]>;
  /** Saves reports as they are (no updatedAt change: owning or taking is not an edit). */
  merge(list: Report[]): Promise<void>;
  post(body: unknown): Promise<Answer>;
  now?: () => number;
}

/** One full sync. Returns the new state (with `error` set and nothing else moved if it failed). */
export async function syncOnce(state: SyncState, deps: SyncDeps): Promise<SyncState> {
  const now = deps.now ?? Date.now;
  const started = now();
  const me = state.userId;
  try {
    const local = (await deps.all()).filter((r) => isMine(r, me));
    // `>=`: a report saved in the same millisecond as the last sync is sent again (harmless).
    const changed = local.filter((r) => r.updatedAt >= state.pushedAt || r.owner == null).map((r) => ({ ...r, owner: me }));
    const chunks: Report[][] = [];
    for (let i = 0; i < changed.length; i += CHUNK) chunks.push(changed.slice(i, i + CHUNK));
    let since = state.seq;
    let total = state.total;
    let more = false;
    do {
      const push = chunks.shift() ?? [];
      const ans = await deps.post({ push, since });
      const all = await deps.all();
      // Sent reports are this person's from now on (unless changed on the device meanwhile).
      const owned = push.filter((r) => {
        const now = all.find((l) => l.id === r.id);
        return now != null && now.owner == null && now.updatedAt === r.updatedAt;
      });
      const taken = newerThanLocal(all, ans.reports ?? []).map((r) => ({ ...r, owner: me }));
      if (owned.length || taken.length) await deps.merge([...owned, ...taken]);
      since = ans.seq ?? since;
      more = !!ans.more;
      total = ans.total ?? total;
    } while (chunks.length || more);
    return { ...state, seq: since, pushedAt: started, lastSync: now(), total, error: null };
  } catch (e) {
    return { ...state, error: (e as Error).message || "同期に失敗しました。" };
  }
}

/**
 * The reports to remove from this device at logout: this person's reports that the server already
 * has (sent before the last sync). Anything changed since stays, so nothing is lost offline.
 */
export function leavingReports(all: Report[], state: SyncState): string[] {
  return all.filter((r) => r.owner === state.userId && state.lastSync != null && r.updatedAt < state.pushedAt).map((r) => r.id);
}

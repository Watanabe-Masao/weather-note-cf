// β③: syncing the reports with the server through a 同期キー (see worker/src/sync.ts).
//
// A device remembers its key, the last seq it has seen and when it last sent its changes. One sync:
// send every report changed since then (in chunks), and take every change after the last seq,
// keeping a report only when it is newer than the copy on this device. Reports stay in IndexedDB
// as before; the server is a copy that makes them survive a lost phone and reach other devices.

import type { Report } from "./reports";

const STORE_KEY = "weather-note-sync";
const CHUNK = 100;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface SyncState {
  key: string;
  /** The last change seen from the server. */
  seq: number;
  /** Changes on this device from this time on (ms) are sent next time. */
  pushedAt: number;
  /** When the last sync finished (ms), and how many reports the server then held. */
  lastSync: number | null;
  total: number | null;
  error: string | null;
}

/** A new key: 128 random bits as 26 base32 letters (no 0/1/8/9, so it reads aloud and types well). */
export function newSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(17));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff; // only the low bits are still needed
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** The key as typed or pasted: case, spaces and hyphens do not matter (same rule as the server). */
export function normaliseKey(raw: string): string | null {
  const k = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{26}$/.test(k) ? k : null;
}

/** ABCD-EFGH-…-YZ: easier to read and to compare between two screens. */
export const formatKey = (k: string) => k.match(/.{1,4}/g)!.join("-");

export function loadSync(): SyncState | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as SyncState | null;
    return s && normaliseKey(s.key) ? s : null;
  } catch {
    return null;
  }
}

export function saveSync(s: SyncState | null): void {
  try {
    if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage blocked: the key lasts for this visit only.
  }
}

/** A fresh state for a key: everything on this device is sent, everything on the server taken. */
export const startState = (key: string): SyncState => ({ key, seq: 0, pushedAt: 0, lastSync: null, total: null, error: null });

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
  error?: string;
}

export interface SyncDeps {
  all(): Promise<Report[]>;
  merge(list: Report[]): Promise<void>;
  post(key: string, body: unknown): Promise<Answer>;
  now?: () => number;
}

/** One full sync. Returns the new state (with `error` set and nothing else moved if it failed). */
export async function syncOnce(state: SyncState, deps: SyncDeps): Promise<SyncState> {
  const now = deps.now ?? Date.now;
  const started = now();
  try {
    const local = await deps.all();
    // `>=`: a report saved in the same millisecond as the last sync is sent again (harmless).
    const changed = local.filter((r) => r.updatedAt >= state.pushedAt);
    const chunks: Report[][] = [];
    for (let i = 0; i < changed.length; i += CHUNK) chunks.push(changed.slice(i, i + CHUNK));
    let since = state.seq;
    let total = state.total;
    let more = false;
    do {
      const ans = await deps.post(state.key, { push: chunks.shift() ?? [], since });
      const newer = newerThanLocal(await deps.all(), ans.reports ?? []);
      if (newer.length) await deps.merge(newer);
      since = ans.seq ?? since;
      more = !!ans.more;
      total = ans.total ?? total;
    } while (chunks.length || more);
    return { ...state, seq: since, pushedAt: started, lastSync: now(), total, error: null };
  } catch (e) {
    return { ...state, error: (e as Error).message || "同期に失敗しました。" };
  }
}

const failure = (status: number, body: Answer | null) =>
  new Error(body?.error ?? (status >= 500 ? "同期に失敗しました。時間をおいて再試行してください。" : "同期できませんでした。"));

/** POST /api/sync with the key. Network errors become a plain Japanese message. */
export async function postSync(key: string, body: unknown): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch("/api/sync", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("通信できませんでした。電波のあるところで、もう一度お試しください。");
  }
  const data = (await res.json().catch(() => null)) as Answer | null;
  if (!res.ok || !data) throw failure(res.status, data);
  return data;
}

/** DELETE /api/sync: the server copy of this key's reports. */
export async function eraseServer(key: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/sync", { method: "DELETE", headers: { Authorization: `Bearer ${key}` } });
  } catch {
    throw new Error("通信できませんでした。電波のあるところで、もう一度お試しください。");
  }
  if (!res.ok) throw failure(res.status, (await res.json().catch(() => null)) as Answer | null);
}

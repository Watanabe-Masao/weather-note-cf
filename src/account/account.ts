// The person logged in on this device (or nobody), shared by the whole app.
//
// Accounts are issued by the administrator; there is no sign-up. Logging in gives the device an
// HttpOnly session cookie (the app never sees it), so this module only keeps who it is for the
// screen. Reports and β need a login; the weather does not.

import { useSyncExternalStore } from "react";

export interface Me {
  id: string;
  loginId: string;
  name: string | null;
  role: "user" | "admin";
  research: { granted: boolean; version: number | null; at: number | null };
  consentVersion: number;
}

export interface AccountView {
  /** "unknown" until the server has answered once (or the last answer, kept for offline opening). */
  status: "unknown" | "ready";
  me: Me | null;
  /** The server has no accounts yet and accepts the setup code. */
  setup: boolean;
}

const CACHE = "weather-note-account";

function cached(): Me | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? "null") as Me | null;
  } catch {
    return null;
  }
}

let view: AccountView = { status: cached() ? "ready" : "unknown", me: cached(), setup: false };
const subs = new Set<() => void>();
function set(v: Partial<AccountView>) {
  view = { ...view, ...v };
  try {
    if (view.me) localStorage.setItem(CACHE, JSON.stringify(view.me));
    else localStorage.removeItem(CACHE);
  } catch {
    // storage blocked: remembered for this visit only
  }
  subs.forEach((fn) => fn());
}

export const currentMe = () => view.me;

export function onAccountChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}

export function useAccount(): AccountView {
  return useSyncExternalStore(onAccountChanged, () => view);
}

/** A request to the account API. Errors become a plain Japanese message (`Error.message`). */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("通信できませんでした。電波のあるところで、もう一度お試しください。");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 401 && path !== "/api/auth/login") set({ me: null }); // the session ended (expired, reset, stopped)
  if (!res.ok || !data) throw Object.assign(new Error(data?.error ?? "処理に失敗しました。時間をおいて再試行してください。"), { status: res.status });
  return data;
}

/** The server asks for the password again before the research data (#86). */
export const needsReauth = (e: unknown) => (e as { status?: number })?.status === 428;

/** Asks the server who is logged in. Offline, the last answer stands. */
export async function refreshAccount(): Promise<void> {
  try {
    const r = await api<{ user: Me | null; setup: boolean }>("/api/auth/me");
    set({ status: "ready", me: r.user, setup: r.setup });
  } catch {
    set({ status: "ready" });
  }
}

export async function logIn(loginId: string, password: string): Promise<void> {
  const r = await api<{ user: Me }>("/api/auth/login", { loginId, password });
  set({ me: r.user, setup: false });
}

/** Makes the first administrator. Returns the password (shown once). */
export async function setUp(code: string, loginId: string, name: string): Promise<string> {
  const r = await api<{ user: Me; password: string }>("/api/auth/setup", { code, loginId, name });
  set({ me: r.user, setup: false });
  return r.password;
}

export async function logOut(): Promise<void> {
  await api("/api/auth/logout", {}).catch(() => {});
  set({ me: null });
}

export async function answerResearch(granted: boolean): Promise<void> {
  const r = await api<{ user: Me }>("/api/me/consent", { granted });
  set({ me: r.user });
}

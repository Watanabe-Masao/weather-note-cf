// The one sync of this app (reports ↔ server, for the logged-in person): its state for the screen,
// and the moments it runs by itself — after logging in, when the app opens, a few seconds after a
// report changes, when the connection comes back and when the app comes to the front again.

import { useEffect, useSyncExternalStore } from "react";
import { api, currentMe, logOut, onAccountChanged, refreshAccount } from "../account/account";
import { turnOffDevice } from "../account/push";
import { leavingReports, loadSync, saveSync, type SyncState, syncOnce } from "./sync";
import { onReportsChanged, reports } from "./useReports";

interface View {
  state: SyncState | null;
  running: boolean;
}

let view: View = { state: null, running: false };
const subs = new Set<() => void>();
const set = (v: Partial<View>) => {
  view = { ...view, ...v };
  subs.forEach((fn) => fn());
};

/** Follows the account: its own sync state, or none when logged out. */
function follow() {
  const me = currentMe();
  if (!me) {
    if (view.state) set({ state: null });
    return;
  }
  if (view.state?.userId !== me.id) {
    set({ state: loadSync(me.id) });
    void syncNow();
  }
}

let again = false;

/** Runs a sync now (or once more right after the one already running). */
/** Set while an account is being deleted: no sync may write the person's reports back. */
let leaving = false;

export async function syncNow(): Promise<void> {
  if (!view.state || leaving) return;
  if (view.running) {
    again = true;
    return;
  }
  set({ running: true });
  const start = view.state;
  const next = await syncOnce(start, { all: reports.all, merge: reports.merge, post: (b) => api("/api/reports/sync", b) });
  // Logged out or switched while this ran: keep what the person did.
  if (view.state?.userId === start.userId) {
    saveSync(next);
    set({ state: next });
  }
  set({ running: false });
  if (again) {
    again = false;
    void syncNow();
  }
}

/**
 * Logs out. Sends the last changes first; then this person's reports that the server has are
 * removed from the device (the next person on it does not see them). Reports that could not be
 * sent stay here, and go up at the next login.
 */
export async function logOutAndLeave(): Promise<{ kept: number }> {
  await syncNow();
  const s = view.state;
  let kept = 0;
  if (s) {
    const all = await reports.all();
    const leave = leavingReports(all, s);
    kept = all.filter((r) => r.owner === s.userId).length - leave.length;
    await reports.drop(leave);
  }
  await turnOffDevice(); // this device stops getting this person's notifications
  await logOut();
  return { kept };
}

/**
 * Deletes the person's own account (#55): everything on the server, and their reports on this
 * device, including ones not sent yet. The password confirms it; a wrong one changes nothing.
 */
export async function deleteAccountAndLeave(password: string): Promise<void> {
  const s = view.state;
  await api("/api/me/delete", { password });
  // The account is gone on the server: from here every step runs, whatever fails, and the person
  // is logged out at the end (a retry could not log in again; review 2026-11-12).
  leaving = true;
  try {
    // A sync already running could write the reports back after they are dropped: let it end first.
    for (let i = 0; i < 50 && view.running; i++) await new Promise((r) => setTimeout(r, 100));
    if (s) {
      const mine = (await reports.all()).filter((r) => r.owner === s.userId);
      await reports.drop(mine.map((r) => r.id));
    }
  } catch (e) {
    console.warn("weather-note: local reports not removed", e);
  }
  await turnOffDevice().catch(() => {}); // the server side is already gone; this ends the browser's subscription
  await logOut().catch(() => {});
  leaving = false;
}

export function useSync(): View {
  return useSyncExternalStore(
    (fn) => (subs.add(fn), () => void subs.delete(fn)),
    () => view,
  );
}

const DEBOUNCE = 3000;

/** Mount once (App): checks the login and syncs by itself while someone is logged in. */
export function useAutoSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (!view.state) return;
      // A change while a sync runs (a new report, or the sync's own merge) gets one more sync
      // right after, so nothing saved meanwhile waits for the next opening.
      if (view.running) {
        again = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), DEBOUNCE);
    };
    const visible = () => document.visibilityState === "visible" && void syncNow();
    const online = () => void refreshAccount().then(syncNow);
    follow();
    void refreshAccount();
    const offAccount = onAccountChanged(follow);
    const offReports = onReportsChanged(soon);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      offAccount();
      offReports();
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
}

// β③: the one sync of this app — its state shared by the settings screen, and the moments it runs
// by itself: when the app opens, a few seconds after a report changes, when the connection comes
// back and when the app comes to the front again.

import { useEffect, useSyncExternalStore } from "react";
import { eraseServer, loadSync, postSync, saveSync, startState, type SyncState, syncOnce } from "./sync";
import { onReportsChanged, reports } from "./useReports";

interface View {
  state: SyncState | null;
  running: boolean;
}

let view: View = { state: loadSync(), running: false };
const subs = new Set<() => void>();
const set = (v: Partial<View>) => {
  view = { ...view, ...v };
  subs.forEach((fn) => fn());
};

let again = false;

/** Runs a sync now (or once more right after the one already running). */
export async function syncNow(): Promise<void> {
  if (!view.state) return;
  if (view.running) {
    again = true;
    return;
  }
  set({ running: true });
  const key = view.state.key;
  const next = await syncOnce(view.state, { all: reports.all, merge: reports.merge, post: postSync });
  // The key was dropped or replaced while this ran: keep what the person chose.
  if (view.state?.key === key) {
    saveSync(next);
    set({ state: next });
  }
  set({ running: false });
  if (again) {
    again = false;
    void syncNow();
  }
}

export const sync = {
  /** Starts syncing with `key` (a new one, or one from another device). */
  use(key: string) {
    const s = startState(key);
    saveSync(s);
    set({ state: s });
    void syncNow();
  },
  /** Stops syncing on this device (the reports stay here and on the server). */
  leave() {
    saveSync(null);
    set({ state: null });
  },
  /** Deletes the server copy, then stops syncing on this device. */
  async erase(): Promise<string | null> {
    if (!view.state) return null;
    try {
      await eraseServer(view.state.key);
      sync.leave();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  },
};

export function useSync(): View {
  return useSyncExternalStore(
    (fn) => (subs.add(fn), () => void subs.delete(fn)),
    () => view,
  );
}

const DEBOUNCE = 3000;

/** Mount once (App): syncs by itself while a key is set. */
export function useAutoSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (!view.state) return;
      // A change while a sync runs (a new report, or the sync's own merge) gets one more sync right
      // after, so nothing saved meanwhile waits for the next opening.
      if (view.running) {
        again = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), DEBOUNCE);
    };
    const visible = () => document.visibilityState === "visible" && void syncNow();
    const online = () => void syncNow();
    void syncNow();
    const off = onReportsChanged(soon);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      off();
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
}

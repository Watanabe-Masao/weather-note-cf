// The app's one report store, and a hook that re-renders when reports change.

import { useEffect, useState } from "react";
import { type Report, reportStore } from "./reports";

const store = reportStore();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

export const reports = {
  all: () => store.all(),
  async add(r: Report) {
    await store.put(r);
    changed();
  },
  async remove(id: string) {
    await store.remove(id);
    changed();
  },
  async wipe() {
    await store.wipe();
    changed();
  },
  /** For syncing (β③): put reports that came from elsewhere. */
  async merge(list: Report[]) {
    for (const r of list) await store.put(r);
    changed();
  },
};

/** Live reports, newest first (deleted ones left out). */
export function useReports(): Report[] | null {
  const [list, setList] = useState<Report[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void store.all().then((all) => alive && setList(all.filter((r) => !r.deleted).sort((a, b) => (a.at < b.at ? 1 : -1))));
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, []);
  return list;
}

/** Calls `fn` whenever reports change on this device (added, deleted, merged, wiped). */
export function onReportsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

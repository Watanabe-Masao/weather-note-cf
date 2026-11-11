// The app's one report store, and a hook that re-renders when reports change.
//
// Only the logged-in person's reports are shown and learnt from (sync.ts: `owner`); with nobody
// logged in, there are none to show (reports and β need a login).

import { useEffect, useState } from "react";
import { currentMe, onAccountChanged } from "../account/account";
import { type Report, reportStore } from "./reports";
import { isMine } from "./sync";

const store = reportStore();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

export const reports = {
  all: () => store.all(),
  /** This person's reports on the device (all of them, deleted included). */
  async mine(): Promise<Report[]> {
    const me = currentMe();
    return me ? (await store.all()).filter((r) => isMine(r, me.id)) : [];
  },
  async add(r: Report) {
    const me = currentMe();
    await store.put(me ? { ...r, owner: me.id } : r);
    changed();
  },
  async remove(id: string) {
    await store.remove(id);
    changed();
  },
  /** Clears this person's reports from the device (the server copy stays). */
  async wipe() {
    const mine = await reports.mine();
    await store.drop(mine.map((r) => r.id));
    changed();
  },
  async drop(ids: string[]) {
    await store.drop(ids);
    changed();
  },
  /** For syncing: put reports as they come (owned, or from the server). */
  async merge(list: Report[]) {
    for (const r of list) await store.put(r);
    changed();
  },
};

/** Calls `fn` whenever reports change on this device (added, deleted, merged, wiped). */
export function onReportsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Live reports of the logged-in person, newest first (deleted ones left out). */
export function useReports(): Report[] | null {
  const [list, setList] = useState<Report[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void reports.mine().then((all) => alive && setList(all.filter((r) => !r.deleted).sort((a, b) => (a.at < b.at ? 1 : -1))));
    load();
    listeners.add(load);
    const off = onAccountChanged(load);
    return () => {
      alive = false;
      listeners.delete(load);
      off();
    };
  }, []);
  return list;
}

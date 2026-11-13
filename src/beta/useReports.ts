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

/** The date in Japan of a time (ISO or ms). */
const jstDate = (t: string | number) => new Date((typeof t === "number" ? t : Date.parse(t)) + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * Whether today's 暑くも寒くもない肌感 may be shown: only once the person has made a report today. Seen
 * before, the day's centre would pull the answer towards itself (#38); the record screen likewise
 * shows its prediction only after the feeling is chosen. Other days are always shown.
 */
/** Milliseconds from `now` to the next 0:00 JST. */
export const msToJstMidnight = (now: number) => 86_400_000 - ((now + 9 * 3_600_000) % 86_400_000);

/**
 * Today's JST date, kept current: the screen re-renders at 0:00 JST and when the app comes back
 * into view (a timer does not run while the phone sleeps), so an app left open across midnight
 * does not keep treating yesterday as today (review #86).
 */
export function useJstToday(): string {
  const [today, setToday] = useState(() => jstDate(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => setToday(jstDate(Date.now()));
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (check(), arm()), msToJstMidnight(Date.now()) + 1_000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") (check(), arm());
    };
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}

export function useCentreVisible(): (date: string) => boolean {
  const list = useReports();
  const today = useJstToday();
  const reportedToday = (list ?? []).some((r) => jstDate(r.at) === today);
  return (date: string) => date !== today || reportedToday;
}

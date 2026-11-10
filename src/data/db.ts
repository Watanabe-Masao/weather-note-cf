// Browser storage (IndexedDB). Everything here is a cache of what the API returned;
// clearing it only means the data is fetched again.

import { type IDBPDatabase, openDB } from "idb";
import type { WeatherRow } from "../../shared/types";

/** Bump when the stored shape changes; old data is then discarded and fetched again. */
export const DATA_VERSION = 1;
const DB_NAME = "weather-note";

export type Kind = "fixed" | "variable";

export interface DayRecord {
  key: string; // station/date
  station: string;
  date: string;
  row: WeatherRow | null; // null: the source answered but had no row for this day
  kind: Kind;
  source: "jma" | "recent" | "forecast";
  savedAt: number;
}

export interface HourRecord {
  key: string; // station/date
  station: string;
  date: string;
  rows: WeatherRow[];
  kind: Kind;
  source: "jma" | "current" | "forecast";
  savedAt: number;
}

interface Meta {
  key: string;
  value: unknown;
}

export interface Storage {
  getDays(keys: string[]): Promise<DayRecord[]>;
  getHours(keys: string[]): Promise<HourRecord[]>;
  putDays(records: DayRecord[]): Promise<void>;
  putHours(records: HourRecord[]): Promise<void>;
  deleteDays(keys: string[]): Promise<void>;
  deleteHours(keys: string[]): Promise<void>;
  allDayKeys(): Promise<string[]>;
  allHourKeys(): Promise<string[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  count(): Promise<{ days: number; hours: number }>;
  clear(): Promise<void>;
}

/** IndexedDB-backed storage. If IndexedDB is unavailable, falls back to memory only. */
export async function openStorage(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<Storage> {
  if (!factory) return memoryStorage();
  let db: IDBPDatabase;
  try {
    // idb uses the global indexedDB; tests install fake-indexeddb globally.
    db = await openDB(DB_NAME, DATA_VERSION, {
      upgrade(database) {
        for (const name of [...database.objectStoreNames]) database.deleteObjectStore(name);
        database.createObjectStore("days", { keyPath: "key" });
        database.createObjectStore("hours", { keyPath: "key" });
        database.createObjectStore("meta", { keyPath: "key" });
      },
    });
  } catch {
    return memoryStorage();
  }
  const getMany = async <T>(store: "days" | "hours", keys: string[]) => {
    const tx = db.transaction(store);
    const found = await Promise.all(keys.map((k) => tx.store.get(k)));
    await tx.done;
    return found.filter(Boolean) as T[];
  };
  const putMany = async (store: "days" | "hours", records: unknown[]) => {
    if (!records.length) return;
    const tx = db.transaction(store, "readwrite");
    await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
  };
  const deleteMany = async (store: "days" | "hours", keys: string[]) => {
    if (!keys.length) return;
    const tx = db.transaction(store, "readwrite");
    await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
  };
  return {
    getDays: (keys) => getMany<DayRecord>("days", keys),
    getHours: (keys) => getMany<HourRecord>("hours", keys),
    putDays: (r) => putMany("days", r),
    putHours: (r) => putMany("hours", r),
    deleteDays: (k) => deleteMany("days", k),
    deleteHours: (k) => deleteMany("hours", k),
    allDayKeys: async () => (await db.getAllKeys("days")) as string[],
    allHourKeys: async () => (await db.getAllKeys("hours")) as string[],
    getMeta: async <T>(key: string) => ((await db.get("meta", key)) as Meta | undefined)?.value as T | undefined,
    setMeta: async (key, value) => {
      await db.put("meta", { key, value });
    },
    count: async () => ({ days: await db.count("days"), hours: await db.count("hours") }),
    clear: async () => {
      const tx = db.transaction(["days", "hours", "meta"], "readwrite");
      await Promise.all([
        tx.objectStore("days").clear(),
        tx.objectStore("hours").clear(),
        tx.objectStore("meta").clear(),
        tx.done,
      ]);
    },
  };
}

/** Used when IndexedDB is missing or blocked: the app still works, it just forgets on reload. */
export function memoryStorage(): Storage {
  const days = new Map<string, DayRecord>();
  const hours = new Map<string, HourRecord>();
  const meta = new Map<string, unknown>();
  return {
    getDays: async (keys) => keys.flatMap((k) => (days.has(k) ? [days.get(k)!] : [])),
    getHours: async (keys) => keys.flatMap((k) => (hours.has(k) ? [hours.get(k)!] : [])),
    putDays: async (r) => r.forEach((x) => days.set(x.key, x)),
    putHours: async (r) => r.forEach((x) => hours.set(x.key, x)),
    deleteDays: async (k) => k.forEach((x) => days.delete(x)),
    deleteHours: async (k) => k.forEach((x) => hours.delete(x)),
    allDayKeys: async () => [...days.keys()],
    allHourKeys: async () => [...hours.keys()],
    getMeta: async <T>(key: string) => meta.get(key) as T | undefined,
    setMeta: async (key, value) => {
      meta.set(key, value);
    },
    count: async () => ({ days: days.size, hours: hours.size }),
    clear: async () => {
      days.clear();
      hours.clear();
      meta.clear();
    },
  };
}

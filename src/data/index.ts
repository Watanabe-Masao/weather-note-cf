// The app's single store instance, and a React hook to read it.

import { useSyncExternalStore } from "react";
import { openStorage } from "./db";
import { WeatherStore } from "./store";

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { signal: AbortSignal.timeout(35_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}

let version = 0;
let instance: WeatherStore | null = null;
let starting: Promise<WeatherStore> | null = null;

/** Open storage, create the store and keep the date in step with the device. */
export function startStore(): Promise<WeatherStore> {
  starting ??= (async () => {
    const storage = await openStorage();
    const local = (() => {
      try {
        return globalThis.localStorage ?? null;
      } catch {
        return null;
      }
    })();
    const store = new WeatherStore({
      storage,
      fetchJson,
      localStore: local,
      persist: navigator.storage?.persist ? () => navigator.storage.persist() : undefined,
    });
    await store.start();
    store.subscribe(() => version++);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void store.checkDate();
    });
    setInterval(() => void store.checkDate(), 60_000);
    instance = store;
    version++;
    return store;
  })();
  return starting;
}

const subscribe = (fn: () => void) => {
  let unsubscribe = () => {};
  void startStore().then((s) => {
    unsubscribe = s.subscribe(fn);
    fn();
  });
  return () => unsubscribe();
};

/** Re-render whenever the store reports a change; returns the store (null until it is ready). */
export function useWeatherStore(): WeatherStore | null {
  useSyncExternalStore(subscribe, () => version);
  return instance;
}

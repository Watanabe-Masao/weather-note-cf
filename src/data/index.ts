// The app's single store instance, and a React hook to read it.

import { useSyncExternalStore } from "react";
import { openStorage } from "./db";
import { fetchJson } from "./fetchJson";
import { WeatherStore } from "./store";


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
      fetchJson: (path) => fetchJson(path),
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
  let cancelled = false; // React may unsubscribe before storage has opened (e.g. Strict Mode)
  void startStore().then((s) => {
    if (cancelled) return;
    unsubscribe = s.subscribe(fn);
    fn();
  });
  return () => {
    cancelled = true;
    unsubscribe();
  };
};

/** Re-render whenever the store reports a change; returns the store (null until it is ready). */
export function useWeatherStore(): WeatherStore | null {
  useSyncExternalStore(subscribe, () => version);
  return instance;
}

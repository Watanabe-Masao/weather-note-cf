// 近づいている台風 (#220): the typhoons JMA has now (/api/typhoon, worker/src/typhoon.ts), read when
// the app opens and again every 30 minutes while it stays open (the Worker shares one reading for 30
// minutes). "No typhoon" and "could not read" are kept apart (2026-11-16 review): a failure keeps the
// last good reading as 古い, or says it could not read — it never reads as "no typhoon".

import { useEffect, useState } from "react";
import type { TyphoonNow } from "../../shared/typhoonForecast";
import { fetchJson } from "./fetchJson";

const EVERY_MS = 30 * 60_000;
/** A reading older than this is 古い (two readings missed). */
export const TYPHOON_STALE_MS = 90 * 60_000;

export interface TyphoonInfo {
  /** loading: not read yet · ok: read · stale: the last good reading, newer ones failed · failed: none read. */
  state: "loading" | "ok" | "stale" | "failed";
  typhoons: TyphoonNow[];
  /** When the shown reading was made (ISO), when there is one. */
  at: string | null;
}

export function useActiveTyphoons(): TyphoonInfo {
  const [info, setInfo] = useState<TyphoonInfo>({ state: "loading", typhoons: [], at: null });
  useEffect(() => {
    let live = true;
    const failed = () => live && setInfo((p) => (p.at ? { ...p, state: "stale" } : { state: "failed", typhoons: [], at: null }));
    const read = () =>
      fetchJson<{ typhoons?: TyphoonNow[]; ok?: boolean; fetchedAt?: string }>("/api/typhoon")
        .then((r) => {
          if (!live) return;
          if (r.ok === false || !Array.isArray(r.typhoons)) return failed();
          const at = r.fetchedAt ?? new Date().toISOString();
          setInfo({ state: Date.now() - Date.parse(at) > TYPHOON_STALE_MS ? "stale" : "ok", typhoons: r.typhoons, at });
        })
        .catch(failed);
    read();
    const t = setInterval(read, EVERY_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return info;
}

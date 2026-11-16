// 近づいている台風 (#220): the typhoons JMA has now (/api/typhoon, worker/src/typhoon.ts), read when
// the app opens and again every 30 minutes while it stays open (the Worker shares one reading for 30
// minutes). A failure is no typhoon: the card simply does not show.

import { useEffect, useState } from "react";
import type { TyphoonNow } from "../../shared/typhoonForecast";
import { fetchJson } from "./fetchJson";

const EVERY_MS = 30 * 60_000;

export function useActiveTyphoons(): TyphoonNow[] {
  const [list, setList] = useState<TyphoonNow[]>([]);
  useEffect(() => {
    let live = true;
    const read = () =>
      fetchJson<{ typhoons?: TyphoonNow[] }>("/api/typhoon")
        .then((r) => live && setList(Array.isArray(r.typhoons) ? r.typhoons : []))
        .catch(() => {});
    read();
    const t = setInterval(read, EVERY_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return list;
}

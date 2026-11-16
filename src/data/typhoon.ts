// 台風の進路 (#220): the compact copy of JMA's best track (public/data/typhoon-tracks.json, built by
// scripts/typhoon-tracks.ts), read once when something asks for it and kept for the session. A
// missing or broken file is no typhoon to show, never an error on the screen: the month review
// simply leaves 台風 out.

import { useEffect, useState } from "react";
import { expandTracks, type CompactTracks, type Storm } from "../../shared/typhoon";

export const TYPHOON_TRACKS_URL = "/data/typhoon-tracks.json";

let loading: Promise<Storm[] | null> | null = null;

export function loadTyphoonTracks(): Promise<Storm[] | null> {
  loading ??= fetch(TYPHOON_TRACKS_URL)
    .then((r) => (r.ok ? (r.json() as Promise<CompactTracks>) : null))
    .then((c) => (c?.v === 1 ? expandTracks(c) : null))
    .catch(() => null);
  return loading;
}

/** The storms, once read (null while reading, or when there is no copy). */
export function useTyphoonTracks(): Storm[] | null {
  const [storms, setStorms] = useState<Storm[] | null>(null);
  useEffect(() => {
    let live = true;
    loadTyphoonTracks().then((s) => live && setStorms(s));
    return () => {
      live = false;
    };
  }, []);
  return storms;
}

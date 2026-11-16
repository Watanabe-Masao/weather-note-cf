// 台風の進路 (#220): the compact copy of JMA's best track (public/data/typhoon-tracks.json, built by
// scripts/typhoon-tracks.ts), read once when something asks for it and kept for the session. A
// missing or broken file is no typhoon to show, never an error on the screen: the month review
// simply leaves 台風 out.

import { useEffect, useState } from "react";
import { expandTracks, tracksEnd, type CompactTracks, type Storm } from "../../shared/typhoon";
import { nextDay, type RecentTracks, typhoonRecord, type TyphoonRecord } from "../../shared/typhoonRecent";

export const TYPHOON_TRACKS_URL = "/data/typhoon-tracks.json";

let loading: Promise<Storm[] | null> | null = null;

export function loadTyphoonTracks(): Promise<Storm[] | null> {
  loading ??= fetch(TYPHOON_TRACKS_URL)
    .then((r) => (r.ok ? (r.json() as Promise<CompactTracks>) : null))
    .then((c) => (c?.v === 1 ? expandTracks(c) : null))
    .catch(() => null);
  return loading;
}

/**
 * The best track and, after its last day, the typhoons of JMA's telegrams kept since 2026-11
 * (/api/typhoon-recent, shared/typhoonRecent.ts), with the days each covers. The telegrams not read
 * leave those days "not known yet", as before.
 */
let loadingRecord: Promise<TyphoonRecord | null> | null = null;
export function loadTyphoonRecord(): Promise<TyphoonRecord | null> {
  loadingRecord ??= loadTyphoonTracks().then(async (best) => {
    if (!best) return null;
    const end = tracksEnd(best);
    const recent = end
      ? await fetch(`/api/typhoon-recent?from=${nextDay(end)}`)
          .then((r) => (r.ok ? (r.json() as Promise<RecentTracks>) : null))
          .catch(() => null)
      : null;
    return typhoonRecord(best, recent);
  });
  return loadingRecord;
}

/** The record once read; "loading" while reading, "none" when the best track could not be read. */
export function useTyphoonRecord(): TyphoonRecord | "loading" | "none" {
  const [rec, setRec] = useState<TyphoonRecord | "loading" | "none">("loading");
  useEffect(() => {
    let live = true;
    loadTyphoonRecord().then((r) => live && setRec(r ?? "none"));
    return () => {
      live = false;
    };
  }, []);
  return rec;
}

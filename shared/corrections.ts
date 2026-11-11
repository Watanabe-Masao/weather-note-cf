// Corrections ledger: when JMA corrects published (fixed) values, list the affected period here.
// Both copies follow it: the Worker puts the revision into its edge cache keys (so old edge copies
// are no longer served), and the app treats stored fixed data in the period as needing a re-fetch.
// Only the listed period is fetched again; everything else stays cached.

export interface Correction {
  /** Increasing number; never reuse or change one once released. */
  id: number;
  /** First and last affected day (inclusive). */
  from: string;
  to: string;
  /** Affected stations (block numbers); omitted = all stations. */
  stations?: string[];
  /** What was corrected, for the record. */
  note: string;
}

export const CORRECTIONS: Correction[] = [];

/** The latest correction touching `station` between `from` and `to`, or 0. */
export function correctionRev(station: string, from: string, to: string, list: Correction[] = CORRECTIONS): number {
  let rev = 0;
  for (const c of list) {
    if (c.to < from || c.from > to) continue;
    if (c.stations && !c.stations.includes(station)) continue;
    rev = Math.max(rev, c.id);
  }
  return rev;
}

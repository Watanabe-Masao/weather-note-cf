// 正本管理: which copy of a day's weather the app keeps when a new one arrives.
//
// Sources, from most to least authoritative:
//   気象庁の確定値 (jma-fixed) ＞ 気象庁の暫定値 (jma) ＞ AMeDAS 速報 (amedas) ＞ 予報 (forecast)
//
// A new copy does not win on its source alone. The decision also looks at when it was requested
// (an answer to an older request never replaces a newer one), how complete it is (a page that came
// back half-empty never replaces a full one) and whether it is a correction (the same source with
// the values changed replaces the old values, even when they were fixed). Gaps are filled from a
// lower source field by field, and each filled field keeps its own source in `origin`, so a day can
// mix measured temperatures with a forecast radiation without losing where each came from.
//
// Pure functions: no storage, no network. The store calls `decide*` for every write.

import type { WeatherRow } from "../../shared/types";
import type { DayRecord, HourRecord } from "./db";

export type Origin = "jma-fixed" | "jma" | "amedas" | "forecast";

export const RANK: Record<Origin, number> = { "jma-fixed": 4, jma: 3, amedas: 2, forecast: 1 };

/**
 * What a forecast may lend to a measured row: only values the measuring source does not have at
 * all (AMeDAS has no solar radiation; 日なた温度 needs it). A forecast never stands in for a
 * measured value that is merely missing: that gap stays a gap.
 */
const FORECAST_LENDS = new Set(["solar"]);

/** Row keys that describe the row rather than hold a weather value. */
const META = new Set(["date", "n", "type", "provider", "raw", "quality", "unpublished", "provisional", "origin", "solarSource", "confidence", "spread"]);

/** Where a day record as a whole came from. */
export function dayOrigin(r: Pick<DayRecord, "kind" | "source">): Origin {
  if (r.source === "forecast") return "forecast";
  if (r.source === "recent") return "amedas";
  return r.kind === "fixed" ? "jma-fixed" : "jma";
}

/** Where one hourly row came from (the record tells JMA tables from AMeDAS observations). */
export function hourOrigin(row: WeatherRow, rec: Pick<HourRecord, "kind" | "source">): Origin {
  if (row.type === "forecast") return "forecast";
  if (rec.source === "jma") return rec.kind === "fixed" ? "jma-fixed" : "jma";
  return "amedas";
}

/** A field without a value: empty, or still unpublished by its own source and not filled from another. */
const missing = (row: WeatherRow, k: string) =>
  row[k] == null || row[k] === "" || ((row.unpublished ?? []).includes(k) && !(row.origin as Record<string, Origin> | undefined)?.[k]);

/** Value fields of a row (not its description). */
export function valueFields(row: WeatherRow): string[] {
  return Object.keys(row).filter((k) => !META.has(k));
}

/** How many value fields hold a value: a copy with fewer is less complete. */
export function completeness(row: WeatherRow | null): number {
  if (!row) return 0;
  return valueFields(row).filter((k) => !missing(row, k)).length;
}

/** The source of one field of a row whose own source is `own`. */
export function fieldOrigin(row: WeatherRow, field: string, own: Origin): Origin {
  const o = row.origin as Record<string, Origin> | undefined;
  return o?.[field] ?? own;
}

/**
 * `base` with its missing fields filled from `fill` (a lower source). Each filled field records
 * its source in `origin`. Fields `base` has are never touched.
 */
export function fillFrom(base: WeatherRow, baseOrigin: Origin, fill: WeatherRow | null, fillOrigin: Origin): WeatherRow {
  if (!fill) return base;
  let out: WeatherRow | null = null;
  const measured = base.type === "actual";
  for (const k of valueFields(fill)) {
    if (missing(fill, k) || !missing(base, k)) continue;
    if (fillOrigin === "forecast" && measured && (!FORECAST_LENDS.has(k) || base[k] != null || (base.unpublished ?? []).includes(k))) continue;
    out ??= { ...base, raw: { ...base.raw }, quality: { ...base.quality }, origin: { ...((base.origin as object) ?? {}) } };
    out[k] = fill[k];
    if (fill.raw?.[k] !== undefined) out.raw[k] = fill.raw[k];
    if (fill.quality?.[k]) out.quality[k] = fill.quality[k];
    (out.origin as Record<string, Origin>)[k] = fieldOrigin(fill, k, fillOrigin);
  }
  void baseOrigin;
  return out ?? base;
}

export type Verdict =
  /** Take the new copy (gaps filled from the old one). */
  | "replace"
  /** Keep the old copy (gaps filled from the new one). */
  | "keep";

/**
 * The rule, for one day (or one hour). `fetched` is when each copy was requested (ms; 0 if unknown).
 *  - A higher source replaces a lower one.
 *  - The same source replaces when it was requested no earlier and is no less complete: that is an
 *    update, or, for fixed data, an official correction.
 *  - Otherwise the old copy stays, and only its gaps are filled from the new one.
 */
export function verdict(
  old: { origin: Origin; row: WeatherRow | null; fetched: number },
  next: { origin: Origin; row: WeatherRow | null; fetched: number },
): Verdict {
  if (!old.row) return "replace";
  if (!next.row) return "keep"; // "no row" never erases a row
  const a = RANK[old.origin];
  const b = RANK[next.origin];
  if (b > a) return "replace";
  if (b < a) return "keep";
  if (next.fetched < old.fetched) return "keep"; // answer to an older request
  return completeness(next.row) >= completeness(old.row) ? "replace" : "keep";
}

const corrected = (old: { rev?: number }, next: { rev?: number }) => (next.rev ?? 0) > (old.rev ?? 0);

/** The day record to keep when `next` arrives while `old` is held. */
export function decideDay(old: DayRecord | undefined, next: DayRecord): DayRecord {
  if (!old) return next;
  // A correction listed in the ledger after `old` was saved: JMA's new copy is the authority, even
  // if it now has fewer values (a value withdrawn is also a correction).
  if (corrected(old, next) && next.source === "jma") return next;
  const o = { origin: dayOrigin(old), row: old.row, fetched: old.fetchedAt ?? 0 };
  const n = { origin: dayOrigin(next), row: next.row, fetched: next.fetchedAt ?? 0 };
  if (verdict(o, n) === "replace") {
    // A lower source never lends fields to a fixed copy: fixed means JMA has every value.
    const row = next.row && next.kind !== "fixed" ? fillFrom(next.row, n.origin, old.row, o.origin) : next.row;
    return { ...next, row };
  }
  if (!old.row || !next.row || old.kind === "fixed") return old;
  const row = fillFrom(old.row, o.origin, next.row, n.origin);
  return row === old.row ? old : { ...old, row };
}

/** The hour record to keep: decided hour by hour, so observed hours and forecast hours can meet. */
export function decideHours(old: HourRecord | undefined, next: HourRecord): HourRecord {
  if (!old) return next;
  if (corrected(old, next) && next.source === "jma") return next;
  // Whole-record rule for JMA tables: a fixed day is replaced only by a complete fixed copy (a
  // correction), never by a partial or older one.
  if (old.kind === "fixed") {
    const replace = next.kind === "fixed" && (next.fetchedAt ?? 0) >= (old.fetchedAt ?? 0) && next.rows.length >= old.rows.length;
    return replace ? next : old;
  }
  const byHour = new Map<number, { row: WeatherRow; origin: Origin; fetched: number }>();
  for (const row of old.rows) byHour.set(row.n, { row, origin: hourOrigin(row, old), fetched: old.fetchedAt ?? 0 });
  let changed = false;
  for (const row of next.rows) {
    const cand = { row, origin: hourOrigin(row, next), fetched: next.fetchedAt ?? 0 };
    const held = byHour.get(row.n);
    if (!held) {
      byHour.set(row.n, cand);
      changed = true;
      continue;
    }
    if (verdict(held, cand) === "replace") {
      byHour.set(row.n, { ...cand, row: fillFrom(row, cand.origin, held.row, held.origin) });
      changed = true;
    } else {
      const filled = fillFrom(held.row, held.origin, row, cand.origin);
      if (filled !== held.row) {
        byHour.set(row.n, { ...held, row: filled });
        changed = true;
      }
    }
  }
  if (!changed && next.kind === old.kind) return old;
  const rows = [...byHour.values()].map((h) => h.row).sort((a, b) => a.n - b.n);
  // The record's own source: the best source among its rows.
  const best = Math.max(...[...byHour.values()].map((h) => RANK[h.origin]));
  const source: HourRecord["source"] = best >= RANK.jma ? "jma" : best === RANK.amedas ? "current" : "forecast";
  const kind = source === "jma" && next.kind === "fixed" ? "fixed" : "variable";
  return { ...next, rows, source, kind, fetchedAt: Math.max(old.fetchedAt ?? 0, next.fetchedAt ?? 0) };
}

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

import { hasAllHours } from "../../shared/fixed";
import type { WeatherRow } from "../../shared/types";
import type { DayRecord, HourRecord } from "./db";

export type Origin = "jma-fixed" | "jma" | "amedas" | "forecast";

export const RANK: Record<Origin, number> = { "jma-fixed": 4, jma: 3, amedas: 2, forecast: 1 };

/**
 * What a forecast may lend to a measured row: only values the measuring source does not have at
 * all (AMeDAS has no solar radiation; 肌感（日なた） needs it). A forecast never stands in for a
 * measured value that is merely missing: that gap stays a gap. The forecast's weather for an
 * observed hour is kept too (AMeDAS reports none), marked as the forecast's, so a report can set
 * what was forecast beside what the person saw.
 */
const FORECAST_LENDS = new Set(["solar", "weather", "weatherCode"]); // AMeDAS has no radiation and no weather text

/** Row keys that describe the row rather than hold a weather value. */
const META = new Set(["date", "n", "type", "provider", "raw", "quality", "unpublished", "provisional", "origin", "from", "solarSource", "confidence", "spread"]);

/** Where a day record as a whole came from. */
export function dayOrigin(r: Pick<DayRecord, "kind" | "source">): Origin {
  if (r.source === "forecast") return "forecast";
  if (r.source === "recent") return "amedas";
  return r.kind === "fixed" ? "jma-fixed" : "jma";
}

/**
 * Where one hourly row came from. Each saved row carries its own source (`from`), because a day's
 * hours can mix observations and forecast; the record's source is only a summary. Rows saved
 * before `from` existed fall back to the row type and the record.
 */
export function hourOrigin(row: WeatherRow, rec: Pick<HourRecord, "kind" | "source">): Origin {
  if (typeof row.from === "string" && row.from in RANK) return row.from as Origin;
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

/**
 * A correction is applied only from a whole JMA page. Empty values on a whole page are what JMA
 * now publishes (a withdrawn value is a correction too); a page with a missing row or hour is a
 * broken fetch and never replaces anything, whatever the ledger says.
 */
const wholeDay = (r: DayRecord) => r.source === "jma" && !!r.row && r.row.date === r.date;
const wholeHours = (r: HourRecord) => r.source === "jma" && hasAllHours(r.date, r.rows);

/** Every row records its own source, so it survives saving and reading back. */
function stamp(rec: HourRecord): HourRecord {
  if (rec.rows.every((r) => typeof r.from === "string")) return rec;
  return { ...rec, rows: rec.rows.map((r) => (typeof r.from === "string" ? r : { ...r, from: hourOrigin(r, rec) })) };
}

/** The day record to keep when `next` arrives while `old` is held. */
export function decideDay(old: DayRecord | undefined, next: DayRecord): DayRecord {
  if (!old) return next;
  // A correction listed in the ledger after `old` was saved: JMA's new copy is the authority, even
  // if it now has fewer values (a value withdrawn is also a correction) — but only from a whole page.
  if (corrected(old, next)) return wholeDay(next) ? next : old;
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
  if (!old) return stamp(next);
  if (corrected(old, next)) return wholeHours(next) ? stamp(next) : old;
  // Whole-record rule for JMA tables: a fixed day is replaced only by a newer whole fixed copy (a
  // correction), never by a partial or older one.
  if (old.kind === "fixed") {
    const replace = next.kind === "fixed" && wholeHours(next) && (next.fetchedAt ?? 0) >= (old.fetchedAt ?? 0);
    return replace ? stamp(next) : old;
  }
  const byHour = new Map<number, { row: WeatherRow; origin: Origin; fetched: number }>();
  // Only rows that belong here (this day, hours 1–24) take part: a stray row from a broken page
  // saved earlier never survives a merge.
  const belongs = (r: WeatherRow) => r.date === next.date && Number.isInteger(r.n) && r.n >= 1 && r.n <= 24;
  let changed = old.rows.some((r) => !belongs(r));
  for (const row of old.rows) if (belongs(row)) byHour.set(row.n, { row, origin: hourOrigin(row, old), fetched: old.fetchedAt ?? 0 });
  for (const row of next.rows) {
    if (!belongs(row)) continue;
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
  const rows = [...byHour.values()].map((h) => (h.row.from === h.origin ? h.row : { ...h.row, from: h.origin })).sort((a, b) => a.n - b.n);
  // The record's source is a summary (the best among its rows); each row keeps its own in `from`.
  const best = Math.max(...[...byHour.values()].map((h) => RANK[h.origin]));
  const source: HourRecord["source"] = best >= RANK.jma ? "jma" : best === RANK.amedas ? "current" : "forecast";
  const kind = source === "jma" && next.kind === "fixed" ? "fixed" : "variable";
  return { ...next, rows, source, kind, fetchedAt: Math.max(old.fetchedAt ?? 0, next.fetchedAt ?? 0) };
}

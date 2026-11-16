// 当時の発表で埋める (#220): JMA adds a season's typhoons to the best track some months after, so a
// recent typhoon day was "not known yet". The telegrams kept since 2026-11 (worker/src/typhoonArchive.ts)
// carry JMA's analysis of each typhoon at the time (実況・推定: the centre, the 暴風域 and the 強風域), so
// the days after the best track's last one are read from them, the same way (shared/typhoon.ts:
// hour by hour, JMA's circle). What is known, and from which source, is kept as date ranges: a day in
// no range stays "not known yet" (engineering-principles §2), and the best track replaces the
// telegrams for a typhoon once it has it.
// 出典：気象庁（ベストトラック／防災情報XML）。強風域・暴風域に入ったかは Weather Note の判定。

import {
  type CompactPoint,
  type CompactStorm,
  destination,
  distanceBearing,
  expandTracks,
  type Radius,
  type Storm,
  tracksEnd,
} from "./typhoon";
import type { XmlCircle, XmlTelegram } from "./typhoonXml";

/** A stretch of days (JST, both included) whose typhoons are known, and from which source. */
export interface KnownRange {
  from: string;
  to: string;
  source: "best" | "xml";
}
export interface TyphoonRecord {
  storms: Storm[];
  ranges: KnownRange[];
}

/** What /api/typhoon-recent gives: the storms read from the kept telegrams, and the days they cover. */
export interface RecentTracks {
  v: 1;
  source: string;
  /** JST dates; null when nothing is kept yet. */
  from: string | null;
  to: string | null;
  storms: CompactStorm[];
}

const H = 3_600_000;
export const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 24 * H).toISOString().slice(0, 10);
export const prevDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - 24 * H).toISOString().slice(0, 10);

/**
 * A telegram's area as the best track gives one: the longest and the shortest radius from the
 * typhoon's centre and the bearing of the longest. The telegram gives the circle JMA draws — its own
 * point (BasePoint, which may be off the centre) and radius (or two, with a bearing, around it).
 * The circle is found first; then, around the centre, longest = R + d and shortest = R − d toward its
 * point (d the circle's point off the centre), which shared/typhoon.ts `inside` draws back exactly.
 */
export function radiusAroundCentre(
  c: XmlCircle | null,
  lat: number,
  lon: number,
): Radius | null {
  if (!c || !(c.radius.long > 0)) return null;
  const r = c.radius;
  const at =
    r.dir == null || r.long === r.short
      ? { lat: c.lat, lon: c.lon }
      : destination(c.lat, c.lon, r.dir, (r.long - r.short) / 2);
  const R = (r.long + r.short) / 2;
  const { km: d, bearing } = distanceBearing(lat, lon, at.lat, at.lon);
  if (d < 1) return { long: R, short: R, dir: null };
  return { long: R + d, short: R - d, dir: Math.round(bearing) };
}

/** JMA's 階級 as the best track's grade (6 = an extratropical low, no typhoon). */
function gradeOf(cls: string | null): number {
  if (!cls) return 9;
  if (/温帯/.test(cls)) return 6;
  if (/\(TY\)/.test(cls)) return 5;
  if (/\(STS\)/.test(cls)) return 4;
  if (/\(TS\)/.test(cls)) return 3;
  if (/\(TD\)|熱帯低気圧/.test(cls)) return 2;
  return 9;
}

const pack = (r: Radius | null) =>
  r ? [Math.round(r.long), Math.round(r.short), r.dir ?? -1] : [];

/**
 * The storms in the kept telegrams, as the compact track (shared/typhoon.ts): each typhoon's analyses
 * (実況, and 推定 — JMA's estimate of where it is now between two analyses), one per time, the latest
 * issued winning (a correction is issued later).
 */
export function stormsOfTelegrams(telegrams: XmlTelegram[]): CompactStorm[] {
  const by = new Map<
    string,
    { name: string; at: Map<number, { issued: number; p: CompactPoint }> }
  >();
  for (const t of telegrams) {
    if (!t.number || !/^\d{4}$/.test(t.number)) continue;
    const issued = Date.parse(t.issuedAt);
    const s = by.get(t.number) ?? { name: t.name ?? "", at: new Map() };
    by.set(t.number, s);
    if (t.name) s.name = t.name;
    for (const x of t.times) {
      if (!/^(実況|推定)/.test(x.part) || x.lat == null || x.lon == null)
        continue;
      const time = Date.parse(x.validAt);
      if (!Number.isFinite(time)) continue;
      const had = s.at.get(time);
      if (had && had.issued > issued) continue;
      const p: CompactPoint = [
        Math.round(time / H),
        gradeOf(x.typhoonClass),
        Math.round(x.lat * 10),
        Math.round(x.lon * 10),
        x.pressure ?? 0,
        pack(radiusAroundCentre(x.gale, x.lat, x.lon)),
        pack(radiusAroundCentre(x.storm, x.lat, x.lon)),
      ];
      s.at.set(time, { issued, p });
    }
  }
  return [...by]
    .filter(([, s]) => s.at.size)
    .map(([n, s]) => ({
      y: 2000 + Number(n.slice(0, 2)),
      n: Number(n.slice(2)),
      name: s.name,
      p: [...s.at.values()].map((v) => v.p).sort((a, b) => a[0] - b[0]),
    }));
}

/**
 * The best track and the telegrams together. The best track is known up to its last day; the
 * telegrams from the day after that (or from where they begin, if later) to where they reach. A
 * typhoon the best track has is taken from it alone.
 */
export function typhoonRecord(
  best: Storm[],
  recent: RecentTracks | null,
): TyphoonRecord {
  const ranges: KnownRange[] = [];
  const end = tracksEnd(best);
  if (end) ranges.push({ from: "0000-01-01", to: end, source: "best" });
  let storms = best;
  if (recent?.v === 1 && recent.from && recent.to) {
    const from = end && nextDay(end) > recent.from ? nextDay(end) : recent.from;
    if (from <= recent.to) ranges.push({ from, to: recent.to, source: "xml" });
    const have = new Set(best.map((s) => `${s.year}-${s.number}`));
    storms = [
      ...best,
      ...expandTracks({
        v: 1,
        source: recent.source,
        built: "",
        storms: recent.storms,
      }).filter((s) => !have.has(`${s.year}-${s.number}`)),
    ];
  }
  return { storms, ranges };
}

export const knownOn = (r: TyphoonRecord, d: string) =>
  r.ranges.some((x) => d >= x.from && d <= x.to);

/** The stretches of [from, to] not known (JST dates, both included), in order. */
export function unknownStretches(
  r: TyphoonRecord,
  from: string,
  to: string,
): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let at = from;
  const sorted = [...r.ranges].sort((a, b) => a.from.localeCompare(b.from));
  for (const x of sorted) {
    if (x.to < at) continue;
    if (x.from > to) break;
    if (x.from > at)
      out.push({ from: at, to: prevDay(x.from) < to ? prevDay(x.from) : to });
    at = nextDay(x.to);
    if (at > to) return out;
  }
  if (at <= to) out.push({ from: at, to });
  return out;
}

/** Whether any day of [from, to] is read from the telegrams (the source to name). */
export const usesTelegrams = (r: TyphoonRecord, from: string, to: string) =>
  r.ranges.some((x) => x.source === "xml" && x.from <= to && x.to >= from);

// 当時の発表で埋める (#220): the typhoons in the telegrams kept (typhoonArchive.ts) as a compact track,
// for the days the best track does not reach yet (shared/typhoonRecent.ts), and the days they cover:
// from 7 days before the first run that read (the long feed reaches 7 days back) to the day before the
// last run that read; a stop of the collector longer than the long feed's 7 days starts it again after
// it (the telegrams of that stop are lost). 出典：気象庁（防災情報XML）。

import {
  nextDay,
  prevDay,
  stormsOfTelegrams,
  type RecentTracks,
} from "../../shared/typhoonRecent";
import type { XmlTelegram } from "../../shared/typhoonXml";
import type { Db } from "./accounts";
import { COLLECTOR_STOP_MS, ensureWatchSchema } from "./typhoonWatch";

const DAY = 86_400_000;
const FEED_LONG_MS = 7 * DAY;
const jstDay = (t: number) =>
  new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

/** The days the kept telegrams cover, or null when nothing has been read yet. */
export async function recentCoverage(
  db: Db,
): Promise<{ from: string; to: string } | null> {
  await ensureWatchSchema(db);
  const runs = await db
    .prepare(
      "SELECT MIN(at) AS first, MAX(at) AS last FROM typhoon_fetch_log WHERE ok = 1",
    )
    .first<{ first: string | null; last: string | null }>();
  if (!runs?.first || !runs.last) return null;
  let from = nextDay(jstDay(Date.parse(runs.first) - FEED_LONG_MS));
  // A stop longer than the long feed reaches: the days before its end are not all kept.
  const stops = (
    await db
      .prepare(
        "SELECT opened_at, closed_at FROM typhoon_alerts WHERE kind = 'collector' AND closed_at IS NOT NULL",
      )
      .all<{ opened_at: string; closed_at: string }>()
  ).results;
  for (const s of stops) {
    const began = Date.parse(s.opened_at) - COLLECTOR_STOP_MS;
    const ended = Date.parse(s.closed_at);
    if (ended - began > FEED_LONG_MS) {
      const after = nextDay(jstDay(ended - FEED_LONG_MS));
      if (after > from) from = after;
    }
  }
  const to = prevDay(jstDay(Date.parse(runs.last)));
  return from <= to ? { from, to } : null;
}

/** The storms of the telegrams from `since` (JST date; clamped to what is kept), and the days covered. */
export async function recentTracks(
  db: Db,
  since: string,
): Promise<RecentTracks> {
  const cover = await recentCoverage(db);
  const empty: RecentTracks = {
    v: 1,
    source: "気象庁 防災情報XML（台風解析・予報情報）",
    from: null,
    to: null,
    storms: [],
  };
  if (!cover) return empty;
  const from = since > cover.from ? since : cover.from;
  if (from > cover.to) return { ...empty, from, to: cover.to };
  // A typhoon that began before `from` is read whole (its hours before are needed to draw the first day).
  const rows = (
    await db
      .prepare(
        "SELECT parsed FROM typhoon_telegrams WHERE parsed IS NOT NULL AND number IN (SELECT DISTINCT number FROM typhoon_telegrams WHERE issued_at >= ? AND issued_at <= ?) ORDER BY issued_at",
      )
      .bind(
        `${prevDay(from)}T00:00:00+09:00`,
        `${nextDay(cover.to)}T23:59:59+09:00`,
      )
      .all<{ parsed: string }>()
  ).results;
  const telegrams = rows.map((r) => JSON.parse(r.parsed) as XmlTelegram);
  return { ...empty, from, to: cover.to, storms: stormsOfTelegrams(telegrams) };
}

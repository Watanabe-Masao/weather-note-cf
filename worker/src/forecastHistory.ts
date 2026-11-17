// 予報の履歴 (#250, R6): one day's issues and values for 「この日の予報の移り変わり」, read from D1.
// Read-only: the issues of the station's office from 8 days before the day to its end, their values
// for the day at the station's places, and the fetch log of those days (to tell 取れなかった from 記録なし, R5-1).

import { addDays } from "../../shared/dates";
import {
  type ForecastHistoryResponse,
  HISTORY_DAYS_BEFORE,
  HISTORY_ELEMENTS,
  HISTORY_PLACES,
  type HistoryEntry,
  type HistoryFetchLog,
  type HistoryIssue,
} from "../../shared/forecastHistory";
import type { Db } from "./accounts";

const jst = (day: string) => `${day}T00:00:00+09:00`;

export async function forecastHistory(db: Db, station: string, date: string): Promise<ForecastHistoryResponse> {
  const places = HISTORY_PLACES[station];
  if (!places) return { v: 1, station, date, supported: false };
  const from = jst(addDays(date, -HISTORY_DAYS_BEFORE));
  const to = jst(addDays(date, 1));
  const kinds = JSON.stringify(["VPFD51", "VPFW50"]);
  try {
    const issues = (
      await db
        .prepare(
          `SELECT issue_id, source, office, kind, issued_at, info_type, revision_of, preferred, parser, entries, problems
           FROM forecast_issues
           WHERE office = ? AND kind IN (SELECT value FROM json_each(?)) AND issued_at >= ? AND issued_at < ?
           ORDER BY issued_at, kind, issue_id`,
        )
        .bind(places.office, kinds, from, to)
        .all<HistoryIssue>()
    ).results;
    const entries = (
      await db
        .prepare(
          `SELECT e.issue_id, e.place, e.place_name, e.place_type, e.element, e.valid_from, e.valid_to, e.period, e.label, e.value, e.unit, e.lower, e.upper, e.jma_type, e.condition
           FROM forecast_entries e JOIN forecast_issues i ON i.issue_id = e.issue_id
           WHERE i.office = ? AND i.kind IN (SELECT value FROM json_each(?)) AND i.issued_at >= ? AND i.issued_at < ?
             AND e.place IN (SELECT value FROM json_each(?)) AND e.element IN (SELECT value FROM json_each(?))
             AND e.valid_from >= ? AND e.valid_from < ?
           ORDER BY e.issue_id, e.element, e.valid_from`,
        )
        .bind(
          places.office,
          kinds,
          from,
          to,
          JSON.stringify([places.office, places.area, places.point]),
          JSON.stringify(HISTORY_ELEMENTS),
          jst(date),
          to,
        )
        .all<HistoryEntry>()
    ).results;
    // The log is in UTC: from an hour before the first issue time to the end of the day.
    const logFrom = new Date(Date.parse(from) - 3_600_000).toISOString();
    const logTo = new Date(Date.parse(to)).toISOString();
    const fetchLog = (
      await db
        .prepare("SELECT at, feed, ok, entries, wanted, added, left_over, error FROM forecast_fetch_log WHERE at >= ? AND at < ? ORDER BY at")
        .bind(logFrom, logTo)
        .all<HistoryFetchLog>()
    ).results;
    return { v: 1, station, date, supported: true, places, issues, entries, fetchLog };
  } catch (e) {
    // The tables are made by the scheduled run; before its first run there is nothing kept yet.
    if (/no such table/i.test(String(e))) return { v: 1, station, date, supported: true, places, issues: [], entries: [], fetchLog: [] };
    throw e;
  }
}

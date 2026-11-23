// その発表の週間天気予報（11/19）の日ごとの値：画面（IssueWeek.tsx）から分けて、テストで確かめられるように。
import type { ForecastIssueResponse } from "../../../shared/forecastHistory";
import { ForecastHistory as Model, type DayValues, type IssueRow, jstDate } from "../../../shared/forecastHistoryModel";

export type DayRow = { day: string; from: IssueRow; v: DayValues };

/** 発表の先の日ごとの値。府県のあとに、週間で府県より先の日を足す。 */
export function issueDays(r: Extract<ForecastIssueResponse, { found: true }>): DayRow[] {
  const m = new Model({ issues: [r.issue, ...(r.weekly ? [r.weekly] : [])], entries: r.entries, fetchLog: [] });
  const daysOf = (i: IssueRow) => [...new Set(r.entries.filter((e) => e.issue_id === i.issue_id && e.element !== "temp").map((e) => jstDate(e.valid_from)))].sort().filter((d) => d >= jstDate(i.issued_at));
  const out: DayRow[] = [];
  for (const day of daysOf(r.issue)) {
    const v = m.valuesFor(r.issue, day);
    if (v) out.push({ day, from: r.issue, v });
  }
  if (r.weekly) {
    const last = out.at(-1)?.day ?? "";
    for (const day of daysOf(r.weekly).filter((d) => d > last)) {
      const v = m.valuesFor(r.weekly, day);
      if (v) out.push({ day, from: r.weekly, v });
    }
  }
  return out;
}


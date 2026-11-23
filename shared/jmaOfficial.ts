// 予報の出典（2026-11-23 渡辺さん「基本的には気象庁のデータを使用したい。Open-Meteo はあくまでも補完」「その一つ一つ
// データの出典が分かるように」）：今日から先の日ごとの値（天気・最高・最低・降水確率・信頼度）を、気象庁のいちばん
// 新しい発表から読む。値ごとに、どの発表の値かを付ける。
//
// 決まり：
//  - 値ごとに、その値を出している発表のうち、いちばん新しいもの（同じ時刻なら府県天気予報）。発表が「値なし」
//    （週間の翌日分など、府県天気予報に任せた印）や項目なしのときは、その前の発表に戻って探す。
//  - 取り消された発表、優先でない写し（外部の記録）、今より先の発表は使わない。
//  - 値は気象庁のまま（整数、幅も気象庁の幅）。調整も、Open-Meteo との混ぜ合わせもしない。
//  - 気象庁のどの発表にも無い値は null：画面はそこを Open-Meteo で埋め、出典もそう書く（ここでは埋めない）。

import type { HistoryEntry, HistoryIssue } from "./forecastHistory";
import { addDays, ForecastHistory, type DayValues, type Kind, type V } from "./forecastHistoryModel";

/** 気象庁の値の出どころ：どの発表の、どの地点・区域の値か。 */
export interface OfficialSource {
  kind: Kind;
  issuedAt: string; // JST, "+09:00"
  issueId: string;
  place: string;
  placeName: string;
}

export interface Official<T> {
  v: T;
  lower?: number | null;
  upper?: number | null;
  from: OfficialSource;
}

export interface OfficialDay {
  date: string;
  /** 天気予報用テロップ番号と、その言葉。`partial`：府県天気予報の当日分が途中から（「11時から」）。 */
  weather: Official<{ code: string; label: string | null; partial: string | null }> | null;
  max: Official<number> | null;
  min: Official<number> | null;
  /** 週間天気予報の日降水確率。 */
  popDay: Official<number> | null;
  /** 府県天気予報の6時間降水確率（00・06・12・18時から）。区切りごとに出どころが違うことがある。 */
  pop6: (Official<number> | null)[];
  /** 週間天気予報の信頼度（A・B・C）。 */
  reliability: Official<string> | null;
}

/** 日ごとの値を読むのに要る要素（/api/forecast-official が送るもの）。 */
export const OFFICIAL_ELEMENTS = ["weather_code", "pop", "temp_max", "temp_min", "reliability"];

/** 今日から何日先まで（気象庁の週間天気予報は 7日先まで）。 */
export const OFFICIAL_DAYS = 7;

const sourceOf = (issue: HistoryIssue, e: HistoryEntry): OfficialSource => ({
  kind: issue.kind as Kind,
  issuedAt: issue.issued_at,
  issueId: issue.issue_id,
  place: e.place,
  placeName: e.place_name,
});

/** 使ってよい発表：今より前、取り消されていない、優先の写し。新しい順（同じ時刻なら府県天気予報が先）。 */
export function usableIssues(issues: HistoryIssue[], now: string): HistoryIssue[] {
  const cancelled = new Set(issues.filter((i) => i.info_type === "取消").map((i) => `${i.kind}|${i.issued_at}`));
  return issues
    .filter((i) => (i.kind === "VPFD51" || i.kind === "VPFW50") && i.preferred === 1 && i.info_type !== "取消")
    .filter((i) => !cancelled.has(`${i.kind}|${i.issued_at}`) && Date.parse(i.issued_at) <= Date.parse(now))
    .sort((a, b) => (a.issued_at === b.issued_at ? (a.kind === "VPFD51" ? -1 : 1) : a.issued_at < b.issued_at ? 1 : -1));
}

/** 今日（`today`）から OFFICIAL_DAYS 日先までの、気象庁の日ごとの値と出どころ。`now` より後の発表は使わない。 */
export function officialDays(rows: { issues: HistoryIssue[]; entries: HistoryEntry[] }, today: string, now: string): OfficialDay[] {
  const model = new ForecastHistory({ issues: rows.issues, entries: rows.entries, fetchLog: [] });
  const issues = usableIssues(rows.issues, now);
  const out: OfficialDay[] = [];
  for (let n = 0; n <= OFFICIAL_DAYS; n++) {
    const date = addDays(today, n);
    const each = issues.map((issue) => ({ issue, v: model.valuesFor(issue, date) })).filter((x): x is { issue: HistoryIssue; v: DayValues } => !!x.v);
    /** 新しい発表から順に、値のあるものを1つ。 */
    const first = <T>(get: (v: DayValues) => V | null | undefined, cast: (v: number | string) => T): Official<T> | null => {
      for (const { issue, v } of each) {
        const x = get(v);
        if (x && x.s === "value") return { v: cast(x.v), lower: x.lower ?? null, upper: x.upper ?? null, from: sourceOf(issue, x.entry) };
      }
      return null;
    };
    const num = (v: number | string) => Number(v);
    let weather: OfficialDay["weather"] = null;
    for (const { issue, v } of each) {
      const w = v.weather as DayValues["weather"] & { name?: string | null; partial?: string | null };
      if (w.s !== "value") continue;
      weather = { v: { code: String(w.v), label: w.name ?? null, partial: w.partial ?? null }, from: sourceOf(issue, w.entry) };
      break;
    }
    out.push({
      date,
      weather,
      max: first((v) => v.max, num),
      min: first((v) => v.min, num),
      popDay: first((v) => v.popDay, num),
      pop6: [0, 1, 2, 3].map((k) => first((v) => v.pop6?.[k] ?? null, num)),
      reliability: first((v) => v.reliability, String),
    });
  }
  return out;
}

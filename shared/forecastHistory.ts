// 予報の履歴 (#250, R6): what the server sends for one day's 「この日の予報の移り変わり」.
// The rows are forecast_issues / forecast_entries / forecast_fetch_log as they are kept (R4), only cut
// to the day and the places of the station — the screen decides what to show from them, not the server.

/** forecast_issues, as kept. */
export interface HistoryIssue {
  issue_id: string;
  source: string; // jma-xml / shiromatz
  office: string;
  kind: string; // VPFD51 / VPFW50
  issued_at: string; // JST, "+09:00"
  info_type: string | null; // 発表 / 訂正 / 取消
  revision_of: string | null;
  preferred: number;
  parser: number;
  entries: number;
  problems: string | null;
}

/** forecast_entries, as kept. */
export interface HistoryEntry {
  issue_id: string;
  place: string;
  place_name: string;
  place_type: string;
  element: string;
  valid_from: string; // JST, "+09:00"
  valid_to: string;
  period: string;
  label: string | null;
  value: string | null;
  unit: string | null;
  lower: number | null;
  upper: number | null;
  jma_type: string;
  condition: string | null;
}

/** forecast_fetch_log, as kept (times in UTC). */
export interface HistoryFetchLog {
  at: string;
  feed: string;
  ok: number;
  entries: number;
  wanted: number;
  added: number;
  left_over: number;
  error: string | null;
}

/**
 * The places a station's history is read from: the office (週間の天気・降水確率), the 府県天気予報's area
 * it lies in (天気・降水確率・3時間ごとの天気) and the point whose temperatures are given (気温).
 * Only the stations written here have a history: an area is not guessed (a station not here gets
 * `supported: false`, and the screen says the history is not there for it yet).
 */
export const HISTORY_PLACES: Record<string, { office: string; area: string; point: string }> = {
  // 高知：高知県（390000）、府県天気予報の中部（390010）、気温は高知（74182）。
  "47893": { office: "390000", area: "390010", point: "74182" },
};

/** The elements the screen reads (R6-1). */
export const HISTORY_ELEMENTS = ["weather", "weather_text", "weather_code", "weather_3h", "pop", "temp_max", "temp_min", "reliability"];

/** How far back the issues of a day go: 7日前〜当日 (R6-1), and the day before for the first comparison. */
export const HISTORY_DAYS_BEFORE = 8;

export type ForecastHistoryResponse =
  | {
      v: 1;
      station: string;
      date: string;
      supported: true;
      places: { office: string; area: string; point: string };
      issues: HistoryIssue[];
      entries: HistoryEntry[];
      fetchLog: HistoryFetchLog[];
    }
  | { v: 1; station: string; date: string; supported: false };

// 予報の履歴 (#250, R6): what the server sends for one day's 「この日の予報の移り変わり」.
// The rows are forecast_issues / forecast_entries / forecast_fetch_log as they are kept (R4), only cut
// to the day and the places of the station — the screen decides what to show from them, not the server.

import { STATION_PLACES } from "./stationPlaces";

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
 * The places a station's history is read from (office, 府県天気予報's area, temperature point): the
 * station's row of the one table of places (shared/stationPlaces.ts). A station not there has no history
 * (`supported: false`): an area is not guessed.
 */
export const HISTORY_PLACES: Record<string, { office: string; area: string; point: string }> = Object.fromEntries(
  Object.entries(STATION_PLACES).map(([id, p]) => [id, p.forecast]),
);

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

/** 1つの発表の先の日ぜんぶ（/api/forecast-issue）。府県のときは、その時点の週間（weekly）も。 */
export type ForecastIssueResponse =
  | {
      v: 1;
      station: string;
      supported: true;
      found: true;
      places: { office: string; area: string; point: string };
      issue: HistoryIssue;
      weekly: HistoryIssue | null;
      entries: HistoryEntry[];
    }
  | { v: 1; station: string; supported: true; found: false }
  | { v: 1; station: string; supported: false };

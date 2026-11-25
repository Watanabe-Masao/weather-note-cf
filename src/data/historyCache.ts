// 予報の移り変わり（/api/forecast-history）の取り置き（2026-11-24 渡辺さん「予報履歴が古いまま残る」）。
// 2026-11-25 の見本：自前の取り置き（HistoryCache）を TanStack Query に置き換えた。決まりは同じ：
//   - 今日と先の日：最後に取れてから 10分（LIVE_EVERY）で古い。開くとき・アプリに戻ったとき・開いている間の10分ごとに取り直す。
//   - 過ぎた日：その日が終わったあとに取れた分は、もう古くならない（発表は増えない）。終わる前に取れた分は古い（日付が変わったら1回取り直す）。
//   - 取り直している間も、失敗しても、最後に取れた分を出したまま。いつ取れた分か（at）と、取り直せなかったか（failed）を持つ。
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ForecastHistoryResponse } from "../../shared/forecastHistory";
import { addDays, jstToday } from "../../shared/dates";
import { queryClient } from "./queryClient";
import { LIVE_EVERY } from "./store";

export interface HistoryState {
  /** 最後に取れた発表（まだ無ければ null）。 */
  r: ForecastHistoryResponse | null;
  /** それを取れた時刻（ミリ秒）。 */
  at: number | null;
  /** 取っている途中か。 */
  loading: boolean;
  /** いちばん新しい取り直しが失敗したか（r があれば、それは前に取れた分）。 */
  failed: boolean;
}

const fetchHistory = (station: string, date: string) =>
  fetch(`/api/forecast-history?station=${encodeURIComponent(station)}&date=${date}`).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<ForecastHistoryResponse>;
  });

/** 取れた分が古くなるまでの時間（ミリ秒）。at は取れた時刻（まだ無ければ 0）。 */
export function historyStaleTime(date: string, at: number, today = jstToday()): number {
  if (date >= today) return LIVE_EVERY;
  return at && at >= Date.parse(`${addDays(date, 1)}T00:00:00+09:00`) ? Infinity : 0;
}

export const historyQuery = (station: string, date: string) =>
  queryOptions({
    queryKey: ["forecast-history", station, date],
    queryFn: () => fetchHistory(station, date),
    staleTime: (q) => historyStaleTime(date, q.state.dataUpdatedAt),
    // 開いている間の取り直し：今日と先の日だけ 10分ごと（古くなったら）。
    refetchInterval: () => (date >= jstToday() ? LIVE_EVERY : false),
  });

/** 1回だけ取って中身を返す（取り置きが新しければそれ）。時間帯のグラフの「気象庁の予報」が使う。 */
export const historyCache = { load: (station: string, date: string) => queryClient.fetchQuery(historyQuery(station, date)) };

const EMPTY: HistoryState = { r: null, at: null, loading: false, failed: false };

/** 画面から読む。`on` が false なら何も読まない。 */
export function useForecastHistory(station: string, date: string, on = true): HistoryState {
  const q = useQuery({ ...historyQuery(station, date), enabled: on });
  return on ? { r: q.data ?? null, at: q.dataUpdatedAt || null, loading: q.isFetching, failed: q.isError } : EMPTY;
}

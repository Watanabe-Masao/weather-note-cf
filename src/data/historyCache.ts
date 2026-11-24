// 予報の移り変わり（/api/forecast-history）の取り置き（2026-11-24 渡辺さん「予報履歴が古いまま残る」）。
//
// 前は、一度読んだ日の発表を、アプリを開き直すまで使い続けていた（朝に開いて、夕方に戻っても朝の分のまま）。
//   - 今日と先の日：最後に頼んでから 10分（LIVE_EVERY、今日の観測・予報と同じ）たっていれば、開くとき・アプリに
//     戻ったとき・開いている間の1分ごとの見回りで取り直す。過ぎた日は発表がもう増えないので取り直さない。
//     ただし、その日が終わる前に取れた分は、日付が変わったあとに1回取り直す（失敗したら10分たって次に開いたとき）。
//   - 取り直している間も、失敗しても、最後に取れた分を出したまま。いつ取れた分か（at）と、取り直せなかったか（failed）を持つ。
//   - 予報の移り変わりと時間帯のグラフ（気象庁の予報の ◇）は、同じ取り置きを読む（同じ取得を共有）。
import { useEffect, useSyncExternalStore } from "react";
import type { ForecastHistoryResponse } from "../../shared/forecastHistory";
import { addDays, jstToday } from "../../shared/dates";
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

interface Entry extends HistoryState {
  /** 最後に頼んだ時刻（ミリ秒）。 */
  asked: number;
}

type Fetcher = (station: string, date: string) => Promise<ForecastHistoryResponse>;

const defaultFetch: Fetcher = (station, date) =>
  fetch(`/api/forecast-history?station=${encodeURIComponent(station)}&date=${date}`).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<ForecastHistoryResponse>;
  });

/** 取り置き。テストでは取得と時計を差し替える。 */
export class HistoryCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private fetcher: Fetcher = defaultFetch,
    private now: () => number = Date.now,
    private today: () => string = jstToday,
  ) {}

  private key = (station: string, date: string) => `${station}/${date}`;

  /** 今の様子（無ければ空）。 */
  get(station: string, date: string): HistoryState {
    const e = this.entries.get(this.key(station, date));
    return e ? { r: e.r, at: e.at, loading: e.loading, failed: e.failed } : { r: null, at: null, loading: false, failed: false };
  }

  /** 取り直すべきか：まだ無い・前が失敗して何も無い・今日か先の日で 10分たった。 */
  stale(station: string, date: string): boolean {
    const e = this.entries.get(this.key(station, date));
    if (!e) return true;
    if (!e.r) return !e.loading;
    if (e.loading || this.now() - e.asked < LIVE_EVERY) return false;
    if (date >= this.today()) return true;
    // 過ぎた日でも、その日が終わる前に取れた分は、日付が変わったあとに1回取り直す（夕方の発表が抜けたまま残らないように、
    // 2026-11-24 渡辺さんの共有したレビュー）。取り直せなければ、10分たって次に開いたとき（アプリに戻ったとき）にもう一度。
    return e.at == null || e.at < Date.parse(`${addDays(date, 1)}T00:00:00+09:00`);
  }

  /** 要るときだけ取る（取っている途中なら、その取得を待つ）。 */
  ensure(station: string, date: string): Promise<void> {
    const k = this.key(station, date);
    const running = this.inflight.get(k);
    if (running) return running;
    if (!this.stale(station, date)) return Promise.resolve();
    const prev = this.entries.get(k);
    const e: Entry = { r: prev?.r ?? null, at: prev?.at ?? null, loading: true, failed: false, asked: this.now() };
    this.entries.set(k, e);
    this.bump();
    const p = this.fetcher(station, date).then(
      (r) => {
        Object.assign(e, { r, at: this.now(), loading: false, failed: false });
      },
      () => {
        Object.assign(e, { loading: false, failed: true });
      },
    );
    const done = p.finally(() => {
      this.inflight.delete(k);
      this.bump();
    });
    this.inflight.set(k, done);
    return done;
  }

  /** 1回だけ取って中身を返す（失敗で前の分も無ければ失敗）。 */
  async load(station: string, date: string): Promise<ForecastHistoryResponse> {
    await this.ensure(station, date);
    const s = this.get(station, date);
    if (!s.r) throw new Error("forecast-history");
    return s.r;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  snapshot = () => this.version;

  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

/** アプリで使う1つの取り置き。 */
export const historyCache = new HistoryCache();

const EMPTY: HistoryState = { r: null, at: null, loading: false, failed: false };

/**
 * 画面から読む：開いたとき・アプリに戻ったとき・開いている間の1分ごとに、要るときだけ取り直す（historyCache.ensure）。
 * `on` が false なら何も読まない。
 */
export function useForecastHistory(station: string, date: string, on = true): HistoryState {
  useSyncExternalStore(historyCache.subscribe, historyCache.snapshot);
  useEffect(() => {
    if (!on) return;
    const go = () => void historyCache.ensure(station, date);
    go();
    const back = () => {
      if (document.visibilityState === "visible") go();
    };
    document.addEventListener("visibilitychange", back);
    const t = setInterval(go, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", back);
      clearInterval(t);
    };
  }, [station, date, on]);
  return on ? historyCache.get(station, date) : EMPTY;
}

// 空気質（2026-11-25 渡辺さん「大気質の UI」）：/api/air（CAMS のモデルの値、だれでも）と /api/admin/air-measured
// （そらまめくんの実測、管理者だけ）を取り置く。
//
// 取り直し：今日と先の日は、最後に頼んでから 10分（LIVE_EVERY）たっていれば、開くとき・アプリに戻ったとき・開いている
// 間の1分ごとの見回りで（予測はサーバーで1時間ごとに新しくなる）。過ぎた日は1回だけ（実測は速報値が直ることがあるが、
// 次に開いたときで足りる）。取り直している間も、失敗しても、最後に取れた分を出したまま。
// 日付が変わって「今日」が「昨日」になった日は、すぐに1回取り直す（11/25 レビュー：予測のまま残らないように）。
// そのあとも、まだ終わった日の値に替わっていなければ（settled が false）、今日と同じ間隔で取り直す。
import { useEffect, useSyncExternalStore } from "react";
import type { AirResponse, MeasuredResponse } from "../../shared/airQuality";
import { addDays, jstToday } from "../../shared/dates";
import { api } from "../account/account";
import { LIVE_EVERY } from "./store";

export type AirData = AirResponse & { supported: true };
export type { MeasuredResponse };

export interface Loaded<T> {
  /** 最後に取れた分（まだ無ければ null）。 */
  r: T | null;
  loading: boolean;
  /** いちばん新しい取り直しが失敗したか。 */
  failed: boolean;
  /** 地点に空気質の場所が無い。 */
  unsupported?: boolean;
}

interface Entry<T> extends Loaded<T> {
  asked: number;
  /** 頼んだときの「今日」。 */
  askedDay: string;
}

/** 取り置き（地点と日ごと）。テストでは取得と時計を差し替える。 */
export class LiveCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private fetcher: (station: string, date: string) => Promise<T | null>,
    private now: () => number = Date.now,
    private today: () => string = jstToday,
    /** 過ぎた日の値として落ち着いたか（false なら過ぎた日でも取り直す）。 */
    private settled: (r: T) => boolean = () => true,
  ) {}

  private key = (station: string, date: string) => `${station}/${date}`;

  get(station: string, date: string): Loaded<T> {
    const e = this.entries.get(this.key(station, date));
    return e ? { r: e.r, loading: e.loading, failed: e.failed, unsupported: e.unsupported } : { r: null, loading: false, failed: false };
  }

  stale(station: string, date: string): boolean {
    const e = this.entries.get(this.key(station, date));
    if (!e) return true;
    if (e.loading || e.unsupported) return false;
    if (!e.r) return this.now() - e.asked >= LIVE_EVERY || !e.failed;
    const today = this.today();
    if (date < today && e.askedDay <= date) return true; // 頼んだ後に日付が変わって過ぎた日になった
    return (date >= today || !this.settled(e.r)) && this.now() - e.asked >= LIVE_EVERY;
  }

  ensure(station: string, date: string): Promise<void> {
    const k = this.key(station, date);
    const running = this.inflight.get(k);
    if (running) return running;
    if (!this.stale(station, date)) return Promise.resolve();
    const prev = this.entries.get(k);
    const e: Entry<T> = { r: prev?.r ?? null, loading: true, failed: false, asked: this.now(), askedDay: this.today() };
    this.entries.set(k, e);
    this.bump();
    const p = this.fetcher(station, date).then(
      (r) => {
        if (r == null) Object.assign(e, { loading: false, unsupported: true });
        else Object.assign(e, { r, loading: false, failed: false });
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

export const airCache = new LiveCache<AirData>(
  async (station, date) => {
    const r = await fetch(`/api/air?station=${encodeURIComponent(station)}&date=${date}`);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as AirData | { supported: false };
    return j.supported ? (j as AirData) : null;
  },
  Date.now,
  jstToday,
  // 過ぎた日なのに予測のまま（終わった日の値がまだ届いていない）なら、届くまで取り直す
  (r) => r.kind === "past",
);

export const measuredCache = new LiveCache<MeasuredResponse>((station, date) => api<MeasuredResponse>(`/api/admin/air-measured?station=${encodeURIComponent(station)}&date=${date}`));

const EMPTY: Loaded<never> = { r: null, loading: false, failed: false };

function useLive<T>(cache: LiveCache<T>, station: string, date: string, on: boolean): Loaded<T> {
  useSyncExternalStore(cache.subscribe, cache.snapshot);
  useEffect(() => {
    if (!on) return;
    const go = () => void cache.ensure(station, date);
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
  }, [cache, station, date, on]);
  return on ? cache.get(station, date) : EMPTY;
}

/** 空気質を持っている日（CAMS は 2023-01-01 から、予測は今日から5日分）。 */
export const AIR_FIRST = "2023-01-01";
export const airInRange = (date: string, today: string) => date >= AIR_FIRST && date <= addDays(today, 4);

/** その日の空気質（CAMS のモデルの値）。持っていない日は読まない。 */
export const useAir = (station: string, date: string, on = true) => useLive(airCache, station, date, on && airInRange(date, jstToday()));

/** その日の実測（管理者だけ。`on` は管理者のときだけ true にする）。 */
export const useMeasured = (station: string, date: string, on: boolean) => useLive(measuredCache, station, date, on);

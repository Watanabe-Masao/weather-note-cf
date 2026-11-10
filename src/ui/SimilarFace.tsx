// The sheet's 似た日 face (spec chapter 6): past days whose weather was close to the target day,
// from the same season of the past three years. Tap one to make it the comparison day.

import { useEffect, useMemo, useState } from "react";
import { dayTone, weekdayOf } from "../../shared/holidays";
import {
  candidateDays,
  comparable,
  findSimilar,
  SEASON_RADIUS,
  WEEKDAY_FILTERS,
  type WeekdayFilter,
  YEARS_BACK,
} from "../../shared/similar";
import type { WeatherRow } from "../../shared/types";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { WeatherIcon } from "./WeatherIcon";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  compareDate: string | null;
  onPick: (date: string) => void;
}

const fmt = (v: number) => v.toFixed(1);
const diff = (v: number) => (Math.abs(v) < 0.05 ? "±0" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);
const label = (d: string) => `${d.slice(0, 4)}/${+d.slice(5, 7)}/${+d.slice(8)}`;

export function SimilarFace({ store, station, target, compareDate, onPick }: Props) {
  const [filter, setFilter] = useState<WeekdayFilter>("any");
  const candidates = useMemo(() => candidateDays(target), [target]);

  // Ask for the candidates' months while this face is open; withdraw when it closes.
  useEffect(() => {
    store?.prefetch(station, candidates, "similar", Priority.Ahead);
    return () => store?.prefetch(station, [], "similar");
  }, [store, station, candidates]);

  const originDay = store?.getDay(station, target);
  const origin = comparable(originDay?.row);
  const rows = new Map<string, WeatherRow | null>();
  let loaded = 0;
  for (const d of candidates) {
    const day = store?.getDay(station, d);
    if (day?.state === "ready") {
      rows.set(d, day.row);
      loaded++;
    }
  }
  const matches = origin ? findSimilar(origin, target, rows, filter) : [];

  return (
    <div className="similar-face">
      <p className="similar-origin">
        {origin ? (
          <>
            <WeatherIcon text={originDay?.row?.dayWeather as string | null} size={22} />
            <b>{label(target)}</b>
            <span className={`tone-${dayTone(target)}`}>（{weekdayOf(target)}）</span>
            {originDay?.row?.type === "forecast" ? "の予報" : ""}に近い日
            <small>
              最高 {fmt(origin.max)}℃ / 最低 {fmt(origin.min)}℃ / 降水 {fmt(origin.rain)}mm
            </small>
          </>
        ) : (
          "対象日のデータを取得中…"
        )}
      </p>
      <p className="similar-scope">
        過去{YEARS_BACK}年の同じ時期（±{SEASON_RADIUS}日）
        {loaded < candidates.length && `・取得中 ${loaded}/${candidates.length}日`}
      </p>
      <div className="trend-chips">
        {WEEKDAY_FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
            {f.label}
          </button>
        ))}
      </div>
      <ol className="similar-list">
        {matches.map((m, i) => (
          <li key={m.date}>
            <button className={m.date === compareDate ? "current" : ""} onClick={() => onPick(m.date)}>
              <span className="rank">{i + 1}</span>
              <span className="who">
                <span className={`tone-${dayTone(m.date)}`}>
                  {label(m.date)}（{weekdayOf(m.date)}）
                </span>
                <span className="values">
                  <WeatherIcon text={rows.get(m.date)?.dayWeather as string | null} size={18} />
                  <span className="hot">{fmt(m.values.max)}</span>
                  <small>{diff(m.values.max - origin!.max)}</small>
                  <span className="cold">{fmt(m.values.min)}</span>
                  <small>{diff(m.values.min - origin!.min)}</small>
                  <span>{fmt(m.values.rain)}mm</span>
                </span>
              </span>
              <span className="close">
                <b>{m.closeness}</b>
                <i style={{ width: `${m.closeness}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ol>
      {origin && matches.length === 0 && loaded === candidates.length && <p className="hint">条件に合う日がありません。</p>}
      <p className="trend-note">タップするとその日を比較日にします。近さは100が同じ天気。</p>
    </div>
  );
}

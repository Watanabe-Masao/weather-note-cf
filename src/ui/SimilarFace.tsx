// 似た日 (spec chapter 6): past days whose weather was close to the target day, from the same
// season of the past three years. Opened from the compare menu; tap one to make it the comparison day.

import { useEffect, useMemo, useState } from "react";
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
import { signedDiff, UNIT } from "../design/format";
import { Chip, DayLabel, Num } from "./kit";
import { WeatherIcon } from "./WeatherIcon";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  compareDate: string | null;
  onPick: (date: string) => void;
}


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

  // Where the current comparison day stands, when it is one of the candidates.
  const currentIndex = compareDate ? matches.findIndex((m) => m.date === compareDate) : -1;
  const current = compareDate && currentIndex < 0 && origin ? comparable(store?.getDay(station, compareDate).row) : null;

  return (
    <div className="similar-face">
      <div className="similar-origin">
        {origin ? (
          <>
            <p className="similar-title">
              <WeatherIcon text={originDay?.row?.dayWeather as string | null} size={22} />
              <DayLabel date={target} year />
              <span>{originDay?.row?.type === "forecast" ? "の予報" : ""}に近い日</span>
            </p>
            <p className="similar-values">
              最高 <Num value={origin.max} unit={UNIT.temp} tone="hot" />
              最低 <Num value={origin.min} unit={UNIT.temp} tone="cold" />
              降水 <Num value={origin.rain} unit={UNIT.rain} tone="rain" />
            </p>
          </>
        ) : (
          <p className="similar-title">対象日のデータを取得中…</p>
        )}
        <p className="similar-note">
          過去{YEARS_BACK}年の同じ時期（前後{SEASON_RADIUS}日）から。近さは100が同じ天気。タップでその日を比較日にします。
          {loaded < candidates.length && <span className="loading">取得中 {loaded}/{candidates.length}日</span>}
        </p>
      </div>
      <div className="chip-row">
        {WEEKDAY_FILTERS.map((f) => (
          <Chip key={f.id} size="sm" on={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Chip>
        ))}
      </div>
      {current && compareDate && (
        <p className="similar-current">
          今の比較日 <DayLabel date={compareDate} year /> は上位{matches.length}件に入っていません
        </p>
      )}
      <ol className="similar-list">
        <li className="similar-head" aria-hidden>
          <span />
          <span>日付</span>
          <span />
          <span>最高</span>
          <span>最低</span>
          <span>降水</span>
          <span>近さ</span>
        </li>
        {matches.map((m, i) => (
          <li key={m.date}>
            <button className={m.date === compareDate ? "current" : ""} onClick={() => onPick(m.date)} aria-current={m.date === compareDate}>
              <span className="rank">{i + 1}</span>
              <span className="when">
                <DayLabel date={m.date} year />
                {m.date === compareDate && <span className="badge relative">比較中</span>}
              </span>
              <WeatherIcon text={rows.get(m.date)?.dayWeather as string | null} size={18} />
              <span className="v">
                <Num value={m.values.max} unit={UNIT.temp} tone="hot" showUnit={false} />
                <small>{signedDiff(m.values.max, origin!.max, UNIT.temp)}</small>
              </span>
              <span className="v">
                <Num value={m.values.min} unit={UNIT.temp} tone="cold" showUnit={false} />
                <small>{signedDiff(m.values.min, origin!.min, UNIT.temp)}</small>
              </span>
              <span className="v">
                <Num value={m.values.rain} unit={UNIT.rain} tone="rain" showUnit={false} />
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
    </div>
  );
}

// Stage 2: a check page for the data layer.
// Move a 7-day window through time and watch the request counter: returning to a range already
// seen must not increase it. The comparison screen replaces this page in the next stage.

import { useEffect, useState } from "react";
import { addDays, FIRST_DAY, jstToday } from "../shared/dates";
import type { Station } from "../shared/types";
import { useWeatherStore } from "./data";
import { type Direction, lastDay } from "./data/plan";
import type { StorageReport } from "./data/store";

const DEFAULT_STATION = "47893"; // 高知
const WEEK = [-3, -2, -1, 0, 1, 2, 3];
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const fmt = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "—");
const time = (t: number | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—");

export function App() {
  const store = useWeatherStore();
  const [stations, setStations] = useState<Station[]>([]);
  const [station, setStation] = useState(DEFAULT_STATION);
  const [center, setCenter] = useState(jstToday());
  const [direction, setDirection] = useState<Direction>(0);
  const [report, setReport] = useState<StorageReport | null>(null);

  useEffect(() => {
    fetch("/api/stations")
      .then((r) => r.json())
      .then(setStations, () => {});
  }, []);

  useEffect(() => {
    store?.setView(station, [center], direction);
  }, [store, station, center, direction]);

  // Refresh the storage report when the store changes, at most once a second.
  useEffect(() => {
    if (!store) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => void store.report().then(setReport);
    update();
    const unsubscribe = store.subscribe(() => {
      timer ??= setTimeout(() => {
        timer = null;
        update();
      }, 1_000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [store]);

  // The centre stays between 1977 and the last forecast day, like the drum strip will.
  const move = (days: number) => {
    setDirection(days < 0 ? -1 : 1);
    setCenter((c) => {
      const next = addDays(c, days);
      const max = lastDay(store?.today ?? jstToday());
      return next > max ? max : next < FIRST_DAY ? FIRST_DAY : next;
    });
  };
  const atEnd = center >= lastDay(store?.today ?? jstToday());

  return (
    <main className="page">
      <header className="head">
        <h1>Weather Note</h1>
        <select value={station} onChange={(e) => setStation(e.target.value)} aria-label="観測地点">
          {stations.map((s) => (
            <option key={s.blockNo} value={s.blockNo}>
              {s.prefecture} / {s.name}
            </option>
          ))}
        </select>
      </header>

      <nav className="week-nav">
        <button onClick={() => move(-28)}>−4週</button>
        <button onClick={() => move(-7)}>◀ 1週</button>
        <button
          onClick={() => {
            setDirection(0);
            setCenter(jstToday());
          }}
        >
          今日
        </button>
        <button onClick={() => move(7)} disabled={atEnd}>
          1週 ▶
        </button>
      </nav>

      <table>
        <thead>
          <tr>
            <th>日付</th>
            <th>天気（昼）</th>
            <th>最高</th>
            <th>最低</th>
            <th>降水</th>
          </tr>
        </thead>
        <tbody>
          {WEEK.map((offset) => {
            const date = addDays(center, offset);
            const day = store?.getDay(station, date);
            const wd = new Date(date + "T00:00:00Z").getUTCDay();
            const r = day?.row;
            return (
              <tr key={date} className={offset === 0 ? "center" : undefined}>
                <td className={wd === 0 ? "sun" : wd === 6 ? "sat" : undefined}>
                  {date.slice(5)}（{WEEKDAYS[wd]}）
                </td>
                {day?.state === "outside" ? (
                  <td colSpan={4} className="outside">
                    予報範囲外
                  </td>
                ) : day?.state === "error" ? (
                  <td colSpan={4} className="error" onClick={() => store?.retryDay(station, date)}>
                    取得失敗（タップで再試行）
                  </td>
                ) : day?.state !== "ready" ? (
                  <td colSpan={4}>
                    <span className="skeleton" />
                  </td>
                ) : (
                  <>
                    <td>
                      {(r?.dayWeather as string) ?? "—"}
                      {day.kind === "variable" && <small className="tag">{r?.type === "forecast" ? "予報" : "暫定"}</small>}
                    </td>
                    <td>{fmt(r?.max)}</td>
                    <td>{fmt(r?.min)}</td>
                    <td>{fmt(r?.rain)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="report">
        <h2>通信と保存の確認</h2>
        <dl>
          <dt>この起動での通信回数</dt>
          <dd>{store?.requests ?? 0}回</dd>
          <dt>保存件数</dt>
          <dd>
            日別 {report?.days ?? "…"}件 / 時間別 {report?.hours ?? "…"}件
          </dd>
          <dt>最初の保存</dt>
          <dd>{time(report?.firstSavedAt ?? null)}</dd>
          <dt>最後の保存</dt>
          <dd>{time(report?.lastSavedAt ?? null)}</dd>
          <dt>保存の永続化</dt>
          <dd>{{ granted: "許可", denied: "不許可", unsupported: "未対応" }[report?.persisted ?? "unsupported"]}</dd>
        </dl>
        {report?.lostSince ? <p className="error">保存データが消えていました（前回 {report.lostSince}件）</p> : null}
        <div className="actions">
          <button onClick={() => store?.refresh()}>更新</button>
          <button
            onClick={() => {
              if (confirm("保存したデータを消去して、取り直しますか？")) void store?.clear();
            }}
          >
            保存データを消去して取り直す
          </button>
        </div>
      </section>

      <footer className="credit">
        出典：<a href="https://www.jma.go.jp/">気象庁ホームページ</a>（実績）／
        <a href="https://open-meteo.com/">Open-Meteo</a>（予報・CC BY 4.0）
      </footer>
    </main>
  );
}

// 天気図 (#249) in 1日モード: the day's surface chart (日本周辺), read from JMA as far back as it keeps one
// (shared/wxchart.ts) — the 3-hourly picture from 2024-10, a PDF to open before that (保存用天気図 from
// 2022-12, 日々の天気図 from 2002), the National Diet Library's collection before 2002, and for the
// days ahead the latest 予想天気図 that falls on the day. Nothing is kept by the app yet.

import { useEffect, useState } from "react";
import { CHART_HOURS, CREDIT, dayChart, type ForecastChart } from "../../shared/wxchart";
import { Chip } from "./kit";

let forecast: Promise<ForecastChart[]> | null = null;
const loadForecast = () =>
  (forecast ??= fetch("/api/wxchart-forecast")
    .then((r) => (r.ok ? r.json() : { charts: [] }))
    .then((j: { charts?: ForecastChart[] }) => j.charts ?? [])
    .catch(() => ((forecast = null), [])));

const hm = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${Number(iso.slice(11, 13))}時`;

export function WxChart({ date, today }: { date: string; today: string }) {
  const what = dayChart(date, today);
  const [hour, setHour] = useState(9);
  const [missing, setMissing] = useState<Record<string, true>>({});
  const [ahead, setAhead] = useState<ForecastChart[] | null>(null);
  useEffect(() => {
    if (what.kind !== "forecast") return;
    let live = true;
    void loadForecast().then((c) => live && setAhead(c));
    return () => {
      live = false;
    };
  }, [what.kind]);

  if (what.kind === "quick") {
    const url = what.charts.find((c) => c.hour === hour)?.url ?? what.charts[2].url;
    return (
      <figure className="wx-chart">
        <div className="wx-head">
          <h4 className="dd-sub">天気図</h4>
          <span className="wx-hours" role="group" aria-label="時刻">
            {CHART_HOURS.map((h) => (
              <Chip key={h} size="sm" on={h === hour} onClick={() => setHour(h)}>
                {h}時
              </Chip>
            ))}
          </span>
        </div>
        {missing[url] ? (
          <p className="wx-none">{date === today ? "この時刻の天気図はまだ出ていません。" : "この時刻の天気図は見つかりませんでした。"}</p>
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="wx-pic">
            <img src={url} alt={`地上天気図（日本周辺）${hour}時`} width={600} height={581} loading="lazy" onError={() => setMissing((m) => ({ ...m, [url]: true }))} />
          </a>
        )}
        <figcaption>「地上天気図（日本周辺）」（{CREDIT}）・押すと大きく</figcaption>
      </figure>
    );
  }
  if (what.kind === "forecast") {
    const mine = (ahead ?? []).filter((c) => c.valid.slice(0, 10) === date);
    return (
      <figure className="wx-chart">
        <div className="wx-head">
          <h4 className="dd-sub">予想天気図</h4>
        </div>
        {ahead == null ? (
          <p className="wx-none">読み込み中…</p>
        ) : mine.length === 0 ? (
          <p className="wx-none">この日の予想天気図はありません（気象庁の予想天気図は24時間後と48時間後の2枚です）。</p>
        ) : (
          mine.map((c) => (
            <div key={c.url} className="wx-fc">
              <a href={c.url} target="_blank" rel="noreferrer" className="wx-pic">
                <img src={c.url} alt={`予想天気図 ${c.hours}時間後`} width={600} height={581} loading="lazy" />
              </a>
              <small>
                {hm(c.valid)}の予想（{hm(c.base)}の観測から{c.hours}時間後）
              </small>
            </div>
          ))
        )}
        <figcaption>「予想天気図」（{CREDIT}）</figcaption>
      </figure>
    );
  }
  return (
    <div className="wx-chart">
      <div className="wx-head">
        <h4 className="dd-sub">天気図</h4>
      </div>
      {what.kind === "archive" && (
        <p className="wx-links">
          {what.pdfs.map((p) => (
            <a key={p.hour} className="chip sm" href={p.url} target="_blank" rel="noreferrer">
              {p.hour}時の天気図（PDF）
            </a>
          ))}
        </p>
      )}
      {what.kind === "hibiten" && (
        <p className="wx-links">
          <a className="chip sm" href={what.url} target="_blank" rel="noreferrer">
            日々の天気図 {date.slice(0, 4)}年{Number(date.slice(5, 7))}月（PDF）
          </a>
          <small>その月の9時の天気図の、{what.day}日の欄</small>
        </p>
      )}
      {what.kind === "ndl" && (
        <p className="wx-links">
          <a className="chip sm" href={what.url} target="_blank" rel="noreferrer">
            国立国会図書館デジタルコレクションの天気図
          </a>
          <small>2001年以前の天気図は、国立国会図書館で見られます。</small>
        </p>
      )}
      {what.kind === "none" && <p className="wx-none">この日の天気図はありません。</p>}
      {what.kind !== "none" && <small className="wx-credit">出典：{CREDIT.replace("より", "")}{what.kind === "ndl" ? "・国立国会図書館" : ""}</small>}
    </div>
  );
}

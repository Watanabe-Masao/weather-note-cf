// 天気図 (#249) in 1日モード: the day's surface chart (日本周辺), read from JMA as far back as it keeps one
// (shared/wxchart.ts) — the 3-hourly picture from 2024-10, a PDF to open before that (保存用天気図 from
// 2022-12, 日々の天気図 from 2002), the National Diet Library's collection before 2002, and for the
// days ahead the latest 予想天気図 that falls on the day. Nothing is kept by the app yet.

import { useEffect, useState } from "react";
import { addDays } from "../../shared/dates";
import { CHART_HOURS, CREDIT, dayChart, type ForecastChart, QUICK_FROM, quickChartUrl } from "../../shared/wxchart";
import { Chip, Segmented } from "./kit";

let forecast: Promise<ForecastChart[]> | null = null;
const loadForecast = () =>
  (forecast ??= fetch("/api/wxchart-forecast")
    .then((r) => (r.ok ? r.json() : { charts: [] }))
    .then((j: { charts?: ForecastChart[] }) => j.charts ?? [])
    .catch(() => ((forecast = null), [])));

const hm = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${Number(iso.slice(11, 13))}時`;

function DayCharts({ date, today, titled }: { date: string; today: string; titled: boolean }) {
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
          {titled && <h4 className="dd-sub">天気図</h4>}
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
          {titled && <h4 className="dd-sub">予想天気図</h4>}
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
        {titled && <h4 className="dd-sub">天気図</h4>}
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

/**
 * 天気図（1日モード「根拠と記録」、予報の移り変わりと連動、2026-11-18 渡辺さん）：
 *   発表の時：選んだ発表の直前の天気図（3時間ごとの実況）と、その時点で出ていた予想天気図（保存した分）。
 *             予報を作ったときの空の形。発表を選び直すと一緒に変わる。
 *   この日：対象日そのものの天気図（実際どうなったか）。
 * 発表が無い日（予報の移り変わりが出ない日）は「この日」だけ。どの図にも、いつの図かを書く。
 */
export function WxChart({ date, today, issued }: { date: string; today: string; issued?: string | null }) {
  const [view, setView] = useState<"issued" | "day">("issued");
  if (!issued) return <DayCharts date={date} today={today} titled />;
  return (
    <div className="wx-chart">
      <div className="wx-head">
        <h4 className="dd-sub">天気図</h4>
      </div>
      <Segmented
        label="天気図の時点"
        value={view}
        onChange={setView}
        options={[
          { id: "issued", label: "発表の時" },
          { id: "day", label: "この日" },
        ]}
      />
      {view === "issued" ? <IssuedCharts issued={issued} /> : <DayCharts date={date} today={today} titled={false} />}
    </div>
  );
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** その発表の直前の実況の天気図（3時間ごと）：発表の時刻以下でいちばん近い 3・6…21時（3時より前は前の日の21時）。 */
export function chartBefore(issued: string): { date: string; hour: number; lead: number } {
  const d = issued.slice(0, 10);
  const h = Number(issued.slice(11, 13));
  const hour = [...CHART_HOURS].reverse().find((x) => x <= h);
  return hour == null ? { date: addDays(d, -1), hour: 21, lead: h + 3 } : { date: d, hour, lead: h - hour };
}

type Saved = { hours: number; base: string; valid: string; src: string };
const savedAt = new Map<string, Promise<Saved[]>>();
const loadSaved = (at: string) => {
  let p = savedAt.get(at);
  if (!p) {
    p = fetch(`/api/wxchart-at?at=${encodeURIComponent(at)}`)
      .then((r) => (r.ok ? r.json() : { charts: [] }))
      .then((j: { charts?: Saved[] }) => j.charts ?? [])
      .catch(() => (savedAt.delete(at), []));
    savedAt.set(at, p);
  }
  return p;
};

function IssuedCharts({ issued }: { issued: string }) {
  const b = chartBefore(issued);
  const url = quickChartUrl(b.date, b.hour);
  const [missing, setMissing] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ at: string; charts: Saved[] } | null>(null);
  useEffect(() => {
    let live = true;
    void loadSaved(issued).then((charts) => live && setSaved({ at: issued, charts }));
    return () => {
      live = false;
    };
  }, [issued]);
  const ahead = saved?.at === issued ? saved.charts : null;
  const when = `${md(issued)} ${Number(issued.slice(11, 13))}時の発表`;
  return (
    <>
      <p className="wx-lead">{when}のときの空の形</p>
      {b.date < QUICK_FROM ? (
        <p className="wx-none">この発表の時の3時間ごとの天気図はありません（2024年10月より前）。</p>
      ) : missing === url ? (
        <p className="wx-none">{md(b.date)} {b.hour}時の天気図は見つかりませんでした。</p>
      ) : (
        <div className="wx-fc">
          <a href={url} target="_blank" rel="noreferrer" className="wx-pic">
            <img src={url} alt={`地上天気図（日本周辺）${md(b.date)} ${b.hour}時`} width={600} height={581} loading="lazy" onError={() => setMissing(url)} />
          </a>
          <small>
            {md(b.date)} {b.hour}時の天気図（この発表の{b.lead}時間前）
          </small>
        </div>
      )}
      {ahead == null ? (
        <p className="wx-none">その時の予想天気図を読み込み中…</p>
      ) : ahead.length === 0 ? (
        <p className="wx-none">この発表の時の予想天気図はありません（保存を始める前の発表です）。</p>
      ) : (
        <div className="wx-pair">
          {ahead.map((c) => (
            <div key={c.src} className="wx-fc">
              <a href={c.src} target="_blank" rel="noreferrer" className="wx-pic">
                <img src={c.src} alt={`予想天気図 ${c.hours}時間後`} width={600} height={581} loading="lazy" />
              </a>
              <small>
                {hm(c.valid)}の予想（{c.hours}時間後）
              </small>
            </div>
          ))}
        </div>
      )}
      <small className="wx-credit">「地上天気図（日本周辺）」「予想天気図」（{CREDIT}）・押すと大きく</small>
    </>
  );
}

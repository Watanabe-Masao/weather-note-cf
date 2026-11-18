// 天気図 (#249) in 1日モード: the day's surface chart (日本周辺), read from JMA as far back as it keeps one
// (shared/wxchart.ts) — the 3-hourly picture from 2024-10, a PDF to open before that (保存用天気図 from
// 2022-12, 日々の天気図 from 2002), the National Diet Library's collection before 2002, and for the
// days ahead the latest 予想天気図 that falls on the day. Nothing is kept by the app yet.

import { type ReactNode, useEffect, useState } from "react";
import { addDays } from "../../shared/dates";
import { CHART_HOURS, CREDIT, dayChart, type ForecastChart, QUICK_FROM, quickChartUrl } from "../../shared/wxchart";
import { Chip, Segmented } from "./kit";
import { ModalSheet } from "./ModalSheet";

/**
 * 天気図の絵：押すとアプリの中のシートで大きく（2026-11-18 渡辺さん：保存した図は閉じるが無く、閉じると画面がいちばん上に戻った）。
 * シートなので「×」と下へ引いて閉じられ、閉じても読んでいた所のまま。指で広げて拡大できる。
 * 長押しで新しいタブに開くこともできるよう、リンク（href）は残す。
 */
function ChartPic({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="wx-pic"
        aria-label={`${alt}（押すと大きく）`}
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt} width={600} height={581} loading="lazy" onError={onError} />
      </a>
      {open && (
        <ModalSheet title={alt} onClose={() => setOpen(false)} className="wx-viewer">
          <img className="wx-viewer-img" src={src} alt={alt} width={600} height={581} />
          <small className="wx-credit">{CREDIT}・指で広げると拡大</small>
        </ModalSheet>
      )}
    </>
  );
}

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

  // 今日の、まだ出ていない時刻（これから先の時刻と、読めなかった図）は時刻のボタンを控えめに（2026-11-18）。
  // 過ぎた時刻は図を先に読んでみる（押したときに出るのと同じ図。読めなければ「まだ出ていません」の印）。
  const nowHour = new Date(Date.now() + 9 * 3_600_000).getUTCHours();
  const notYet = (h: number) => date > today || (date === today && h > nowHour);
  useEffect(() => {
    if (what.kind !== "quick" || date !== today) return;
    let live = true;
    for (const c of what.charts) {
      if (c.hour > nowHour) continue;
      const img = new Image();
      img.onerror = () => live && setMissing((m) => ({ ...m, [c.url]: true }));
      img.src = c.url;
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, today]);

  if (what.kind === "quick") {
    const url = what.charts.find((c) => c.hour === hour)?.url ?? what.charts[2].url;
    return (
      <figure className="wx-chart">
        <div className="wx-head">
          {titled && <h4 className="dd-sub">天気図</h4>}
          <span className="wx-hours" role="group" aria-label="時刻">
            {CHART_HOURS.map((h) => {
              const none = notYet(h) || missing[quickChartUrl(date, h)] === true;
              return (
                <Chip key={h} size="sm" on={h === hour} muted={none} label={none ? `${h}時（${date === today ? "まだ出ていません" : "見つかりません"}）` : undefined} onClick={() => setHour(h)}>
                  {h}時
                </Chip>
              );
            })}
          </span>
        </div>
        {missing[url] || notYet(hour) ? (
          <p className="wx-none">{date === today ? "この時刻の天気図はまだ出ていません。" : "この時刻の天気図は見つかりませんでした。"}</p>
        ) : (
          <ChartPic src={url} alt={`地上天気図（日本周辺）${hour}時`} onError={() => setMissing((m) => ({ ...m, [url]: true }))} />
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
              <ChartPic src={c.url} alt={`予想天気図 ${c.hours}時間後`} />
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
  // 3枚を横1列に（実況・24時間後・48時間後の予想）。押すと大きく（2026-11-18 渡辺さん「スクロールが長すぎる」）。
  // 無い図はその枠に「なし」と書く（枠は残して、何が無いかが分かるように）。
  const slot = (key: string, cap: ReactNode, body: ReactNode) => (
    <div key={key} className="wx-fc">
      {body}
      <small>{cap}</small>
    </div>
  );
  const none = (text: string) => <span className="wx-empty">{text}</span>;
  const nowPic =
    b.date < QUICK_FROM
      ? none("2024年10月より前")
      : missing === url
        ? none("見つかりません")
        : (
            <ChartPic src={url} alt={`地上天気図（日本周辺）${md(b.date)} ${b.hour}時`} onError={() => setMissing(url)} />
          );
  const aheadOf = (hours: number) => {
    const c = ahead?.find((x) => x.hours === hours);
    if (ahead == null) return slot(`a${hours}`, `${hours}時間後の予想`, none("読み込み中…"));
    if (!c) return slot(`a${hours}`, `${hours}時間後の予想`, none("なし"));
    return slot(
      c.src,
      `${hm(c.valid)}の予想`,
      <ChartPic src={c.src} alt={`予想天気図 ${c.hours}時間後`} />,
    );
  };
  return (
    <>
      <p className="wx-lead">{when}のときの空の形</p>
      <div className="wx-trio">
        {slot("now", `${md(b.date)} ${b.hour}時（${b.lead}時間前）`, nowPic)}
        {aheadOf(24)}
        {aheadOf(48)}
      </div>
      {ahead != null && ahead.length === 0 && <p className="wx-none">予想天気図は、保存を始める前の発表のため、ありません。</p>}
      <small className="wx-credit">「地上天気図（日本周辺）」「予想天気図」（{CREDIT}）・押すと大きく</small>
    </>
  );
}

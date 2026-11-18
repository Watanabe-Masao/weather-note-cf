// 1日モード (#247): the selected day on its own, read in the order a day is told —
//   the top: what kind of day (its picture, 最高／最低, 実績 or 予報, a line about it);
//   ① 1日の流れ: everything that has a time, on one clock (日の出・日の入り, the five 時間帯 — a tap
//      opens their hours —, and the chosen item over 24 hours, the same graph as the 時間帯 sheet);
//   ② この日の値: the values that have no time, every item at once (a tap shows it in ①);
//   ③ 根拠と記録: where it comes from — how the forecasts of the day moved (予報の履歴, R6), the weather
//      chart —, and the person's own reports of that day.
// Nothing here is computed anew: the values, hours, parts and words are the ones the comparison
// screens already use (chartMetrics, dayDetail, dayParts, dayComment).

import { useContext, useMemo, useState } from "react";
import { clockOf, dayEdges, dayParts, hoursIn } from "../../shared/dayParts";
import { hoursWeather } from "../../shared/dayWeather";
import { provisionalNote } from "../../shared/provisionalNote";
import { levelOf } from "../../shared/feel";
import { SENSATIONS, EXPOSURES } from "../beta/reports";
import { useReports } from "../beta/useReports";
import { tableSeries } from "../chartMetrics";
import { dayComment } from "../data/dayComment";
import type { WeatherStore } from "../data/store";
import { useTyphoonOn } from "../data/typhoonDays";
import { hourSeries } from "../dayDetail";
import { formatValue, METRICS, type MetricId } from "../metrics";
import { kindLabel } from "./CompareBoard";
import { DaySummaryContext } from "./daySummaryPress";
import { FeelContext, levelColor, levelName } from "./FeelBar";
import { HourFace } from "./HourFace";
import { useSun } from "./HourCompare";
import { Chip, Conf, CONF_TEXT, confidenceOfRow, SectionHead } from "./kit";
import { DayWeatherIcon, WeatherIcon } from "./WeatherIcon";
import { WxChart } from "./WxChart";
import { ForecastHistoryPanel } from "./forecastHistory/ForecastHistory";

interface Props {
  store: WeatherStore | null;
  station: string;
  date: string;
  today: string;
  metric: MetricId;
  onMetric: (id: MetricId) => void;
  onOpenFeel: () => void;
  onToggleSun: () => void;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const minutesOf = (hhmm: string | null | undefined) => {
  const m = hhmm?.match(/(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
};

export function DayDetail({ store, station, date, today, metric, onMetric, onOpenFeel, onToggleSun }: Props) {
  const feel = useContext(FeelContext);
  const openSummary = useContext(DaySummaryContext);
  const day = store?.getDay(station, date);
  const row = day?.state === "ready" ? (day.row ?? null) : null;
  const hours = store?.getHours(station, date);
  const rows = hours?.state === "ready" ? hours.rows : null;
  const ty = useTyphoonOn()(date);
  const typhoon = ty === "none" || ty === "unknown" ? null : ty;
  const comment = useMemo(() => dayComment({ row, other: null, otherName: null, hours: rows, typhoon }), [row, rows, typhoon]);
  const conf = confidenceOfRow(row);
  const max = num(row?.max);
  const min = num(row?.min);
  // 暫定の日：いまの値の出どころ・待っているもの・確定の見込み（shared/provisionalNote.ts）
  // ふだんは「暫定 ⓘ」だけ。ⓘ で開く（ほかの説明と同じ InfoNote の形、2026-11-18 渡辺さん）。
  const prov = day?.state === "ready" ? provisionalNote(row, date, today, day.kind === "fixed") : null;
  const [provOpen, setProvOpen] = useState(false);

  return (
    <section className="day-detail" aria-label="1日の詳しい様子">
      <div className="dd-hero">
        <span className="dd-pic">{row ? <DayWeatherIcon row={row} station={station} size={52} /> : <span className="skeleton icon" />}</span>
        <span className="dd-temps">
          <span className="tone-hot">{max == null ? "—" : max.toFixed(1)}</span>
          <span className="dd-slash">/</span>
          <span className="tone-cold">{min == null ? "—" : min.toFixed(1)}</span>
          <small>℃</small>
        </span>
        <span className="dd-kind">
          {kindLabel(store, station, date)}
          {conf && <Conf value={conf} />}
          {prov && (
            <button className="info-btn" onClick={() => setProvOpen(!provOpen)} aria-expanded={provOpen} aria-label={provOpen ? "暫定の説明を閉じる" : "暫定の説明を開く"}>
              ⓘ
            </button>
          )}
        </span>
      </div>
      {comment.length > 0 && <p className="dd-say">{comment.join("")}</p>}
      {prov && provOpen && (
        <div className="dd-prov">
          <p className="dd-prov-lead">暫定：まだ確定していない値です</p>
          <dl>
            <dt>いまの値</dt>
            <dd>{prov.source}</dd>
            <dt>待っているもの</dt>
            <dd>
              {/* 待っているものは1行に1つ（「、」でつなぐと読み分けにくい、2026-11-18 本番の見た目） */}
              {prov.waiting.map((w) => (
                <span key={w} className="dd-prov-item">
                  {w}
                </span>
              ))}
            </dd>
            <dt>確定の見込み</dt>
            <dd>{prov.when}</dd>
          </dl>
        </div>
      )}

      <div className="dd-sec">
        <SectionHead title="1日の流れ" as="h3" />
        <SunLine store={store} station={station} date={date} today={today} />
        <Parts store={store} station={station} date={date} />
        <HourFace
          store={store}
          station={station}
          target={date}
          compareDate={null}
          metric={metric}
          today={today}
          height={200}
          summary={false}
          onToggleSun={onToggleSun}
        />
      </div>

      <div className="dd-sec">
        <SectionHead title="この日の値" as="h3">
          <small className="dd-hint">押すと上のグラフがその項目に</small>
        </SectionHead>
        <div className="dd-values">
          <FeelTile rows={rows} station={station} onOpen={onOpenFeel} />
          {METRICS.map((m) => {
            const series = tableSeries(m, row?.type !== "forecast");
            const h = m.needsHours ? rows : null;
            const shown = series.map((s) => ({ s, text: row ? formatValue(s.value(row, h, feel, station), s.unit ?? m.unit) : "" }));
            const main = shown.filter((x) => !x.s.minor).slice(0, 2);
            const rest = shown.filter((x) => !main.includes(x));
            return (
              <button key={m.id} className={m.id === metric ? "dd-value on" : "dd-value"} onClick={() => onMetric(m.id)} aria-pressed={m.id === metric}>
                <span className="dd-value-name">
                  {m.label}
                  <em>{main.map((x) => x.s.label).join(" / ")}</em>
                </span>
                <span className="dd-value-num">
                  {main.map((x, i) => (
                    <span key={x.s.key}>
                      {i > 0 && <small className="dd-slash">/</small>}
                      <span className={`tone-${x.s.tone}`}>{x.text || "—"}</span>
                    </span>
                  ))}
                  <small>{m.unit}</small>
                </span>
                {rest.length > 0 && (
                  <span className="dd-value-note">
                    {rest
                      .filter((x) => x.text && x.text !== "—")
                      .map((x) => `${x.s.tableLabel ?? x.s.label} ${x.text}${x.s.unit && x.s.unit !== m.unit ? x.s.unit : ""}`)
                      .join("・")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dd-sec">
        <SectionHead title="根拠と記録" as="h3" />
        {/* この日の値の出どころは、その値の話の始めに（下の天気図の出どころと取り違えないように、2026-11-18）。 */}
        <p className="dd-basis">
          <span>出どころ</span>
          {row?.type === "forecast" ? `気象庁の予報${conf ? `（${CONF_TEXT[conf]}）` : ""}` : `気象庁の観測（${kindLabel(store, station, date) || "—"}）`}
        </p>
        <MyReports station={station} date={date} />
        <h4 className="dd-sub">この日の予報の移り変わり</h4>
        <ForecastHistoryPanel store={store} station={station} date={date} />
        <WxChart date={date} today={today} />
        <div className="dd-links">
          {openSummary != null && (
            <Chip size="sm" onClick={() => openSummary({ date, other: null })}>
              その日の要約{typhoon ? "・台風" : ""}
            </Chip>
          )}
          <Chip size="sm" onClick={onOpenFeel}>
            肌感マップ
          </Chip>
        </div>
      </div>
    </section>
  );
}

/** 日の出・日の入り・昼の長さ: the day's own, as the 時間帯 sheet reads them. */
function SunLine({ store, station, date, today }: { store: WeatherStore | null; station: string; date: string; today: string }) {
  const sun = useSun(station, date, today, store?.getDay(station, date).row);
  const e = useMemo(() => dayEdges(date, station), [date, station]);
  // The station's own published times when there are any; else the sun's, computed (the parts' own).
  const rise = minutesOf(sun?.sunrise) ?? e.rise;
  const set = minutesOf(sun?.sunset) ?? e.set;
  const len = Math.round(set - rise);
  return (
    <p className="dd-sun">
      <span>
        日の出 <b>{clockOf(rise)}</b>
      </span>
      <span>
        日の入り <b>{clockOf(set)}</b>
      </span>
      <span>
        昼の長さ <b>{`${Math.floor(len / 60)}時間${len % 60}分`}</b>
      </span>
    </p>
  );
}

/** The five 時間帯 (by the sun): each its weather and mean temperature; a tap opens its hours. */
function Parts({ store, station, date }: { store: WeatherStore | null; station: string; date: string }) {
  const feel = useContext(FeelContext);
  const [open, setOpen] = useState<number | null>(null);
  const hours = store?.getHours(station, date);
  const rows = hours?.state === "ready" ? hours.rows : [];
  const parts = useMemo(() => dayParts(date, station), [date, station]);
  const e = useMemo(() => dayEdges(date, station), [date, station]);
  // A new day closes the hours that were open (they were the other day's).
  const [shownFor, setShownFor] = useState(date);
  if (shownFor !== date) {
    setShownFor(date);
    setOpen(null);
  }
  if (!rows.length) return <p className="dd-hint">時間ごとの値を読み込み中…</p>;
  const temp = hourSeries(rows, "temp", feel, station);
  const prob = hourSeries(rows, "probability", feel, station);
  const rain = hourSeries(rows, "rain", feel, station);
  const wind = hourSeries(rows, "wind", feel, station);
  const feels = hourSeries(rows, "feel", feel, station);
  const at = (series: typeof temp, n: number) => series[n - 1]?.v ?? null;
  const mean = (ns: number[], s: typeof temp) => {
    const v = ns.map((n) => at(s, n)).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const peak = (ns: number[], s: typeof temp) => {
    const v = ns.map((n) => at(s, n)).filter((x): x is number => x != null);
    return v.length ? Math.max(...v) : null;
  };
  const anyProb = prob.some((p) => p.v != null);
  return (
    <div className="dd-parts-wrap">
      <div className="dd-parts" role="group" aria-label="時間帯（押すと1時間ごと）">
        {parts.map((p, i) => {
          const ns = hoursIn(p);
          const wx = hoursWeather(rows, ns, station, 1);
          const mid = (p.from + p.to) / 2;
          const t = mean(ns, temp);
          const pr = peak(ns, prob);
          return (
            <button key={p.id} className={open === i ? "dd-part on" : "dd-part"} aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              <small>{p.label}</small>
              <span className={wx.estimated ? "weather-estimated" : undefined}>{wx.text ? <WeatherIcon text={wx.text} size={20} night={mid < e.rise || mid > e.set} /> : "—"}</span>
              <b className="tone-temp">{t == null ? "—" : `${Math.round(t)}°`}</b>
              {anyProb && <span className="tone-rain dd-prob">{pr == null ? "" : `${Math.round(pr)}%`}</span>}
            </button>
          );
        })}
      </div>
      {open != null && (
        <div className="dd-hours">
          <div className="dd-hours-head">
            <b>
              {parts[open].label}（{clockOf(parts[open].from)}〜{clockOf(parts[open].to)}）
            </b>
            <button className="chip sm" onClick={() => setOpen(null)}>
              閉じる
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th />
                <th />
                <th>℃</th>
                <th>mm</th>
                {anyProb && <th>%</th>}
                <th>m/s</th>
                <th>肌感</th>
              </tr>
            </thead>
            <tbody>
              {hoursIn(parts[open]).map((n) => {
                const wx = hoursWeather(rows, [n], station, 1);
                const f = at(feels, n);
                const level = f == null ? null : levelOf(f, feel);
                return (
                  <tr key={n}>
                    <td className="dd-h">{n}時</td>
                    <td>{wx.text ? <WeatherIcon text={wx.text} size={18} night={n * 60 < e.rise || n * 60 > e.set} /> : "—"}</td>
                    <td className="tone-temp">{formatValue(at(temp, n), "℃")}</td>
                    <td className="tone-rain">{formatValue(at(rain, n), "mm")}</td>
                    {anyProb && <td className="tone-rain">{at(prob, n) == null ? "—" : `${at(prob, n)}%`}</td>}
                    <td className="tone-wind">{formatValue(at(wind, n), "m/s")}</td>
                    <td className="dd-feel">
                      {level == null ? (
                        "—"
                      ) : (
                        <>
                          <i style={{ background: levelColor(level, feel.scale) }} />
                          {levelName(level, feel.scale)}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <small className="dd-hint">時間帯の区切りは太陽の高さで決まります（{feel.sun ? "肌感は日なた" : "肌感は日かげ"}）。</small>
        </div>
      )}
    </div>
  );
}

/** 肌感 first among the values: the app's own subject. The day's daytime feel, as the table's bar reads it. */
function FeelTile({ rows, station, onOpen }: { rows: ReturnType<WeatherStore["getHours"]>["rows"] | null; station: string; onOpen: () => void }) {
  const feel = useContext(FeelContext);
  const temp = METRICS.find((m) => m.id === "temp")!;
  const s = temp.series.find((x) => x.key === "feel");
  const v = s && rows?.length ? s.value(null, rows, feel, station) : null;
  const level = v == null ? null : levelOf(v, feel);
  return (
    <button className="dd-value" onClick={onOpen}>
      <span className="dd-value-name">
        肌感
        <em>{feel.sun ? "日なた・日中" : "日かげ・日中"}</em>
      </span>
      <span className="dd-value-num">
        {level == null ? (
          "—"
        ) : (
          <>
            <i className="dd-swatch" style={{ background: levelColor(level, feel.scale) }} />
            {levelName(level, feel.scale)}
          </>
        )}
      </span>
      <span className="dd-value-note">押すと肌感マップ</span>
    </button>
  );
}

/** The person's own reports of the day (kept on this device and synced when logged in). */
function MyReports({ station, date }: { station: string; date: string }) {
  const all = useReports();
  const jst = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString();
  const mine = (all ?? []).filter((r) => r.station === station && jst(r.at).slice(0, 10) === date).sort((a, b) => (a.at < b.at ? -1 : 1));
  return (
    <p className="dd-basis">
      <span>自分の記録</span>
      {all == null
        ? "…"
        : mine.length === 0
          ? "なし"
          : mine
              .map((r) => {
                const t = jst(r.at).slice(11, 16);
                const s = SENSATIONS.find((x) => x.value === r.sensation)?.label ?? "";
                const ex = r.exposure ? EXPOSURES.find((x) => x.id === r.exposure)?.label : null;
                return `${t}「${s}」${ex ? ex : ""}`;
              })
              .join("・")}
    </p>
  );
}


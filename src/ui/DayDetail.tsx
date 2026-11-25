// 1日モード (#247): the selected day on its own.
// 2026-11-24 渡辺さん「1日画面の情報量の多さ、気温・空・大気など他の画面と表示内容が被っている」：
//   - 数字は上の表だけ（同じ日の同じ値を何か所にも出さない）。見出しは天気と一言と出どころ（札・ⓘ）。
//   - その下は、帯で選んだ仲間のものだけ：
//       気温：24時間のグラフ → 今日はここまで／このあと（最高・最低）→ 時間帯の気温 → 肌感
//       空・光：日の出・日の入り・昼の長さ → 24時間のグラフ
//       雨・風：今日は雨の見込み → 24時間のグラフ → 今日はここまで／このあと（降水・風）→ 時間帯の降水確率
//       大気：24時間のグラフ
//     グラフは1本で、見出しはグラフの「24時間」だけ（今日の「ここまで／このあと」の小さい線はやめた）。項目を選ぶのは下の帯だけ（項目の札8つはやめた）。
//   - 根拠と記録（自分の記録・予報の移り変わり・天気図・その日の要約）は、ふだん畳んでおく。
// Nothing here is computed anew: the values, hours, parts and words are the ones the comparison
// screens already use (chartMetrics, dayDetail, dayParts, dayComment).

import { dayFigure, dayHighLow, isJmaForecastDay, jmaValue, OM_BIAS_NOTE, rangeSource, SOURCE_TEXT, sourceTag, valueSource } from "../sourceTag";
import { JmaForecastLink, OpenMeteoCredit } from "./SourceCredit";
import { SECTORS, windSummary } from "../../shared/windDirection";
import { nowValues, summaryLines } from "../daySummaryLines";
import type { WeatherRow } from "../../shared/types";
import type { FeelSettings } from "../../shared/feel";
import { Fragment, type ReactNode, useContext, useMemo, useRef, useState } from "react";
import { clockOf, dayEdges, dayParts, hoursIn } from "../../shared/dayParts";
import { hoursWeather } from "../../shared/dayWeather";
import { provisionalNote } from "../../shared/provisionalNote";
import { levelOf } from "../../shared/feel";
import { SENSATIONS, EXPOSURES } from "../beta/reports";
import { useReports } from "../beta/useReports";
import { dayComment } from "../data/dayComment";
import type { WeatherStore } from "../data/store";
import { useTyphoonOn } from "../data/typhoonDays";
import { hourSeries } from "../dayDetail";
import { formatValue, METRICS, type MetricId } from "../metrics";
import { kindLabel } from "./CompareBoard";
import { DaySummaryContext } from "./daySummaryPress";
import { FeelContext, levelColor, levelName } from "./FeelBar";
import { HourFace } from "./HourFace";
import { shownClock, shownDayLength, shownSun } from "../data/sun";
import { Button, Chip, Conf, CONF_TEXT, confidenceOfRow, Fold, Glyph } from "./kit";
import { ITEM_GROUPS } from "./ItemBar";
import { addDays } from "../../shared/dates";
import { DayWeatherIcon, WeatherIcon } from "./WeatherIcon";
import { WxChart } from "./WxChart";
import { RainNowBoard } from "./rainNow/RainNowBoard";
import { RainNowCard } from "./rainNow/RainNowCard";
import { ForecastHistoryPanel } from "./forecastHistory/ForecastHistory";
import { RainWindHistory } from "./forecastHistory/RainWindHistory";
import { useForecastHistory } from "../data/historyCache";
import { pickIssue } from "../data/forecastPick";
import { headlineChange, shownChanges } from "../../shared/forecastChanges";
import { ForecastHistory as HistoryModel } from "../../shared/forecastHistoryModel";
import { TodaySplit } from "./TodaySplit";
import { AirQualityCard } from "./AirQualityCard";
import { airInRange, useAir } from "../data/air";
import { airSummaryText } from "../airSummary";

interface Props {
  store: WeatherStore | null;
  station: string;
  date: string;
  today: string;
  metric: MetricId;
  /** まとめ（帯の先頭）を見ているか。 */
  summary: boolean;

  /** まとめの行を押した：その仲間の項目へ。 */
  onPickItem: (id: MetricId) => void;
  /** まとめの空気の行を押した：空気の画面へ。 */
  onPickAirq: () => void;
  onOpenFeel: () => void;
  onToggleSun: () => void;
}


export function DayDetail({ store, station, date, today, metric, summary, onPickItem, onPickAirq, onOpenFeel, onToggleSun }: Props) {
  const openSummary = useContext(DaySummaryContext);
  const day = store?.getDay(station, date);
  const row = day?.state === "ready" ? (day.row ?? null) : null;
  const hours = store?.getHours(station, date);
  const rows = hours?.state === "ready" ? hours.rows : null;
  const ty = useTyphoonOn()(date);
  const typhoon = ty === "none" || ty === "unknown" ? null : ty;
  const comment = useMemo(() => dayComment({ row, other: null, otherName: null, hours: rows, typhoon }), [row, rows, typhoon]);
  const conf = confidenceOfRow(row);
  // 今日：過ぎた時間は観測、これからは予報。「ここまで／このあと」は時間の値で分ける（TodaySplit）。
  // 見出しの最高・最低は表と同じ日の行の値（2026-11-24 渡辺さん「揃えてください」：時間ごとから計算し直すと気象庁の値と食い違う）。
  const { max, min } = dayHighLow(row);
  // 暫定の日：いまの値の出どころ・待っているもの・確定の見込み（shared/provisionalNote.ts）
  // ふだんは「暫定 ⓘ」だけ。ⓘ で開く（ほかの説明と同じ InfoNote の形、2026-11-18 渡辺さん）。
  const prov = day?.state === "ready" ? provisionalNote(row, date, today, day.kind === "fixed") : null;
  const [provOpen, setProvOpen] = useState(false);
  // この日の値の出どころは ⓘ で開く（2026-11-18 渡辺さん「出どころは ⓘ でいい」）。暫定の日は待っているものも。
  // 雨の見込みは「今」のものなので、今日の 1日モードにだけ（RainNowCard）。押すと地図のシート。
  const [rainOpen, setRainOpen] = useState(false);
  // 出どころ（予報の出典、2026-11-23）：予報の日は項目ごとに（気象庁のどの発表か、Open-Meteo か）。実績の日は札の説明。
  const tag = day?.state === "ready" ? sourceTag(row, day.kind) : "";
  // 気象庁の値に手を入れた所（降水確率の選び・寒暖差）は「Weather Note が…」と分けて書く。Open-Meteo はリンクとライセンス（FS-02）。
  const range = rangeSource(row);
  const om = (what: string) => (
    <>
      <OpenMeteoCredit />
      {what}
    </>
  );
  const fromJma = (text: string) => (text.startsWith("Open-Meteo") ? om(text.slice("Open-Meteo".length)) : text);
  const sources: [string, ReactNode][] =
    row?.type === "forecast"
      ? [
          ["天気", fromJma(valueSource(row, "dayWeather")!)],
          ["最高・最低", fromJma([...new Set([valueSource(row, "max")!, valueSource(row, "min")!])].join("／"))],
          ...(range ? ([["寒暖差", range]] as [string, ReactNode][]) : []),
          ["降水確率", fromJma(valueSource(row, "probability")!)],
          ...(conf
            ? ([
                [
                  "信頼度",
                  isJmaForecastDay(row) ? `${valueSource(row, "confidence")}（${CONF_TEXT[conf]}）` : om(`のアンサンブル（ECMWF IFS）から Weather Note が計算（${CONF_TEXT[conf]}）`),
                ],
              ] as [string, ReactNode][])
            : []),
          ["そのほか", om("：平均・雨の量・湿度・風 など、気象庁の予報に無い値")],
          // 補完の日（最高も Open-Meteo）：低めに出やすい目安（比べた地点だけ）。
          ...(!jmaValue(row, "max") && OM_BIAS_NOTE[station] ? ([["目安", OM_BIAS_NOTE[station]]] as [string, ReactNode][]) : []),
          ...(isJmaForecastDay(row) ? ([["気象庁", <JmaForecastLink key="jma" />]] as [string, ReactNode][]) : []),
        ]
      : [["出どころ", tag ? SOURCE_TEXT[tag] : "—"]];

  // 帯で選んだ仲間（src/ui/ItemBar.tsx）。まとめ（summary）は帯の先頭、1日を開いたときはいつもここから（2026-11-24）。
  const group = summary ? "summary" : (ITEM_GROUPS.find((g) => g.items.includes(metric))?.id ?? "temp");
  // 根拠と記録の開け閉め：仲間（とその日）ごと。ほかの仲間や日に移ると畳んだところから（中身が違うので）。
  const [basisFor, setBasisFor] = useState<string | null>(null);
  const basisOpen = basisFor === `${group}/${date}`;
  const setBasisOpen = (open: boolean) => setBasisFor(open ? `${group}/${date}` : null);
  // 風の、表に無い値（主な風向・まとまり・静穏。16方位の最頻値、2026-11-22 渡辺さん）は雨・風のグラフの下に1行。
  const wind = group === "rainwind" && rows?.length ? windSummary(rows) : null;
  const windNote =
    wind && (wind.n || wind.calm)
      ? [`主な風向 ${wind.mode != null ? SECTORS[wind.mode] : "定まらない"}`, ...(wind.r != null ? [`まとまり ${wind.r.toFixed(2)}`] : []), ...(wind.calm ? [`静穏 ${wind.calm}時間`] : [])].join("・")
      : "";
  // 今日の夜の冷え込みは、明日の朝の最低で言う（表の明日の最低と同じ値・同じ書き方、2026-11-24 渡辺さん C）。
  const next = date === today ? store?.getDay(station, addDays(date, 1)) : null;
  const nextRow = next?.state === "ready" ? next.row : null;
  const nextLow = dayHighLow(nextRow).min;
  const nextMin = nextLow == null ? null : dayFigure(nextRow, "min", nextLow);
  const feelSettings = useContext(FeelContext);
  const sunTimes = useMemo(() => shownSun(date, station), [date, station]);
  const latest = date === today ? (store?.getLatest(station) ?? null) : null;
  // 空気（11/25）：まとめの空気の行に PM2.5 の日平均と黄砂の最大（CAMS）。持っていない日は行を出さない。読み込み中・
  // 取れなかった・無いは、そう言う（無いことを「少ない」とは言わない）。空気の画面は AirQualityCard が読む。
  const air = useAir(station, date, group === "summary");
  const airText = !airInRange(date, today) || air.unsupported ? null : air.r ? (airSummaryText(air.r) ?? "PM2.5・黄砂のデータはありません") : air.failed ? "PM2.5・黄砂を取れませんでした" : "PM2.5・黄砂は読み込み中…";
  const lines = summaryLines({
    air: airText,
    row,
    hours: rows,
    feelWord: dayFeelWord(rows, station, feelSettings),
    nextMin,
    sun: { rise: shownClock(sunTimes.rise), set: shownClock(sunTimes.set) },
    past: date < today,
    today: date === today,
    hourNow: date === today ? new Date(Date.now() + 9 * 3_600_000).getUTCHours() : undefined,
    // 今日は「このあと」の予報の様子（観測だけ先に届いても、予報を待っているなら読み込み中）。
    hoursState:
      date === today && store
        ? store.forecastState(station)
        : hours?.state === "ready"
          ? "ready"
          : hours?.state === "error"
            ? "error"
            : store?.hoursComing(station, date)
              ? "loading"
              : "none",
    now: latest ? { temp: typeof latest.temp === "number" ? latest.temp : null, rain: typeof latest.rain === "number" ? latest.rain : null, at: typeof latest.observedAt === "string" ? latest.observedAt : null } : null,
  });
  // 予報の変化のいちばん大事な1つ（まとめの見出しの下、2026-11-24 見本の①）。押すと根拠と記録の「この日の予報の変化」へ。
  const history = useForecastHistory(station, date, group === "summary");
  const headline = useMemo(() => {
    if (!history.r?.supported) return null;
    const now = `${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;
    return headlineChange(shownChanges(new HistoryModel(history.r).slots(date, now)));
  }, [history.r, date]);
  const basisRef = useRef<HTMLDivElement>(null);

  if (group === "summary")
    return (
      <section className="day-detail" aria-label="1日のまとめ" data-group="summary">
        {/* 見出し：天気と一言と出どころ。数字は上の表だけ（2026-11-24）。 */}
        <div className="dd-hero">
          <span className="dd-pic">{row ? <DayWeatherIcon row={row} station={station} size={44} /> : <span className="skeleton icon" />}</span>
          <p className="dd-say">{comment.length > 0 ? comment.join("") : row ? "" : "…"}</p>
          <span className="dd-kind">
            {kindLabel(store, station, date)}
            {conf && <Conf value={conf} />}
            {row && (
              <button className="info-btn" onClick={() => setProvOpen(!provOpen)} aria-expanded={provOpen} aria-label={provOpen ? "出どころの説明を閉じる" : "出どころの説明を開く"}>
                ⓘ
              </button>
            )}
          </span>
        </div>
        {!prov && provOpen && row && (
          <div className="dd-prov plain">
            <dl>
              {sources.map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        )}
        {prov && provOpen && (
          <div className="dd-prov">
            <p className="dd-prov-lead">{tag || "暫定"}：まだ確定していない値です</p>
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

        {headline && (
          <Button
            kind="quiet"
            className={`dd-change ${headline.kind}`}
            onClick={() => {
              // その発表を選んで開く（変わる前と後を、上の枠・グラフ・一覧で見比べられるように、2026-11-24）。
              pickIssue(station, date, headline.key);
              setBasisOpen(true);
              requestAnimationFrame(() => basisRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
            }}
          >
            <span>
              {headline.when}
              <b>{headline.what}</b>
            </span>
            <small>{headline.detail}</small>
            <Glyph name="next" />
          </Button>
        )}

        {/* 仲間ごとに1行。押すとその仲間の画面へ。今日の雨の行には雨雲レーダー。 */}
        <div className="dd-sum" role="list" aria-label="項目ごとのまとめ">
          {lines.map((l) => (
            <div key={l.label} className="dd-sum-row" role="listitem">
              <Button kind="quiet" className="dd-sum-line" onClick={() => (l.group === "airq" ? onPickAirq() : onPickItem(ITEM_GROUPS.find((g) => g.id === l.group)!.items[l.label === "風" ? 1 : 0] as MetricId))} aria-label={`${l.label}：${l.text}。押すと${l.label}の画面`}>
                <span className="dd-sum-label">{l.label}</span>
                <span className="dd-sum-text">{l.text}</span>
                <Glyph name="next" />
              </Button>
              {l.label === "雨" && date === today && (
                <Chip size="sm" onClick={() => setRainOpen(true)}>
                  雨雲レーダー
                </Chip>
              )}
            </div>
          ))}
        </div>
        {rainOpen && <RainNowBoard station={station} onClose={() => setRainOpen(false)} />}

        {/* まとめの根拠と記録：天気図・予報の移り変わり・その日の要約（2026-11-24 渡辺さん、項目ごとに見直し）。 */}
        <div className="dd-sec dd-basis-sec" ref={basisRef}>
          <Fold open={basisOpen} onToggle={() => setBasisOpen(!basisOpen)} openLabel="根拠と記録（予報の移り変わり・天気図・その日の要約）" closeLabel="根拠と記録を閉じる">
            <h4 className="dd-sub">この日の予報の移り変わり</h4>
            <ForecastHistoryPanel store={store} station={station} date={date} chart={(issued) => <WxChart date={date} today={today} issued={issued} />} />
            <div className="dd-links">
              {openSummary != null && (
                <Chip size="sm" onClick={() => openSummary({ date, other: null })}>
                  その日の要約{typhoon ? "・台風" : ""}
                </Chip>
              )}
            </div>
          </Fold>
        </div>
      </section>
    );

  // 空気（帯の後ろ、11/25「項目を分けませんか」→「いっそのこと統合」）：PM2.5・黄砂・視程を1つの画面に（AirQualityCard）。
  if (group === "airq")
    return (
      <section className="day-detail" aria-label="1日の空気" data-group={group}>
        <div className="dd-sec">
          <AirQualityCard station={station} date={date} today={today} hours={rows} latest={latest} />
        </div>
      </section>
    );

  return (
    <section className="day-detail" aria-label="1日の詳しい様子" data-group={group}>
      {/* いまの値：その仲間の項目だけ（今日、2026-11-24 渡辺さん「今の気温や湿度は個別の項目別として切り出す」）。 */}
      {latest && <NowCard latest={latest} group={group} />}

      {group === "rainwind" && date === today && (
        <div className="dd-sec">
          <RainNowCard station={station} onOpen={() => setRainOpen(true)} />
        </div>
      )}
      {rainOpen && <RainNowBoard station={station} onClose={() => setRainOpen(false)} />}

      <div className="dd-sec dd-flow">
        {group === "sky" && <SunLine station={station} date={date} />}
        <HourFace store={store} station={station} target={date} compareDate={null} metric={metric} today={today} height={200} summary={false} onToggleSun={onToggleSun} />
        {windNote && <p className="dd-note">{windNote}</p>}
        {date === today && (group === "temp" || group === "rainwind") && <TodaySplit rows={rows} station={station} day={{ max, min }} group={group} nextMin={nextMin} />}
        {(group === "temp" || group === "rainwind") && <Parts store={store} station={station} date={date} show={group === "temp" ? "temp" : "prob"} />}
        {group === "temp" && <FeelLine rows={rows} station={station} onOpen={onOpenFeel} />}
      </div>

      {/* 根拠と記録は、その項目に関係するものだけ（2026-11-24）：気温は自分の記録（肌感）、雨・風は降水確率と風の予報の移り変わり。
          天気・最高・最低の移り変わりと天気図はまとめに。空・光・大気は気象庁の予報に無い項目なので置かない。 */}
      {group === "rainwind" && (
        <div className="dd-sec dd-basis-sec">
          <Fold open={basisOpen} onToggle={() => setBasisOpen(!basisOpen)} openLabel="根拠と記録（降水確率と風の予報の移り変わり）" closeLabel="根拠と記録を閉じる">
            <RainWindHistory station={station} date={date} />
          </Fold>
        </div>
      )}
      {group === "temp" && (
        <div className="dd-sec dd-basis-sec">
          <Fold open={basisOpen} onToggle={() => setBasisOpen(!basisOpen)} openLabel="根拠と記録（自分の記録）" closeLabel="根拠と記録を閉じる">
            <MyReports station={station} date={date} />
          </Fold>
        </div>
      )}
    </section>
  );
}

/** 日中の肌感の言葉（表の肌感・肌感の1行と同じ、chartMetrics の気温の feel）。 */
function dayFeelWord(rows: WeatherRow[] | null, station: string, feel: FeelSettings): string | null {
  const temp = METRICS.find((m) => m.id === "temp")!;
  const s = temp.series.find((x) => x.key === "feel");
  const v = s && rows?.length ? s.value(null, rows, feel, station) : null;
  return v == null ? null : levelName(levelOf(v, feel), feel.scale);
}

function NowCard({ latest, group }: { latest: WeatherRow; group: string }) {
  const { at, items } = nowValues(latest, group);
  if (!items.length) return null;
  return (
    <div className="dd-now" role="group" aria-label="いまの値">
      <p className="dd-now-head">いま{at ? <small>{at} 観測</small> : null}</p>
      <div className="dd-now-vals">
        {items.map((x) => (
          <span key={x.key} className="dd-now-val">
            <small>{x.label}</small>
            <b className={`tone-${x.tone}`}>{x.text}</b>
            <small>
              {x.unit}
              {x.note ? `・${x.note}` : ""}
            </small>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 日の出・日の入り・昼の長さ：画面はどこも計算の値（src/data/sun.ts shownSun、2026-11-19）。 */
function SunLine({ station, date }: { station: string; date: string }) {
  const s = useMemo(() => shownSun(date, station), [date, station]);
  const len = shownDayLength(s);
  return (
    <p className="dd-sun">
      <span>
        日の出 <b>{shownClock(s.rise)}</b>
      </span>
      <span>
        日の入り <b>{shownClock(s.set)}</b>
      </span>
      <span>
        昼の長さ <b>{`${Math.floor(len / 60)}時間${len % 60}分`}</b>
      </span>
    </p>
  );
}

/** The five 時間帯 (by the sun): each its weather and mean temperature; a tap opens its hours. */
function Parts({ store, station, date, show }: { store: WeatherStore | null; station: string; date: string; show: "temp" | "prob" }) {
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
              {show === "temp" ? <b className="tone-temp">{t == null ? "—" : `${Math.round(t)}°`}</b> : <b className="tone-rain">{pr == null ? "—" : `${Math.round(pr)}%`}</b>}
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
function FeelLine({ rows, station, onOpen }: { rows: ReturnType<WeatherStore["getHours"]>["rows"] | null; station: string; onOpen: () => void }) {
  const feel = useContext(FeelContext);
  const temp = METRICS.find((m) => m.id === "temp")!;
  const s = temp.series.find((x) => x.key === "feel");
  const v = s && rows?.length ? s.value(null, rows, feel, station) : null;
  const level = v == null ? null : levelOf(v, feel);
  return (
    <button className="dd-feel-line" onClick={onOpen} aria-label={`肌感（${feel.sun ? "日なた" : "日かげ"}・日中）${level == null ? "—" : levelName(level, feel.scale)}。押すと肌感マップ`}>
      <small>
        肌感<span className="dd-feel-when">{feel.sun ? "日なた・日中" : "日かげ・日中"}</span>
      </small>
      {level == null ? (
        <b>—</b>
      ) : (
        <b>
          <i className="dd-swatch" style={{ background: levelColor(level, feel.scale) }} />
          {levelName(level, feel.scale)}
        </b>
      )}
      <span className="dd-feel-go">
        肌感マップ
        <Glyph name="next" />
      </span>
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


// 見本（sample/month、マージしない）: 月の振り返り — a month beside the same month a year before, from the
// records only: the month in words, its numbers, each day's 最高〜最低, 肌感 by time band, and the days
// that stood out. Opened with ?month=YYYY-MM.

import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { dayEdges, dayParts, hoursIn, PARTS, type PartId } from "../../shared/dayParts";
import { SCALE_STEPS } from "../../shared/feel";
import { stormOfRow } from "../../shared/storm";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { niceTicks, num, signedDiff, tickLabel } from "../design/format";
import { barLook, barPath, DATA, FEEL_SCALE_COLORS, lineLook, SHAPE } from "../design/tokens";
import { bandsFor, FeelBar, FeelContext } from "./FeelBar";
import { DayWeatherIcon } from "./WeatherIcon";
import { dayTone } from "../../shared/holidays";
import { BarSample, Chip, GraphReadout, LineSample, type ReadoutRow, SectionHead, Segmented } from "./kit";
import { ModalSheet } from "./ModalSheet";
import { summaryAttr, useDaySummaryPress } from "./daySummaryPress";
import { feelOn } from "../feelSeason";
import { clusterDays } from "./monthClusters";

/** 前年同曜日: 52 weeks back. */
const PREV_SAME_WEEKDAY = 364;
const daysOf = (month: string) => {
  const first = `${month}-01`;
  const out: string[] = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
};
const yearBefore = (month: string) => `${+month.slice(0, 4) - 1}${month.slice(4)}`;
const label = (month: string) => `${+month.slice(0, 4)}年${+month.slice(5)}月`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);

interface MonthStats {
  rows: (WeatherRow | null)[];
  temp: number | null;
  max: number | null;
  min: number | null;
  rain: number | null;
  rainDays: number;
  sun: number | null;
  hot30: number;
  hot25: number;
  frost: number;
  storm: number;
}
/**
 * A day's values over the chosen time bands only (from its hours): rain and sunshine added up, the
 * temperature's mean, highest and lowest. All bands chosen: the day's own row, as recorded.
 */
function rowIn(store: WeatherStore | null, station: string, date: string, parts: ReadonlySet<PartId> | null): WeatherRow | null {
  const row = store?.getDay(station, date).row ?? null;
  if (!parts || !row) return row;
  const h = store?.getHours(station, date);
  if (h?.state !== "ready" || !h.rows.length) return null;
  const want = new Set(dayParts(date, station).filter((p) => parts.has(p.id)).flatMap((p) => hoursIn(p)));
  const hs = h.rows.filter((r) => want.has(r.n));
  const v = (k: string) => hs.map((r) => num(r[k])).filter((x): x is number => x != null);
  const t = v("temp");
  return { ...row, rain: sum(v("rain")), sun: sum(v("sun")), temp: mean(t), max: t.length ? Math.max(...t) : null, min: t.length ? Math.min(...t) : null };
}

function statsOf(store: WeatherStore | null, station: string, days: string[], parts: ReadonlySet<PartId> | null = null): MonthStats {
  const rows = days.map((d) => rowIn(store, station, d, parts));
  const vals = (k: string) => rows.map((r) => num(r?.[k])).filter((v): v is number => v != null);
  return {
    rows,
    temp: mean(vals("temp")),
    max: mean(vals("max")),
    min: mean(vals("min")),
    rain: sum(vals("rain")),
    rainDays: vals("rain").filter((v) => v >= 1).length,
    sun: sum(vals("sun")),
    hot30: vals("max").filter((v) => v >= 30).length,
    hot25: vals("max").filter((v) => v >= 25).length,
    frost: vals("min").filter((v) => v < 0).length,
    storm: rows.filter((r) => stormOfRow(r)).length,
  };
}

export function MonthReview({ store, station, month, onClose, layout = "list" }: { store: WeatherStore | null; station: string; month: string; onClose: () => void; layout?: "list" | "calendar" | "combo" | "tabs" }) {
  const feel = useContext(FeelContext);
  const before = yearBefore(month);
  const days = daysOf(month);
  // 前年同曜日 everywhere (2026-11-16): each day against the day 52 weeks before, so a Saturday
  // always meets a Saturday — the month, the chosen days, the graphs and the day's card alike.
  const daysB = days.map((d) => addDays(d, -PREV_SAME_WEEKDAY));
  useEffect(() => {
    store?.prefetch(station, [...days, ...daysB], "month", Priority.Visible);
    store?.wantHours(station, [...days, ...daysB], Priority.Visible, "month");
    return () => store?.wantHours(station, [], Priority.Visible, "month");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, station, month]);
  // 時間帯で絞る（案C）: null = all bands (the day as recorded).
  const [parts, setParts] = useState<ReadonlySet<PartId> | null>(null);
  const toggle = (id: PartId) => {
    const next = new Set(parts ?? PARTS.map((p) => p.id));
    if (parts == null) {
      next.clear();
      next.add(id);
    } else if (!next.delete(id)) next.add(id);
    setParts(next.size === 0 || next.size === PARTS.length ? null : next);
  };
  const partsLabel = parts == null ? "1日" : PARTS.filter((p) => parts.has(p.id)).map((p) => p.label).join("・");
  // 日を選ぶ（案D）: the numbers (the line, the tiles, the table, the standouts) over the chosen days
  // only, against the same dates a year before; the pictures (graph, calendar, weekdays, 肌感) keep
  // the whole month. Empty = the whole month.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const sel = picked.size ? days.filter((d) => picked.has(d)) : days;
  // Chosen days are set against the same weekday a year before (前年同曜日: 364 days back, the app's
  // pairing), so 土日 meets 土日; the whole month against the same month.
  const selB = sel.map((d) => addDays(d, -PREV_SAME_WEEKDAY));
  const a = statsOf(store, station, sel, parts);
  const b = statsOf(store, station, selB, parts);
  const full = picked.size ? statsOf(store, station, days, parts) : a;
  const fullB = picked.size ? statsOf(store, station, daysB, parts) : b;
  /** Choose or drop days: when every one of them is chosen already, they are dropped; else all chosen. */
  const pickDays = (ds: string[]) => {
    const next = new Set(picked);
    if (ds.every((d) => next.has(d))) ds.forEach((d) => next.delete(d));
    else ds.forEach((d) => next.add(d));
    setPicked(next);
  };
  const f1 = (v: number | null, u = "") => (v == null ? "—" : `${v.toFixed(1)}${u}`);
  const d1 = (x: number | null, y: number | null, unit: string) => signedDiff(x, y, unit);
  const cnt = (n: number) => `${n}日`;
  const monthDates = { a: `’${month.slice(2, 4)}/${+month.slice(5)}`, b: "前年同曜日" };
  const rows: ReadoutRow[] = [
    { key: "temp", label: "平均気温", unit: "℃", color: DATA.mean, a: f1(a.temp), b: f1(b.temp), diff: d1(a.temp, b.temp, "℃") },
    { key: "max", label: "最高の平均", unit: "℃", color: DATA.hot, a: f1(a.max), b: f1(b.max), diff: d1(a.max, b.max, "℃") },
    { key: "min", label: "最低の平均", unit: "℃", color: DATA.cold, a: f1(a.min), b: f1(b.min), diff: d1(a.min, b.min, "℃") },
    { key: "rain", label: "降水の合計", unit: "mm", color: DATA.rain, a: f1(a.rain), b: f1(b.rain), diff: d1(a.rain, b.rain, "mm") },
    { key: "rainDays", label: "雨の日（1mm以上）", text: true, unit: "", a: cnt(a.rainDays), b: cnt(b.rainDays), diff: `${a.rainDays - b.rainDays >= 0 ? "+" : "−"}${Math.abs(a.rainDays - b.rainDays)}` },
    { key: "sun", label: "日照の合計", unit: "h", color: DATA.sun, a: f1(a.sun), b: f1(b.sun), diff: d1(a.sun, b.sun, "h") },
    { key: "hot25", label: "夏日（25℃以上）", text: true, unit: "", a: cnt(a.hot25), b: cnt(b.hot25), diff: `${a.hot25 - b.hot25 >= 0 ? "+" : "−"}${Math.abs(a.hot25 - b.hot25)}` },
    { key: "hot30", label: "真夏日（30℃以上）", text: true, unit: "", a: cnt(a.hot30), b: cnt(b.hot30), diff: `${a.hot30 - b.hot30 >= 0 ? "+" : "−"}${Math.abs(a.hot30 - b.hot30)}` },
  ];
  // The month in words: from the numbers above only.
  const words: string[] = [];
  if (a.temp != null && b.temp != null) {
    const dt = a.temp - b.temp;
    words.push(Math.abs(dt) < 0.5 ? `平均気温は ${a.temp.toFixed(1)}℃ で、${label(before)}とほぼ同じ。` : `平均気温は ${a.temp.toFixed(1)}℃ で、${label(before)}より ${Math.abs(dt).toFixed(1)}℃ ${dt > 0 ? "高い" : "低い"}。`);
  }
  if (a.rain != null && b.rain != null) words.push(`雨は ${a.rainDays}日・${a.rain.toFixed(0)}mm（${label(before)}は ${b.rainDays}日・${b.rain.toFixed(0)}mm）。`);
  if (a.sun != null && b.sun != null && b.sun > 0) {
    const r = a.sun / b.sun;
    words.push(r > 1.1 ? `日差しは多め（日照 ${a.sun.toFixed(0)}時間、${r.toFixed(1)}倍）。` : r < 0.9 ? `日差しは少なめ（日照 ${a.sun.toFixed(0)}時間、${r.toFixed(1)}倍）。` : `日差しは同じくらい（日照 ${a.sun.toFixed(0)}時間）。`);
  }
  // The days that stood out.
  const pick = (score: (r: WeatherRow, i: number) => number | null, best: "max" | "min") => {
    let at = -1;
    let v: number | null = null;
    a.rows.forEach((r, i) => {
      if (!r) return;
      const s = score(r, i);
      if (s == null) return;
      if (v == null || (best === "max" ? s > v : s < v)) {
        v = s;
        at = i;
      }
    });
    return at < 0 ? null : { date: sel[at], v: v! };
  };
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
  const standouts = [
    { label: "いちばん暑い日", p: pick((r) => num(r.max), "max"), fmt: (v: number) => `最高 ${v.toFixed(1)}℃`, color: DATA.hot },
    { label: "いちばん寒い日", p: pick((r) => num(r.min), "min"), fmt: (v: number) => `最低 ${v.toFixed(1)}℃`, color: DATA.cold },
    { label: "寒暖差がいちばん大きい日", p: pick((r) => (num(r.max) != null && num(r.min) != null ? num(r.max)! - num(r.min)! : null), "max"), fmt: (v: number) => `${v.toFixed(1)}℃`, color: DATA.mean },
    {
      label: "前の日からいちばん変わった日",
      p: pick((r, i) => (i > 0 && a.rows[i - 1] && num(r.max) != null && num(a.rows[i - 1]!.max) != null ? Math.abs(num(r.max)! - num(a.rows[i - 1]!.max)!) : null), "max"),
      fmt: (v: number) => `最高が ${v.toFixed(1)}℃ 変化`,
      color: DATA.mean,
    },
    { label: "雨がいちばん多い日", p: pick((r) => num(r.rain), "max"), fmt: (v: number) => `${v.toFixed(1)}mm`, color: DATA.rain },
  ];

  // One line in words, no numbers (the numbers are in the tiles just under it): how the month leaned.
  const lean: string[] = [];
  if (a.temp != null && b.temp != null) lean.push(Math.abs(a.temp - b.temp) < 0.5 ? "気温は前年並み" : a.temp > b.temp ? "前年より暖かく" : "前年より涼しく");
  if (a.rain != null && b.rain != null) lean.push(Math.abs(a.rain - b.rain) < Math.max(5, b.rain * 0.15) ? "雨は同じくらい" : a.rain > b.rain ? "雨は多め" : "雨は少なめ");
  if (a.sun != null && b.sun != null && b.sun > 0) lean.push(a.sun / b.sun > 1.1 ? "日差しは多め" : a.sun / b.sun < 0.9 ? "日差しは少なめ" : "日差しは同じくらい");
  const [tab, setTab] = useState<"sum" | "days" | "feel">("sum");
  const [metric, setMetric] = useState<MonthMetricId>("temp");
  // The day the card reads: where the finger last was (at first the month's last day).
  const [focusDay, setFocusDay] = useState(days.length - 1);
  const dowOf = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekend = days.filter((d) => dowOf(d) >= 5);
  const weekdays = days.filter((d) => dowOf(d) < 5);
  /** Exactly these days chosen (a quick button), or the whole month again when they already are. */
  const seriesA = metric === "daylight" ? days.map((d) => sunRow(d, station)) : full.rows;
  const seriesB = metric === "daylight" ? daysB.map((d) => sunRow(d, station)) : fullB.rows;
  const pickOnly = (ds: string[]) => setPicked(picked.size === ds.length && ds.every((d) => picked.has(d)) ? new Set() : new Set(ds));
  if (layout === "tabs") {
    const marks = new Map<string, string>();
    for (const s of standouts) if (s.p && !marks.has(s.p.date) && s.color !== DATA.mean) marks.set(s.p.date, s.color);
    return (
      <ModalSheet title={`${label(month)}の振り返り`} label={`${label(month)}の振り返り`} onClose={onClose} size="full" className="day-summary-sheet month-review">
        {/* 案D ページを分ける: 上は どのページでも同じ（時間帯・まとめの数字）、下を4つのページに。 */}
        <div className="month-parts chip-row" role="group" aria-label="時間帯で絞る">
          <Chip size="sm" on={parts == null} onClick={() => setParts(null)}>
            1日
          </Chip>
          {PARTS.map((p) => (
            <Chip key={p.id} size="sm" on={parts?.has(p.id) ?? false} onClick={() => toggle(p.id)}>
              {p.label}
            </Chip>
          ))}
        </div>
        <div className="ds-lead month-head">
          <p className="month-lean">
            {picked.size > 0 && (
              <button className="month-picked" onClick={() => setPicked(new Set())} aria-label="選んだ日を外す">
                選んだ {picked.size}日 ×
              </button>
            )}
            {parts != null && <small>{partsLabel}　</small>}
            {lean.join("、")}。<small>（前年同曜日と比べて）</small>
          </p>
          <div className="month-tiles">
            <Tile name="平均気温" value={a.temp} unit="℃" other={b.temp} digits={1} color={DATA.mean} />
            <Tile name="雨" value={a.rain} unit="mm" other={b.rain} digits={0} color={DATA.rain} note={`${a.rainDays}日`} />
            <Tile name="日照" value={a.sun} unit="時間" other={b.sun} digits={0} color={DATA.sun} />
          </div>
        </div>
        <div className="month-tabs">
          <Segmented
            label="振り返りのページ"
            value={tab}
            options={[
              { id: "sum", label: "まとめ" },
              { id: "days", label: "日ごと" },
              { id: "feel", label: "肌感" },
            ]}
            onChange={setTab}
          />
        </div>
        {tab === "sum" && (
          <>
            <GraphReadout title={`${picked.size ? `選んだ ${picked.size}日` : "月"}の値${parts == null ? "" : `（${partsLabel}）`}`} unit="" dates={picked.size ? { a: "", b: "前年同曜日" } : monthDates} rows={rows.filter((r) => !["temp", "rain", "sun"].includes(r.key))} />
            <SectionHead title={picked.size ? `選んだ ${picked.size}日のレポート` : "月のレポート"} />
            <MonthReport store={store} station={station} days={sel} rows={a.rows} rowsB={b.rows} picked={picked.size > 0} />
            <SectionHead title="曜日の傾向" />
            <div className="ds-hours">
              <WeekDetail store={store} station={station} days={days} rows={full.rows} rowsB={fullB.rows} picked={picked} onPick={pickDays} />
            </div>
            <SectionHead title="天気の型" />
            <div className="ds-hours">
              <DayTypes days={days} rows={full.rows} rowsB={fullB.rows} picked={picked} onPick={pickOnly} />
            </div>
            <SectionHead title="目立った日" />
            <div className="ds-hours month-standouts">
              {standouts.map((s) => (
                <p key={s.label} className="month-standout">
                  <span>{s.label}</span>
                  <b>{s.p ? md(s.p.date) : "—"}</b>
                  <em style={{ color: s.color }}>{s.p ? s.fmt(s.p.v) : ""}</em>
                </p>
              ))}
            </div>
          </>
        )}
        {tab === "days" && (
          <>
            <div className="ds-hours">
              <div className="month-metric chip-row" role="group" aria-label="グラフの項目">
                {MONTH_METRICS.map((m) => (
                  <Chip key={m.id} size="sm" on={metric === m.id} tone={DATA[m.tone]} onClick={() => setMetric(m.id)}>
                    {m.label}
                  </Chip>
                ))}
              </div>
              <DayCard m={metric === "temp" ? null : MONTH_METRICS.find((x) => x.id === metric)!} date={days[focusDay]} dateB={daysB[focusDay] ?? null} a={seriesA[focusDay]} b={seriesB[focusDay] ?? null} />
              {metric === "temp" ? (
                <MonthRange a={full.rows} b={fullB.rows} picked={picked} days={days} focus={focusDay} onFocus={setFocusDay} />
              ) : (
                <MonthSeries m={MONTH_METRICS.find((x) => x.id === metric)!} a={seriesA} b={seriesB} picked={picked} days={days} focus={focusDay} onFocus={setFocusDay} />
              )}
              <MonthLegend kind={metric === "temp" ? "range" : MONTH_METRICS.find((x) => x.id === metric)!.kind} color={DATA[MONTH_METRICS.find((x) => x.id === metric)!.tone]} now={label(month)} then="前年同曜日" />
            </div>
            <div className="month-quick chip-row" role="group" aria-label="まとめて選ぶ">
              <Chip size="sm" on={picked.size === 0} onClick={() => setPicked(new Set())}>
                月全体
              </Chip>
              <Chip size="sm" on={picked.size === weekdays.length && weekdays.every((d) => picked.has(d))} onClick={() => pickOnly(weekdays)}>
                平日
              </Chip>
              <Chip size="sm" on={picked.size === weekend.length && weekend.every((d) => picked.has(d))} onClick={() => pickOnly(weekend)}>
                土日
              </Chip>
            </div>
            <MonthCalendar store={store} station={station} days={days} rows={full.rows} marks={marks} picked={picked} onPick={pickDays} />
            <p className="month-cal-legend">日・週（左）・曜日（上）でも選べる（複数可）。上の数字とまとめは選んだ日だけ、前年同曜日と比べる。</p>
          </>
        )}
        {tab === "feel" && (
          <div className="ds-hours">
            <FeelMonth store={store} station={station} days={days} daysB={daysB} />
          </div>
        )}
      </ModalSheet>
    );
  }
  if (layout === "combo") {
    // The standouts marked on the calendar too: the day's colour round its square.
    const marks = new Map<string, string>();
    for (const s of standouts) if (s.p && !marks.has(s.p.date) && s.color !== DATA.mean) marks.set(s.p.date, s.color);
    return (
      <ModalSheet title={`${label(month)}の振り返り`} label={`${label(month)}の振り返り`} onClose={onClose} size="full" className="day-summary-sheet month-review">
        {/* 案C 組み合わせ: まとめ（文章＋3つの数字）→ カレンダー（目立った日に印）→ 曜日ごと → 肌感の月 → 目立った日 */}
        <div className="month-parts chip-row" role="group" aria-label="時間帯で絞る">
          <Chip size="sm" on={parts == null} onClick={() => setParts(null)}>
            1日
          </Chip>
          {PARTS.map((p) => (
            <Chip key={p.id} size="sm" on={parts?.has(p.id) ?? false} onClick={() => toggle(p.id)}>
              {p.label}
            </Chip>
          ))}
        </div>
        <div className="ds-lead">
          <p className="ds-comment">
            {parts != null && <span className="month-parts-note">{partsLabel}の値（時間ごとの記録から）</span>}
            {words.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </p>
          <div className="month-tiles">
            <Tile name="平均気温" value={a.temp} unit="℃" other={b.temp} digits={1} color={DATA.mean} />
            <Tile name="雨" value={a.rain} unit="mm" other={b.rain} digits={0} color={DATA.rain} note={`${a.rainDays}日`} />
            <Tile name="日照" value={a.sun} unit="時間" other={b.sun} digits={0} color={DATA.sun} />
          </div>
        </div>
        {/* The rest of the month's numbers (the three above are not repeated), then each day's 最高〜最低. */}
        <GraphReadout title={`月の値${parts == null ? "" : `（${partsLabel}）`}`} unit="" dates={monthDates} rows={rows.filter((r) => !["temp", "rain", "sun"].includes(r.key))} />
        <SectionHead title="日ごとの気温（最高〜最低）" />
        <div className="ds-hours">
          <MonthRange a={a.rows} b={b.rows} />
          <RangeLegend now={label(month)} then="前年同曜日" />
        </div>
        <SectionHead title="カレンダー" />
        <MonthCalendar store={store} station={station} days={days} rows={a.rows} marks={marks} />
        <p className="month-cal-legend">数字は 最高／最低（℃）。帯は肌感（朝〜夜）、水色の数字は降水 mm（1mm以上の日）。色の枠は下の「目立った日」。</p>
        <SectionHead title="曜日ごと" />
        <div className="ds-hours">
          <Weekdays station={station} days={days} rows={a.rows} daysB={daysB} rowsB={b.rows} />
        </div>
        <SectionHead title={`肌感（${feel.sun ? "日なた" : "日かげ"}）の月`} />
        <div className="ds-hours">
          <FeelMonth store={store} station={station} days={days} daysB={daysB} />
        </div>
        <SectionHead title="目立った日" />
        <div className="ds-hours month-standouts">
          {standouts.map((s) => (
            <p key={s.label} className="month-standout">
              <span>{s.label}</span>
              <b>{s.p ? md(s.p.date) : "—"}</b>
              <em style={{ color: s.color }}>{s.p ? s.fmt(s.p.v) : ""}</em>
            </p>
          ))}
        </div>
      </ModalSheet>
    );
  }
  if (layout === "calendar")
    return (
      <ModalSheet title={`${label(month)}の振り返り`} label={`${label(month)}の振り返り`} onClose={onClose} size="full" className="day-summary-sheet month-review">
        {/* 案B カレンダー型: 3つの数字 → その月のカレンダー（毎日の天気・最高/最低・肌感・雨）→ 一言 */}
        <div className="ds-lead month-tiles">
          <Tile name="平均気温" value={a.temp} unit="℃" other={b.temp} digits={1} color={DATA.mean} />
          <Tile name="雨" value={a.rain} unit="mm" other={b.rain} digits={0} color={DATA.rain} note={`${a.rainDays}日`} />
          <Tile name="日照" value={a.sun} unit="時間" other={b.sun} digits={0} color={DATA.sun} />
        </div>
        <MonthCalendar store={store} station={station} days={days} rows={a.rows} />
        <p className="month-cal-legend">数字は 最高／最低（℃）。帯は肌感（朝〜夜）、水色の数字は降水 mm（1mm以上の日）。</p>
        <div className="ds-hours">
          <p className="ds-comment">
            {words.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </p>
        </div>
      </ModalSheet>
    );
  return (
    <ModalSheet title={`${label(month)}の振り返り`} label={`${label(month)}の振り返り`} onClose={onClose} size="full" className="day-summary-sheet month-review">
      <div className="ds-lead">
        <p className="ds-comment">
          {words.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </p>
      </div>
      <GraphReadout title="月の値" unit="" dates={monthDates} rows={rows} />
      <SectionHead title="日ごとの気温（最高〜最低）" />
      <div className="ds-hours">
        <MonthRange a={a.rows} b={b.rows} />
        <p className="line-legend">
          <span>
            <svg className="line-sample" width="10" height="14" aria-hidden>
              <rect x="2" y="1" width="6" height="12" rx="3" fill={DATA.hot} />
            </svg>
            {label(month)}
          </span>
          <span>
            <svg className="line-sample" width="10" height="14" aria-hidden>
              <rect x="2" y="1" width="6" height="12" rx="3" fill="none" stroke={DATA.hot} strokeWidth={1.4} opacity={0.8} />
            </svg>
            {label(before)}
          </span>
        </p>
      </div>
      <SectionHead title={`肌感（${feel.sun ? "日なた" : "日かげ"}）の月`} />
      <div className="ds-hours">
        <FeelMonth store={store} station={station} days={days} daysB={daysB} />
      </div>
      <SectionHead title="目立った日" />
      <div className="ds-hours month-standouts">
        {standouts.map((s) => (
          <p key={s.label} className="month-standout">
            <span>{s.label}</span>
            <b>{s.p ? md(s.p.date) : "—"}</b>
            <em style={{ color: s.color }}>{s.p ? s.fmt(s.p.v) : ""}</em>
          </p>
        ))}
      </div>
    </ModalSheet>
  );
}

/** Each day's 最高〜最低 as a round bar: the month filled (最高の色から最低の色へ), the year before outlined beside it. */
function MonthRange({ a, b, picked, days, focus, onFocus }: { a: (WeatherRow | null)[]; b: (WeatherRow | null)[]; picked?: ReadonlySet<string>; days?: string[] } & Scrub) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = 150;
  const PAD = { left: 24, right: 4, top: 6, bottom: 18 };
  const vals = [...a, ...b].flatMap((r) => [num(r?.max), num(r?.min)]).filter((v): v is number => v != null);
  if (!vals.length) return <div ref={ref} />;
  const lo = Math.floor(Math.min(...vals) / 5) * 5;
  const hi = Math.ceil(Math.max(...vals) / 5) * 5;
  const n = Math.max(a.length, b.length);
  const step = (w - PAD.left - PAD.right) / n;
  const bw = Math.min(SHAPE.range.maxWidth, step * 0.38);
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += hi - lo > 20 ? 10 : 5) ticks.push(t);
  const cap = (cx: number, mx: number, mn: number) => ({ x: cx - bw / 2, y: y(mx), width: bw, height: Math.max(bw, y(mn) - y(mx)), rx: bw / 2 });
  const dim = dimOf(picked, days);
  return (
    <div ref={ref}>
      <svg width={w} height={H} role="img" aria-label="日ごとの最高〜最低" className="month-scrub" {...scrubHandlers(PAD.left, step, n, onFocus)}>
        <defs>
          <linearGradient id="month-range" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={DATA.hot} />
            <stop offset="1" stopColor={DATA.cold} />
          </linearGradient>
        </defs>
        <PickedBands picked={picked} days={days} x={x} step={step} top={PAD.top} bottom={H - PAD.bottom} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.left - 4} y={y(t) + 4} className="chart-tick" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => {
          const ra = a[i];
          const rb = b[i];
          return (
            <g key={i} opacity={dim(i) ? DIM : 1}>
              {num(rb?.max) != null && num(rb?.min) != null && <rect {...cap(x(i) + bw * 0.45, num(rb!.max)!, num(rb!.min)!)} fill="none" stroke="url(#month-range)" strokeWidth={1.1} opacity={0.7} />}
              {num(ra?.max) != null && num(ra?.min) != null && <rect {...cap(x(i) - bw * 0.45, num(ra!.max)!, num(ra!.min)!)} fill="url(#month-range)" />}
            </g>
          );
        })}
        <FocusGuide x={focus == null ? null : x(focus)} top={PAD.top} bottom={H - PAD.bottom} />
        {[1, 5, 10, 15, 20, 25, 30].filter((d) => d <= n).map((d) => (
          <text key={d} x={x(d - 1)} y={H - 4} className="chart-tick" textAnchor="middle">
            {d}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** 肌感 by time band over the month: for each band, how many days fell in each step (the month above, the year before below). */
function FeelMonth({ store, station, days, daysB }: { store: WeatherStore | null; station: string; days: string[]; daysB: string[] }) {
  const base = useContext(FeelContext);
  const scale = base.scale ?? 7;
  const steps = SCALE_STEPS[scale];
  const count = (ds: string[]) =>
    PARTS.map((_, pi) =>
      steps.map((_, si) =>
        ds.filter((d) => {
          const found = bandsFor(store, station, d, feelOn(store, station, d, base));
          const lv = found?.exact ? found.bands[pi]?.level : null;
          return lv != null && steps[si].of.includes(lv);
        }).length,
      ),
    );
  const a = count(days);
  const b = count(daysB);
  const bar = (c: number[], thin: boolean) => {
    const total = c.reduce((x, y) => x + y, 0);
    if (!total) return <span className={`month-feel-bar${thin ? " thin" : ""} empty`} />;
    return (
      <span className={`month-feel-bar${thin ? " thin" : ""}`}>
        {c.map((k, i) => (k ? <i key={i} style={{ flex: k, background: FEEL_SCALE_COLORS[scale][i] }} title={`${steps[i].label} ${k}日`} /> : null))}
      </span>
    );
  };
  return (
    <div className="month-feel">
      {PARTS.map((p, pi) => (
        <div key={p.id} className="month-feel-row">
          <span className="month-feel-name">{p.label}</span>
          <span className="month-feel-bars">
            {bar(a[pi], false)}
            {bar(b[pi], true)}
          </span>
        </div>
      ))}
      <p className="line-legend">
        {steps.map((s, i) => (
          <span key={s.label}>
            <i style={{ background: FEEL_SCALE_COLORS[scale][i], width: 10, height: 10, borderRadius: 2 }} />
            {s.label}
          </span>
        ))}
      </p>
      <p className="chart-key-note">太い帯がこの月、細い帯が前の年の同じ月。帯の長さはその段の日数。</p>
    </div>
  );
}

/** A month's number, big, with the year before's difference under it. */
function Tile({ name, value, unit, other, digits, color, note }: { name: string; value: number | null; unit: string; other: number | null; digits: number; color: string; note?: string }) {
  return (
    <div className="month-tile">
      <small>{name}</small>
      <b style={{ color }}>
        {value == null ? "—" : value.toFixed(digits)}
        <span className="unit">{unit}</span>
      </b>
      <em>
        {note ? `${note}・` : ""}前年 {signedDiff(value, other, unit) || "—"}
      </em>
    </div>
  );
}

const WEEK = ["月", "火", "水", "木", "金", "土", "日"];
/** The month as a calendar: each day its weather, 最高／最低, its 肌感 band and its rain. */
function MonthCalendar({
  store,
  station,
  days,
  rows,
  marks,
  picked,
  onPick,
}: {
  store: WeatherStore | null;
  station: string;
  days: string[];
  rows: (WeatherRow | null)[];
  marks?: Map<string, string>;
  /** Choosing days: the chosen ones, and a call with the days a tap chooses (a day, a week, a weekday). */
  picked?: ReadonlySet<string>;
  onPick?: (days: string[]) => void;
}) {
  const lead = (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, k) => cells.slice(k * 7, k * 7 + 7));
  const pickable = !!onPick;
  const press = useDaySummaryPress();
  const on = (ds: string[]) => ds.length > 0 && ds.every((d) => picked?.has(d));
  const day = (d: string) => {
    const i = days.indexOf(d);
    const r = rows[i];
    const mx = num(r?.max);
    const mn = num(r?.min);
    const rain = num(r?.rain);
    const chosen = picked?.has(d);
    const body = (
      <>
        <span className={`month-cal-date tone-${dayTone(d)}`}>{+d.slice(8)}</span>
        <span className="month-cal-icon">{r ? <DayWeatherIcon row={r} station={station} size={18} /> : null}</span>
        <span className="month-cal-temp">
          <i style={{ color: DATA.hot }}>{mx == null ? "—" : mx.toFixed(0)}</i>
          <i style={{ color: DATA.cold }}>{mn == null ? "—" : mn.toFixed(0)}</i>
        </span>
        <span className="month-cal-feel">
          <FeelBar store={store} station={station} date={d} />
        </span>
        <span className="month-cal-rain">{rain != null && rain >= 1 ? rain.toFixed(0) : ""}</span>
      </>
    );
    const style = marks?.has(d) ? { boxShadow: `0 0 0 1.5px ${marks.get(d)} inset` } : undefined;
    return pickable ? (
      // A long press opens the day's summary (#176, as everywhere a day's picture is), beside 前年同曜日.
      <button key={d} className={`month-cal-day${chosen ? " picked" : picked?.size ? " muted" : ""}`} style={style} onClick={() => onPick!([d])} aria-pressed={!!chosen} {...summaryAttr(d, addDays(d, -PREV_SAME_WEEKDAY))}>
        {body}
      </button>
    ) : (
      <div key={d} className="month-cal-day" style={style}>
        {body}
      </div>
    );
  };
  return (
    <div className={`month-cal${pickable ? " pickable" : ""}`} {...press}>
      {pickable && (
        <button className={`month-cal-pick corner${picked?.size ? "" : " on"}`} onClick={() => onPick!(picked?.size ? [...picked] : [])} aria-label="選んだ日をすべて外す">
          全
        </button>
      )}
      {WEEK.map((w, i) => {
        const col = weeks.map((wk) => wk[i]).filter((d): d is string => d != null);
        const cls = `month-cal-head${i === 5 ? " tone-saturday" : i === 6 ? " tone-holiday" : ""}`;
        return pickable ? (
          <button key={w} className={`${cls} month-cal-pick${on(col) ? " on" : ""}`} onClick={() => onPick!(col)} aria-label={`${w}曜日をまとめて選ぶ`} aria-pressed={on(col)}>
            {w}
          </button>
        ) : (
          <span key={w} className={cls}>
            {w}
          </span>
        );
      })}
      {weeks.map((wk, k) => {
        const ds = wk.filter((d): d is string => d != null);
        return (
          <Fragment key={k}>
            {pickable && (
              <button className={`month-cal-pick week${on(ds) ? " on" : ""}`} onClick={() => onPick!(ds)} aria-label={`${k + 1}週目をまとめて選ぶ`} aria-pressed={on(ds)}>
                {k + 1}
                <small>週</small>
              </button>
            )}
            {wk.map((d, i) => (d ? day(d) : <span key={`e${k}-${i}`} />))}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The month by day of the week (月〜日): each date's weather in a row, the mean 最高／最低 and the rain
 * days, each with the same weekdays of the month a year before under it (前年同曜日, as the app pairs
 * days). A line at the foot sets 土日 against the weekdays, both years.
 */
function Weekdays({ station, days, rows, daysB, rowsB }: { station: string; days: string[]; rows: (WeatherRow | null)[]; daysB: string[]; rowsB: (WeatherRow | null)[] }) {
  const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const byDow = (ds: string[], rs: (WeatherRow | null)[]) => WEEK.map((_, w) => ds.map((d, i) => ({ d, r: rs[i] })).filter((x) => dow(x.d) === w));
  const groups = byDow(days, rows);
  const groupsB = byDow(daysB, rowsB);
  const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
  const avg = (g: { r: WeatherRow | null }[], k: string) => mean(g.map((x) => num(x.r?.[k])).filter((v): v is number => v != null));
  const wet = (g: { r: WeatherRow | null }[]) => g.filter((x) => (num(x.r?.rain) ?? 0) >= 1).length;
  const ends = (gs: typeof groups) => ({ end: [...gs[5], ...gs[6]], mid: gs.slice(0, 5).flat() });
  const now = ends(groups);
  const then = ends(groupsB);
  return (
    <div className="month-week">
      <span className="month-week-h" />
      <span className="month-week-h">天気</span>
      <span className="month-week-h">最高</span>
      <span className="month-week-h">最低</span>
      <span className="month-week-h">雨の日</span>
      {groups.map((g, w) => {
        const gb = groupsB[w];
        const cell = (k: string, color: string) => {
          const v = avg(g, k);
          const vb = avg(gb, k);
          return (
            <span className="month-week-num">
              <i style={{ color }}>{f1(v)}</i>
              <small>{signedDiff(v, vb, "℃") || "—"}</small>
            </span>
          );
        };
        return (
          <Fragment key={WEEK[w]}>
            <b className={`month-week-name${w === 5 ? " tone-saturday" : w === 6 ? " tone-holiday" : ""}`}>{WEEK[w]}</b>
            <span className="month-week-icons">
              {g.map((x) => (
                <span key={x.d} title={x.d}>
                  {x.r ? <DayWeatherIcon row={x.r} station={station} size={15} /> : "—"}
                </span>
              ))}
            </span>
            {cell("max", DATA.hot)}
            {cell("min", DATA.cold)}
            <span className="month-week-num">
              <i>
                {wet(g)}/{g.length}
              </i>
              <small>
                前年 {wet(gb)}/{gb.length}
              </small>
            </span>
          </Fragment>
        );
      })}
      <p className="month-week-foot">
        <span>
          雨の日：土日 {wet(now.end)}/{now.end.length}・平日 {wet(now.mid)}/{now.mid.length}（前年 {wet(then.end)}/{then.end.length}・{wet(then.mid)}/{then.mid.length}）
        </span>
        <span>小さい数字は前年の同じ曜日との差と、前年の雨の日。</span>
      </p>
    </div>
  );
}

function RangeLegend({ now, then }: { now: string; then: string }) {
  return (
    <p className="line-legend">
      <span>
        <svg className="line-sample" width="10" height="14" aria-hidden>
          <rect x="2" y="1" width="6" height="12" rx="3" fill={DATA.hot} />
        </svg>
        {now}
      </span>
      <span>
        <svg className="line-sample" width="10" height="14" aria-hidden>
          <rect x="2" y="1" width="6" height="12" rx="3" fill="none" stroke={DATA.hot} strokeWidth={1.4} opacity={0.8} />
        </svg>
        {then}
      </span>
    </p>
  );
}


// ---- 日ごとのグラフ（項目を選ぶ） ------------------------------------------------------------------
type MonthMetricId = "temp" | "rain" | "sun" | "humidity" | "wind" | "pressure" | "daylight";
interface MonthMetric {
  id: MonthMetricId;
  label: string;
  key: string;
  unit: string;
  tone: keyof typeof DATA;
  /** bar: an amount from 0 (rain, sunshine); line: a level (humidity, wind, pressure). */
  kind: "bar" | "line";
  zero: boolean;
}
const MONTH_METRICS: MonthMetric[] = [
  { id: "temp", label: "気温", key: "max", unit: "℃", tone: "hot", kind: "line", zero: false },
  { id: "rain", label: "降水", key: "rain", unit: "mm", tone: "rain", kind: "bar", zero: true },
  { id: "sun", label: "日照", key: "sun", unit: "h", tone: "sun", kind: "bar", zero: true },
  { id: "humidity", label: "湿度", key: "humidity", unit: "%", tone: "humidity", kind: "line", zero: false },
  { id: "wind", label: "風速", key: "wind", unit: "m/s", tone: "wind", kind: "line", zero: true },
  { id: "pressure", label: "気圧", key: "pressure", unit: "hPa", tone: "pressure", kind: "line", zero: false },
  // 日の出・日の入り: worked out from the date and the station (shared/dayParts), not recorded.
  { id: "daylight", label: "昼の長さ", key: "daylen", unit: "h", tone: "sun", kind: "line", zero: false },
];

/** 日の出・日の入り of a day (minutes JST) and the day's length (h), as rows the month's graphs read. */
const sunRow = (d: string, station: string) => {
  const e = dayEdges(d, station);
  return { date: d, rise: e.rise, set: e.set, daylen: (e.set - e.rise) / 60 } as unknown as WeatherRow;
};
/** 6:05 from minutes. */
const hm = (min: number | null) => (min == null ? "—" : `${Math.floor(Math.round(min) / 60)}:${String(Math.round(min) % 60).padStart(2, "0")}`);
/** 11時間53分 from minutes. */
const hLong = (min: number) => `${Math.floor(Math.round(min) / 60)}時間${String(Math.round(min) % 60).padStart(2, "0")}分`;

/** The chosen days, a faint band behind each (what the numbers above are of). */
function PickedBands({ picked, days, x, step, top, bottom }: { picked?: ReadonlySet<string>; days?: string[]; x: (i: number) => number; step: number; top: number; bottom: number }) {
  if (!picked?.size || !days) return null;
  return (
    <g className="month-picked-bands">
      {days.map((d, i) => (picked.has(d) ? <rect key={d} x={x(i) - step / 2} y={top} width={step} height={bottom - top} rx={SHAPE.bar.radius} /> : null))}
    </g>
  );
}

/** A month of one item: amounts as bars (the month filled, the year before outlined), levels as lines (solid, dashed). */
function MonthSeries({ m, a, b, picked, days, focus, onFocus }: { m: MonthMetric; a: (WeatherRow | null)[]; b: (WeatherRow | null)[]; picked?: ReadonlySet<string>; days?: string[] } & Scrub) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = 160;
  // The unit sits above the axis, clear of the top tick.
  const PAD = { left: 30, right: 4, top: 18, bottom: 18 };
  const va = a.map((r) => num(r?.[m.key]));
  const vb = b.map((r) => num(r?.[m.key]));
  const vals = [...va, ...vb].filter((v): v is number => v != null);
  if (!vals.length) return <div ref={ref} className="month-empty">この月の値がありません</div>;
  const nice = niceTicks(m.zero ? 0 : Math.min(...vals), Math.max(...vals, m.zero ? 1 : -Infinity), 4);
  const lo = m.zero ? 0 : nice.lo;
  const hi = nice.hi;
  const n = Math.max(a.length, b.length);
  const step = (w - PAD.left - PAD.right) / n;
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const color = DATA[m.tone];
  const path = (vs: (number | null)[]) => {
    let d = "";
    let pen = false;
    vs.forEach((v, i) => {
      if (v == null) pen = false;
      else {
        d += `${pen ? "L" : "M"}${x(i)},${y(v)}`;
        pen = true;
      }
    });
    return d;
  };
  const la = lineLook("target", color);
  const lb = lineLook("compare", color);
  const bw = Math.min(SHAPE.range.maxWidth, step * 0.38);
  const dim = dimOf(picked, days);
  const anyPicked = !!picked?.size;
  return (
    <div ref={ref}>
      <svg width={w} height={H} role="img" aria-label={`日ごとの${m.label}`} className="month-scrub" {...scrubHandlers(PAD.left, step, n, onFocus)}>
        <PickedBands picked={picked} days={days} x={x} step={step} top={PAD.top} bottom={H - PAD.bottom} />
        {nice.ticks
          .filter((t) => t >= lo && t <= hi)
          .map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={PAD.left - 4} y={y(t) + 4} className="chart-tick" textAnchor="end">
                {tickLabel(t)}
              </text>
            </g>
          ))}
        <text x={2} y={10} className="chart-unit">
          {m.unit}
        </text>
        {m.kind === "bar" ? (
          <>
            {vb.map((v, i) => (v != null && v > 0 ? <path key={`b${i}`} d={barPath(x(i) + bw * 0.05, y(v), bw * 0.9, y(0) - y(v))} {...barLook("compare", color)} opacity={(dim(i) ? DIM : 1) * barLook("compare", color).opacity} /> : null))}
            {va.map((v, i) => (v != null && v > 0 ? <path key={`a${i}`} d={barPath(x(i) - bw * 0.95, y(v), bw * 0.9, y(0) - y(v))} {...barLook("target", color)} opacity={dim(i) ? DIM : 1} /> : null))}
          </>
        ) : (
          <>
            {/* With days chosen, the lines step back and the chosen days stand as dots on them. */}
            <path d={path(vb)} fill="none" stroke={lb.stroke} strokeWidth={lb.strokeWidth} strokeDasharray={lb.strokeDasharray} opacity={lb.opacity * (anyPicked ? DIM : 1)} strokeLinejoin="round" />
            <path d={path(va)} fill="none" stroke={la.stroke} strokeWidth={la.strokeWidth} opacity={la.opacity * (anyPicked ? DIM : 1)} strokeLinejoin="round" strokeLinecap="round" />
            {anyPicked &&
              va.map((v, i) =>
                v != null && !dim(i) ? (
                  <g key={`p${i}`}>
                    {vb[i] != null && <circle cx={x(i)} cy={y(vb[i]!)} r={2.4} fill="var(--surface-inset)" stroke={color} opacity={0.8} />}
                    <circle cx={x(i)} cy={y(v)} r={3} fill={color} />
                  </g>
                ) : null,
              )}
          </>
        )}
        <FocusGuide x={focus == null ? null : x(focus)} top={PAD.top} bottom={H - PAD.bottom} />
        {[1, 5, 10, 15, 20, 25, 30].filter((d) => d <= n).map((d) => (
          <text key={d} x={x(d - 1)} y={H - 4} className="chart-tick" textAnchor="middle">
            {d}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** The legend of the month's graph, in its own marks: round bars, amount bars or lines. */
function MonthLegend({ kind, color, now, then }: { kind: "range" | "bar" | "line"; color: string; now: string; then: string }) {
  if (kind === "range") return <RangeLegend now={now} then={then} />;
  return (
    <p className="line-legend">
      <span>
        {kind === "bar" ? <BarSample day="target" color={color} /> : <LineSample day="target" color={color} />}
        {now}
      </span>
      <span>
        {kind === "bar" ? <BarSample day="compare" color={color} /> : <LineSample day="compare" color={color} />}
        {then}
      </span>
    </p>
  );
}

// ---- なぞって日を読む ------------------------------------------------------------------------------
/** Unchosen days, when some are chosen: drawn at this strength (still there, a step back). */
const DIM = 0.3;
const dimOf = (picked?: ReadonlySet<string>, days?: string[]) => (i: number) => !!picked?.size && !!days && !picked.has(days[i]);

interface Scrub {
  /** The day read in the card above (its index), drawn as a guide. */
  focus?: number | null;
  /** A finger (or the mouse) on the graph: the day under it. */
  onFocus?: (i: number) => void;
}

/**
 * Sideways along the graph, the card above reads the day under the finger (as the daily graph's
 * long press does; here the graph does not pan, so a touch reads at once). Up and down still scroll.
 */
function scrubHandlers(left: number, step: number, n: number, onFocus?: (i: number) => void) {
  if (!onFocus) return {};
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onFocus(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - left) / step))));
  };
  return {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      at(e);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === "mouse" || e.buttons) at(e);
    },
  };
}

function FocusGuide({ x, top, bottom }: { x: number | null; top: number; bottom: number }) {
  return x == null ? null : <line x1={x} x2={x} y1={top} y2={bottom} className="guide-v" />;
}

/** The day's card over the month's graph: its values beside the same date a year before. */
function DayCard({ m, date, dateB, a, b }: { m: MonthMetric | null; date: string; dateB: string | null; a: WeatherRow | null; b: WeatherRow | null }) {
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
  const one = (label: string, key: string, unit: string, color: string): ReadoutRow => {
    const va = num(a?.[key]);
    const vb = num(b?.[key]);
    const d = unit === "%" || unit === "hPa" ? 0 : 1;
    return { key, label, unit, color, a: va == null ? "—" : va.toFixed(d), b: vb == null ? "—" : vb.toFixed(d), diff: signedDiff(va, vb, unit) };
  };
  const time = (label: string, key: string, color: string, long = false): ReadoutRow => {
    const va = num(a?.[key]);
    const vb = num(b?.[key]);
    // h:mm in the card (the long 11時間53分 does not fit beside its comparison).
    const f = (v: number | null) => (v == null ? "—" : hm(long ? v * 60 : v));
    const dm = va == null || vb == null ? null : Math.round((va - vb) * (long ? 60 : 1));
    return { key, label, unit: "", color, a: f(va), b: f(vb), diff: dm == null ? "" : dm === 0 ? "±0分" : `${dm > 0 ? "+" : "−"}${Math.abs(dm)}分` };
  };
  const rows =
    m == null
      ? [one("最高", "max", "℃", DATA.hot), one("最低", "min", "℃", DATA.cold)]
      : m.id === "daylight"
        ? [time("日の出", "rise", DATA.sun), time("日の入り", "set", DATA.sun), time("昼の長さ", "daylen", DATA.sun, true)]
        : [one(m.label, m.key, m.unit, DATA[m.tone])];
  return <GraphReadout title={dateLabelOf(date)} unit="" dates={{ a: md(date), b: dateB ? `’${dateB.slice(2, 4)}/${md(dateB)}` : undefined }} rows={rows} />;
}
const dateLabelOf = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}（${WEEK[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]}）`;

// ---- 月のレポート（まとめ） ---------------------------------------------------------------------------
const THIRDS: [string, number, number][] = [
  ["上旬", 1, 10],
  ["中旬", 11, 20],
  ["下旬", 21, 31],
];
/** A day counts as 晴れ with this much sunshine (h), as the hours' estimate leans (shared/dayWeather). */
const SUNNY_DAY_H = 6;

/** The longest run of days that pass `test`: its length and its first and last date. */
function longestRun(days: string[], rows: (WeatherRow | null)[], test: (r: WeatherRow) => boolean) {
  let best = { n: 0, from: "", to: "" };
  let n = 0;
  let from = "";
  days.forEach((d, i) => {
    const r = rows[i];
    // A run is of following dates: a gap in the chosen days ends it.
    if (n && addDays(days[i - 1], 1) !== d) n = 0;
    if (r && test(r)) {
      if (!n) from = d;
      n++;
      if (n > best.n) best = { n, from, to: d };
    } else n = 0;
  });
  return best;
}

/**
 * The month as a report: the thirds of the month (上旬・中旬・下旬) beside 前年同曜日, then a few lines per
 * topic (気温, 雨と日差し, 曜日, 肌感) — every number from the records shown elsewhere on the page.
 */
function MonthReport({ store, station, days, rows, rowsB, picked }: { store: WeatherStore | null; station: string; days: string[]; rows: (WeatherRow | null)[]; rowsB: (WeatherRow | null)[]; picked: boolean }) {
  const base = useContext(FeelContext);
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
  const vals = (rs: (WeatherRow | null)[], k: string) => rs.map((r) => num(r?.[k])).filter((v): v is number => v != null);
  // By the day of the month (the days may be a choice, not the whole month).
  const third = (rs: (WeatherRow | null)[], lo: number, hi: number) => rs.filter((_, i) => +days[i].slice(8) >= lo && +days[i].slice(8) <= hi);
  const thirds = THIRDS.map(([name, lo, hi]) => {
    const a = third(rows, lo, hi);
    const b = third(rowsB, lo, hi);
    return { name, max: mean(vals(a, "max")), maxB: mean(vals(b, "max")), min: mean(vals(a, "min")), minB: mean(vals(b, "min")), rain: sum(vals(a, "rain")), rainB: sum(vals(b, "rain")), sun: sum(vals(a, "sun")), sunB: sum(vals(b, "sun")) };
  });
  const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
  const f0 = (v: number | null) => (v == null ? "—" : v.toFixed(0));
  const d1 = (x: number | null, y: number | null, u: string) => signedDiff(x, y, u) || "—";

  // 気温: how the month went from its start to its end, and its extremes.
  const first = thirds[0].max;
  const last = thirds[2].max;
  const trend = first == null || last == null ? null : Math.abs(last - first) < 1 ? "月を通して大きな変化はなかった" : last < first ? `上旬から下旬へ ${(first - last).toFixed(1)}℃ 下がった` : `上旬から下旬へ ${(last - first).toFixed(1)}℃ 上がった`;
  const hot = vals(rows, "max").filter((v) => v >= 25).length;
  const hotB = vals(rowsB, "max").filter((v) => v >= 25).length;
  const spread = rows.map((r, i) => ({ d: days[i], v: num(r?.max) != null && num(r?.min) != null ? num(r!.max)! - num(r!.min)! : null })).filter((x) => x.v != null) as { d: string; v: number }[];
  const bigSpread = spread.filter((x) => x.v >= 10).length;

  // 雨と日差し: the longest wet and sunny runs, the wettest third.
  const wet = longestRun(days, rows, (r) => (num(r.rain) ?? 0) >= 1);
  const sunny = longestRun(days, rows, (r) => (num(r.sun) ?? 0) >= SUNNY_DAY_H);
  const wettest = [...thirds].sort((x, y) => (y.rain ?? 0) - (x.rain ?? 0))[0];
  const sunnyDays = vals(rows, "sun").filter((v) => v >= SUNNY_DAY_H).length;
  const sunnyDaysB = vals(rowsB, "sun").filter((v) => v >= SUNNY_DAY_H).length;

  // 曜日: the wettest weekday and the weekends.
  const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const wetOf = (rs: (WeatherRow | null)[], pick: (w: number) => boolean) => {
    const g = days.map((d, i) => ({ w: dow(d), r: rs[i] })).filter((x) => pick(x.w));
    return { n: g.filter((x) => (num(x.r?.rain) ?? 0) >= 1).length, of: g.length };
  };
  const byDow = WEEK.map((name, w) => ({ name, ...wetOf(rows, (x) => x === w) }));
  const wettestDow = [...byDow].sort((x, y) => y.n / Math.max(1, y.of) - x.n / Math.max(1, x.of))[0];

  // 日の出・日の入り: from the first day to the last, and how far the light moved (worked out, not recorded).
  const edges = days.map((d) => dayEdges(d, station));
  const edgesB = days.map((d) => dayEdges(addDays(d, -PREV_SAME_WEEKDAY), station));
  const sunLines: string[] = [];
  if (edges.length) {
    const e0 = edges[0];
    const e1 = edges[edges.length - 1];
    const len = (e: { rise: number; set: number }) => e.set - e.rise;
    const dl = Math.round(len(e1) - len(e0));
    const first = md(days[0]);
    const lastD = md(days[days.length - 1]);
    if (edges.length > 1) {
      sunLines.push(`日の出は ${hm(e0.rise)}（${first}）→ ${hm(e1.rise)}（${lastD}）、日の入りは ${hm(e0.set)} → ${hm(e1.set)}。`);
      sunLines.push(`昼の長さは ${hLong(len(e0))} → ${hLong(len(e1))}（${dl >= 0 ? "+" : "−"}${Math.abs(dl)}分）。`);
    } else sunLines.push(`日の出 ${hm(e0.rise)}、日の入り ${hm(e0.set)}、昼の長さ ${hLong(len(e0))}（${first}）。`);
    const shift = mean(edges.map((e, i) => len(e) - len(edgesB[i])));
    if (shift != null) sunLines.push(`前年同曜日は暦が1日ずれるだけなので、昼の長さの差は平均 ${Math.abs(shift).toFixed(1)}分。日の出入りは計算値（記録ではない）。`);
  }

  // 肌感: warm afternoons, cool mornings (the hourly bands, where they are in).
  const bandsOf = (i: number) => days.map((d) => bandsFor(store, station, d, feelOn(store, station, d, base))).map((f) => (f?.exact ? f.bands[i]?.level : null));
  const noon = bandsOf(2).filter((l): l is NonNullable<typeof l> => l != null);
  const morning = bandsOf(0).filter((l): l is NonNullable<typeof l> => l != null);
  const warmNoons = noon.filter((l) => l >= 4).length;
  const coolMornings = morning.filter((l) => l <= 2).length;

  const lines: [string, string[]][] = [
    [
      "気温",
      [
        trend ? `最高気温は${trend}（上旬 ${f1(first)}℃ → 下旬 ${f1(last)}℃）。` : "",
        `夏日（25℃以上）は ${hot}日、前年同曜日は ${hotB}日。`,
        bigSpread ? `寒暖差 10℃以上の日が ${bigSpread}日。` : "",
      ],
    ],
    [
      "雨と日差し",
      [
        wet.n ? `雨（1mm以上）がいちばん続いたのは ${wet.n}日（${md(wet.from)}${wet.n > 1 ? `〜${md(wet.to)}` : ""}）。雨がいちばん多かったのは${wettest.name}（${f0(wettest.rain)}mm）。` : "雨の日はなかった。",
        `日照 ${SUNNY_DAY_H}時間以上の晴れの日は ${sunnyDays}日（前年同曜日 ${sunnyDaysB}日）${sunny.n > 1 ? `、いちばん続いたのは ${sunny.n}日（${md(sunny.from)}〜${md(sunny.to)}）` : ""}。`,
      ],
    ],
    [
      "曜日",
      [
        wettestDow.n ? `雨の日がいちばん多いのは${wettestDow.name}曜（${wettestDow.n}/${wettestDow.of}日）。` : "",
      ],
    ],
    [
      "日の出・日の入り",
      sunLines,
    ],
    [
      "肌感",
      noon.length
        ? [`昼が「暖かい」以上だった日は ${warmNoons}/${noon.length}日、朝が「涼しい」以下だった日は ${coolMornings}/${morning.length}日。`]
        : ["時間ごとの記録がそろうと出ます。"],
    ],
  ];
  return (
    <div className="ds-hours month-report">
      <div className="month-thirds" role="table" aria-label="上旬・中旬・下旬（前年同曜日との差）">
        <span />
        <small>最高 ℃</small>
        <small>最低 ℃</small>
        <small>雨 mm</small>
        <small>日照 h</small>
        {thirds.map((t) => (
          <Fragment key={t.name}>
            <b>{t.name}</b>
            <span>
              <i style={{ color: DATA.hot }}>{f1(t.max)}</i>
              <em>{d1(t.max, t.maxB, "℃")}</em>
            </span>
            <span>
              <i style={{ color: DATA.cold }}>{f1(t.min)}</i>
              <em>{d1(t.min, t.minB, "℃")}</em>
            </span>
            <span>
              <i style={{ color: DATA.rain }}>{f0(t.rain)}</i>
              <em>{d1(t.rain, t.rainB, "mm")}</em>
            </span>
            <span>
              <i style={{ color: DATA.sun }}>{f0(t.sun)}</i>
              <em>{d1(t.sun, t.sunB, "h")}</em>
            </span>
          </Fragment>
        ))}
      </div>
      {lines.map(([head, ls]) => (
        <div key={head} className="month-report-part">
          <b>{head}</b>
          <p>
            {ls.filter(Boolean).map((l) => (
              <span key={l}>{l}</span>
            ))}
          </p>
        </div>
      ))}
      {picked && <p className="month-report-note">選んだ日だけのレポート（前年同曜日も同じ曜日の日だけ）。続いた日数は日付が続く範囲で数える。</p>}
    </div>
  );
}

const GROUP_NAMES = ["ひとつめ", "ふたつめ"];
// ---- 曜日の傾向（詳しく） -----------------------------------------------------------------------------
type WeekMeasure = "max" | "min" | "rainDays" | "rain" | "sun" | "sunnyDays" | "warmNoon";
const WEEK_MEASURES: { id: WeekMeasure; label: string; unit: string; tone: keyof typeof DATA; digits: number; count?: boolean }[] = [
  { id: "max", label: "最高", unit: "℃", tone: "hot", digits: 1 },
  { id: "min", label: "最低", unit: "℃", tone: "cold", digits: 1 },
  { id: "rainDays", label: "雨の日", unit: "日", tone: "rain", digits: 0, count: true },
  { id: "rain", label: "降水量", unit: "mm", tone: "rain", digits: 0 },
  { id: "sun", label: "日照", unit: "h", tone: "sun", digits: 1 },
  { id: "sunnyDays", label: "晴れの日", unit: "日", tone: "sun", digits: 0, count: true },
  { id: "warmNoon", label: "昼の肌感", unit: "日", tone: "feel", digits: 0, count: true },
];

/**
 * The weekdays in detail: one measure at a time (最高・最低・雨の日・降水量・日照・晴れの日・昼の肌感),
 * a bar per weekday (this month filled, 前年同曜日 as an outline mark), its value and the difference,
 * the dates' weather beside it, two groups of weekdays the viewer puts together, and a line naming
 * the highest and lowest weekday. A tap on a row adds (or drops) that weekday's days to the choice.
 */
function WeekDetail({
  store,
  station,
  days,
  rows,
  rowsB,
  picked,
  onPick,
}: {
  store: WeatherStore | null;
  station: string;
  days: string[];
  rows: (WeatherRow | null)[];
  rowsB: (WeatherRow | null)[];
  picked: ReadonlySet<string>;
  onPick: (days: string[]) => void;
}) {
  const base = useContext(FeelContext);
  const [measure, setMeasure] = useState<WeekMeasure>("max");
  // Two groups of weekdays to set side by side, chosen freely (at first 月〜金 and 土日).
  const [groups, setGroups] = useState<number[][]>([
    [0, 1, 2, 3, 4],
    [5, 6],
  ]);
  const toggleGroup = (gi: number, w: number) =>
    setGroups(groups.map((ws, i) => (i !== gi ? ws : ws.includes(w) ? ws.filter((x) => x !== w) : [...ws, w].sort())));
  const m = WEEK_MEASURES.find((x) => x.id === measure)!;
  const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const noonLevel = (d: string) => {
    const f = bandsFor(store, station, d, feelOn(store, station, d, base));
    return f?.exact ? (f.bands[2]?.level ?? null) : null;
  };
  // The days of a weekday, and of 前年同曜日 (same index, 52 weeks back).
  const of = (w: number) => days.map((d, i) => ({ d, a: rows[i], b: rowsB[i], dB: addDays(d, -PREV_SAME_WEEKDAY) })).filter((x) => dow(x.d) === w);
  const value = (g: { a: WeatherRow | null; d: string }[] | { b: WeatherRow | null; dB: string }[], side: "a" | "b"): number | null => {
    const rs = (g as { a?: WeatherRow | null; b?: WeatherRow | null }[]).map((x) => (side === "a" ? x.a : x.b) ?? null);
    const ds = (g as { d?: string; dB?: string }[]).map((x) => (side === "a" ? x.d : x.dB)!);
    const v = (k: string) => rs.map((r) => num(r?.[k])).filter((x): x is number => x != null);
    switch (measure) {
      case "max":
        return mean(v("max"));
      case "min":
        return mean(v("min"));
      case "rainDays":
        return v("rain").filter((x) => x >= 1).length;
      case "rain":
        return sum(v("rain"));
      case "sun":
        return mean(v("sun"));
      case "sunnyDays":
        return v("sun").filter((x) => x >= SUNNY_DAY_H).length;
      case "warmNoon":
        return ds.map(noonLevel).filter((l) => l != null && l >= 4).length;
    }
  };
  const cols = WEEK.map((name, w) => {
    const g = of(w);
    return { name, w, g, a: value(g, "a"), b: value(g, "b") };
  });
  const all = cols.flatMap((c) => [c.a, c.b]).filter((v): v is number => v != null);
  const lo = m.count || measure === "rain" || measure === "sun" ? 0 : Math.floor(Math.min(...all) - 1);
  const hi = Math.max(lo + 1, ...all);
  const pct = (v: number | null) => (v == null ? 0 : ((v - lo) / (hi - lo)) * 100);
  const fmt = (v: number | null) => (v == null ? "—" : m.count ? `${v.toFixed(0)}` : v.toFixed(m.digits));
  const ranked = cols.filter((c) => c.a != null).sort((x, y) => y.a! - x.a!);
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const color = DATA[m.tone];
  // 平日 and 土日 side by side: the days pooled, not the weekdays' values averaged.
  const pooled = (ws: number[]) => {
    const g = ws.flatMap((w) => of(w));
    const per = (v: number | null, n: number) => (v == null || !n ? null : m.count ? (v / n) * 100 : v);
    return { a: per(value(g, "a"), g.length), b: per(value(g, "b"), g.length) };
  };
  const groupVals = groups.map((ws) => pooled(ws));
  const show = (v: number | null) => (v == null ? "—" : m.count ? `${v.toFixed(0)}%` : `${v.toFixed(m.digits)}${m.unit}`);
  return (
    <div className="week-detail">
      <div className="chip-row chip-row-scroll" role="group" aria-label="曜日の傾向の項目">
        {WEEK_MEASURES.map((x) => (
          <Chip key={x.id} size="sm" on={measure === x.id} tone={DATA[x.tone]} onClick={() => setMeasure(x.id)}>
            {x.label}
          </Chip>
        ))}
      </div>
      <div className="week-detail-rows">
        {cols.map((c) => {
          const on = c.g.length > 0 && c.g.every((x) => picked.has(x.d));
          return (
            <button key={c.name} className={`week-detail-row${on ? " on" : ""}`} onClick={() => onPick(c.g.map((x) => x.d))} aria-pressed={on} aria-label={`${c.name}曜日を選ぶ`}>
              <b className={c.w === 5 ? "tone-saturday" : c.w === 6 ? "tone-holiday" : ""}>{c.name}</b>
              <span className="week-detail-bar">
                <i style={{ width: `${pct(c.a)}%`, background: color }} />
                {c.b != null && <em style={{ left: `${pct(c.b)}%`, borderColor: color }} title="前年同曜日" />}
              </span>
              <span className="week-detail-num">
                <i style={{ color }}>
                  {fmt(c.a)}
                  {m.count ? <small>/{c.g.length}</small> : null}
                </i>
                <small>{c.a != null && c.b != null ? (m.count ? `${c.a - c.b >= 0 ? "+" : "−"}${Math.abs(c.a - c.b)}` : signedDiff(c.a, c.b, m.unit)) : "—"}</small>
              </span>
              <span className="week-detail-icons">
                {c.g.map((x) => (
                  <span key={x.d}>{x.a ? <DayWeatherIcon row={x.a} station={station} size={12} /> : null}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="week-groups" role="group" aria-label="曜日をまとめて比べる">
        {groups.map((ws, gi) => (
          <div key={gi} className="week-group">
            <span className="week-group-days">
              {WEEK.map((name, w) => (
                <button
                  key={name}
                  className={`week-group-day${ws.includes(w) ? " on" : ""}${w === 5 ? " tone-saturday" : w === 6 ? " tone-holiday" : ""}`}
                  aria-pressed={ws.includes(w)}
                  aria-label={`${GROUP_NAMES[gi]}に${name}曜日を${ws.includes(w) ? "入れない" : "入れる"}`}
                  onClick={() => toggleGroup(gi, w)}
                >
                  {name}
                </button>
              ))}
            </span>
            <span className="week-group-val">
              <b style={{ color }}>{ws.length ? show(groupVals[gi].a) : "—"}</b>
              <small>前年 {ws.length ? show(groupVals[gi].b) : "—"}</small>
            </span>
          </div>
        ))}
      </div>
      <p className="week-detail-note">
        {top && bottom && top !== bottom ? (
          <>
            {m.label}がいちばん{m.id === "min" || m.id === "max" ? "高い" : "多い"}のは<b>{top.name}</b>（{fmt(top.a)}
            {m.count ? "日" : m.unit}）、いちばん{m.id === "min" || m.id === "max" ? "低い" : "少ない"}のは<b>{bottom.name}</b>（{fmt(bottom.a)}
            {m.count ? "日" : m.unit}）。
          </>
        ) : null}
        棒はこの月、縦の印は前年同曜日。{m.id === "sun" ? "日照は1日あたりの平均。" : ""}
        {m.id === "sunnyDays" ? `晴れの日は日照 ${SUNNY_DAY_H}時間以上。` : ""}
        {m.id === "warmNoon" ? "昼の肌感が「暖かい」以上の日。" : ""}
        {m.count ? "まとめた曜日は日数の割合。" : ""}
        行を押すとその曜日の日を選ぶ（複数可・レポートも選んだ日に）。
      </p>
    </div>
  );
}

// ---- 天気の型（クラスター） ----------------------------------------------------------------------------
const SKY_COLOR = { sun: DATA.sun, part: DATA.radiation, cloud: DATA.mean, rain: DATA.rain } as const;

/**
 * The month's days grouped by how alike they were (monthClusters): each type with its centre, how many
 * days it had this month and 前年同曜日, and its dates. A tap chooses the type's days (and the report follows).
 */
function DayTypes({
  days,
  rows,
  rowsB,
  picked,
  onPick,
}: {
  days: string[];
  rows: (WeatherRow | null)[];
  rowsB: (WeatherRow | null)[];
  picked: ReadonlySet<string>;
  onPick: (days: string[]) => void;
}) {
  // 型の数: 自動 (the silhouette's choice) or fixed by the viewer.
  const [k, setK] = useState<number | null>(null);
  const c = clusterDays(rows, rowsB, k ? [k, k] : [2, 5]);
  const kChips = (
    <div className="chip-row" role="group" aria-label="型の数">
      {[null, 3, 4, 5].map((x) => (
        <Chip key={x ?? 0} size="sm" on={k === x} onClick={() => setK(x)}>
          {x ? `${x}つ` : "自動"}
        </Chip>
      ))}
    </div>
  );
  if (!c)
    return (
      <div className="day-types">
        {kChips}
        <p className="month-report-note">この数では分けられません（そろった日が少ないか、1日だけの型ができる）。</p>
      </div>
    );
  const most = Math.max(1, ...c.types.flatMap((t) => [t.a.length, t.b.length]));
  const clear = c.silhouette >= 0.35 ? "はっきり分かれた" : c.silhouette >= 0.2 ? "ある程度分かれた" : "境目があいまい";
  return (
    <div className="day-types">
      {kChips}
      {c.types.map((t) => {
        const ds = t.a.map((i) => days[i]);
        const on = ds.length > 0 && ds.length === picked.size && ds.every((d) => picked.has(d));
        const color = SKY_COLOR[t.sky];
        return (
          <button key={t.name} className={`day-type${on ? " on" : ""}`} onClick={() => ds.length && onPick(ds)} aria-pressed={on} aria-label={`${t.name}の日を選ぶ`}>
            <span className="day-type-head">
              <i style={{ background: color }} />
              <b>{t.name}</b>
              <small>
                最高 {t.centre.max.toFixed(0)}℃・最低 {t.centre.min.toFixed(0)}℃・雨 {t.centre.rain.toFixed(t.centre.rain < 10 ? 1 : 0)}mm・日照 {t.centre.sun.toFixed(1)}h・湿度 {t.centre.humidity.toFixed(0)}%
              </small>
            </span>
            <span className="day-type-bars">
              <span>
                <em style={{ width: `${(t.a.length / most) * 100}%`, background: color }} />
              </span>
              <b>{t.a.length}日</b>
              <span>
                <em className="then" style={{ width: `${(t.b.length / most) * 100}%`, borderColor: color }} />
              </span>
              <small>前年 {t.b.length}日</small>
            </span>
            <span className="day-type-dates">
              {ds.length ? ds.map((d) => <span key={d}>{+d.slice(8)}</span>) : <small>この月はなし</small>}
            </span>
          </button>
        );
      })}
      <p className="month-report-note">
        最高・最低・雨・日照・湿度・風が似た日を、この月と前年同曜日をいっしょにして {c.types.length}つの型にまとめた（{k ? "数は指定" : "数は自動"}・{clear}）。
        {c.missingA ? `記録が欠けた ${c.missingA}日は入れていない。` : ""}押すとその型の日を選ぶ。
      </p>
    </div>
  );
}

// 年の概要（2026-11-22 渡辺さん「その年の概要画面は作れますか」）：その年を前の年の同じ日々と比べる。記録（実績）だけ。
// 今年は今日まで（前の年も同じ日付まで）。上は どのページでも同じ（ひとことと3つの数字）、下をページに：
//   まとめ（数字と目立った日）・月ごと（12か月の棒、押すとその月の概要）・肌感（月ごとの日中の肌感）。
// カレンダーの下の1行から開く（月の概要の隣）。

import { type CSSProperties, useContext, useEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { SCALE_STEPS } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { num, signedDiff } from "../design/format";
import { DATA, FEEL_SCALE_COLORS, feelFillLook, RADIUS } from "../design/tokens";
import { feelOn } from "../feelSeason";
import { bandsFor, FeelContext } from "./FeelBar";
import { Chip, GraphReadout, type ReadoutRow, Segmented } from "./kit";
import { ModalSheet } from "./ModalSheet";
import { statsOf, Tile, type MonthStats } from "./MonthReview";
import { useDrawnWidth } from "./useDrawnWidth";

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const daysOfYear = (year: string, until: string) => {
  const out: string[] = [];
  for (let d = `${year}-01-01`; d.startsWith(year) && d <= until; d = addDays(d, 1)) out.push(d);
  return out;
};
/** The same date a year before (2/29 → 2/28). */
const yearBack = (d: string) => {
  const y = `${+d.slice(0, 4) - 1}${d.slice(4)}`;
  return y.endsWith("02-29") ? y.replace("02-29", "02-28") : y;
};
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;

export function YearReview({ store, station, year, today, onClose, onMonth }: { store: WeatherStore | null; station: string; year: string; today: string; onClose: () => void; onMonth: (month: string) => void }) {
  const prev = String(+year - 1);
  const days = daysOfYear(year, today < `${year}-12-31` ? addDays(today, -1) : `${year}-12-31`);
  const daysB = days.map(yearBack);
  useEffect(() => {
    store?.prefetch(station, [...days, ...daysB], "year", Priority.Visible);
    return () => store?.prefetch(station, [], "year");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, station, year]);
  const a = statsOf(store, station, days);
  const b = statsOf(store, station, daysB);
  const months = MONTHS.map((m) => {
    const ds = days.filter((d) => d.slice(5, 7) === m);
    return { m, a: statsOf(store, station, ds), b: statsOf(store, station, ds.map(yearBack)), n: ds.length };
  }).filter((x) => x.n > 0);
  const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
  const cnt = (n: number) => `${n}日`;
  const dn = (x: number, y: number) => `${x - y >= 0 ? "+" : "−"}${Math.abs(x - y)}`;
  const frost = (st: MonthStats) => st.rows.filter((r) => (num(r?.min) ?? 1) < 0).length;
  const rows: ReadoutRow[] = [
    { key: "max", label: "最高の平均", unit: "℃", color: DATA.hot, a: f1(a.max), b: f1(b.max), diff: signedDiff(a.max, b.max, "℃") },
    { key: "min", label: "最低の平均", unit: "℃", color: DATA.cold, a: f1(a.min), b: f1(b.min), diff: signedDiff(a.min, b.min, "℃") },
    { key: "rainDays", label: "雨の日", text: true, unit: "", a: cnt(a.rainDays), b: cnt(b.rainDays), diff: dn(a.rainDays, b.rainDays) },
    { key: "hot25", label: "夏日", text: true, unit: "", a: cnt(a.hot25), b: cnt(b.hot25), diff: dn(a.hot25, b.hot25) },
    { key: "hot30", label: "真夏日", text: true, unit: "", a: cnt(a.hot30), b: cnt(b.hot30), diff: dn(a.hot30, b.hot30) },
    { key: "frost", label: "冬日", text: true, unit: "", a: cnt(frost(a)), b: cnt(frost(b)), diff: dn(frost(a), frost(b)) },
    { key: "storm", label: "嵐の日", text: true, unit: "", a: cnt(a.storm), b: cnt(b.storm), diff: dn(a.storm, b.storm) },
  ];
  const lean: string[] = [];
  if (a.temp != null && b.temp != null) lean.push(Math.abs(a.temp - b.temp) < 0.3 ? "気温は前年並み" : a.temp > b.temp ? "前年より暖かく" : "前年より涼しく");
  if (a.rain != null && b.rain != null) lean.push(Math.abs(a.rain - b.rain) < Math.max(30, b.rain * 0.1) ? "雨は同じくらい" : a.rain > b.rain ? "雨は多め" : "雨は少なめ");
  if (a.sun != null && b.sun != null && b.sun > 0) lean.push(a.sun / b.sun > 1.05 ? "日差しは多め" : a.sun / b.sun < 0.95 ? "日差しは少なめ" : "日差しは同じくらい");
  const best = (score: (r: WeatherRow) => number | null, hi: boolean) => {
    let at = -1;
    let v: number | null = null;
    a.rows.forEach((r, i) => {
      const s = r ? score(r) : null;
      if (s != null && (v == null || (hi ? s > v : s < v))) {
        v = s;
        at = i;
      }
    });
    return at < 0 ? null : { date: days[at], v: v! };
  };
  const standouts = [
    { label: "いちばん暑い日", p: best((r) => num(r.max), true), fmt: (v: number) => `最高 ${v.toFixed(1)}℃`, color: DATA.hot },
    { label: "いちばん寒い日", p: best((r) => num(r.min), false), fmt: (v: number) => `最低 ${v.toFixed(1)}℃`, color: DATA.cold },
    { label: "雨がいちばん多い日", p: best((r) => num(r.rain), true), fmt: (v: number) => `${v.toFixed(1)}mm`, color: DATA.rain },
    { label: "寒暖差がいちばん大きい日", p: best((r) => (num(r.max) != null && num(r.min) != null ? num(r.max)! - num(r.min)! : null), true), fmt: (v: number) => `${v.toFixed(1)}℃`, color: DATA.mean },
  ];
  const [tab, setTab] = useState<"sum" | "months" | "feel">("sum");
  const loaded = a.rows.filter(Boolean).length;
  const span = days.length ? `${md(days[0])}〜${md(days[days.length - 1])}` : "";
  return (
    <ModalSheet title={`${year}年の概要`} label={`${year}年の概要`} onClose={onClose} size="full" className="day-summary-sheet month-review year-review">
      <div className="ds-lead month-head">
        <p className="month-lean">
          {lean.length ? `${lean.join("、")}。` : "読み込んでいます…"}
          <small>（{prev}年の同じ日々（{span}）と比べて）</small>
        </p>
        <div className="month-tiles">
          <Tile name="平均気温" value={a.temp} unit="℃" other={b.temp} digits={1} color={DATA.mean} />
          <Tile name="雨" value={a.rain} unit="mm" other={b.rain} digits={0} color={DATA.rain} note={`${a.rainDays}日`} />
          <Tile name="日照" value={a.sun} unit="時間" other={b.sun} digits={0} color={DATA.sun} />
        </div>
        {loaded < days.length && <p className="chart-key-note">記録を読み込んでいます（{loaded}/{days.length}日）。</p>}
      </div>
      <div className="month-tabs">
        <Segmented
          label="年の概要のページ"
          value={tab}
          options={[
            { id: "sum", label: "まとめ" },
            { id: "months", label: "月ごと" },
            { id: "feel", label: "肌感" },
          ]}
          onChange={setTab}
        />
      </div>
      {tab === "sum" && (
        <>
          <GraphReadout title="年の値" unit="" dates={{ a: `’${year.slice(2)}`, b: `’${prev.slice(2)}` }} rows={rows} />
          <p className="chart-key-note">雨の日は1mm以上、夏日は最高25℃以上、真夏日は30℃以上、冬日は最低0℃未満の日。</p>
          <ul className="year-standouts">
            {standouts.map((x) =>
              x.p ? (
                <li key={x.label}>
                  <small>{x.label}</small>
                  <b style={{ color: x.color }}>{x.fmt(x.p.v)}</b>
                  <button className="cs-date-btn" onClick={() => onMonth(x.p!.date.slice(0, 7))} aria-label={`${md(x.p.date)}（${+x.p.date.slice(5, 7)}月の概要を開く）`}>
                    {md(x.p.date)}
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </>
      )}
      {tab === "months" && <YearMonths months={months} year={year} prev={prev} onMonth={onMonth} />}
      {tab === "feel" && <YearFeel store={store} station={station} days={days} daysB={daysB} />}
    </ModalSheet>
  );
}

type Metric = "temp" | "rain" | "sun";
const METRICS: { id: Metric; label: string }[] = [
  { id: "temp", label: "気温" },
  { id: "rain", label: "降水" },
  { id: "sun", label: "日照" },
];

/** The 12 months: 気温 as 最高〜最低の平均 bars, 降水・日照 as totals; this year filled, the year before outlined. Tap a month: its 概要. */
function YearMonths({ months, year, prev, onMonth }: { months: { m: string; a: MonthStats; b: MonthStats }[]; year: string; prev: string; onMonth: (month: string) => void }) {
  const [metric, setMetric] = useState<Metric>("temp");
  const ref = useRef<HTMLDivElement>(null);
  const w = useDrawnWidth(ref, [], 320);
  const H = 180;
  const PAD = { left: 30, right: 6, top: 10, bottom: 22 };
  const step = (w - PAD.left - PAD.right) / 12;
  const bw = Math.min(12, step * 0.32);
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const vals = metric === "temp" ? months.flatMap((m) => [m.a.max, m.a.min, m.b.max, m.b.min]) : months.flatMap((m) => [m.a[metric], m.b[metric]]);
  const got = vals.filter((v): v is number => v != null);
  const lo = metric === "temp" ? Math.floor(Math.min(0, ...got) / 5) * 5 : 0;
  const hi = metric === "temp" ? Math.ceil(Math.max(10, ...got) / 5) * 5 : Math.max(10, Math.ceil(Math.max(0, ...got) / 50) * 50);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const tickStep = metric === "temp" ? (hi - lo > 30 ? 10 : 5) : Math.max(50, Math.round((hi / 4) / 50) * 50);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += tickStep) ticks.push(t);
  const color = metric === "temp" ? DATA.hot : metric === "rain" ? DATA.rain : DATA.sun;
  const bar = (cx: number, top: number, bottom: number, filled: boolean, c: string) => (
    <rect x={cx - bw / 2} y={y(top)} width={bw} height={Math.max(2, y(bottom) - y(top))} rx={Math.min(bw / 2, 3)} fill={filled ? c : "none"} stroke={filled ? "none" : c} className={filled ? "" : "year-bar-prev"} />
  );
  return (
    <div className="ds-hours">
      <div className="month-metric chip-row" role="group" aria-label="グラフの項目">
        {METRICS.map((m) => (
          <Chip key={m.id} size="sm" on={metric === m.id} onClick={() => setMetric(m.id)}>
            {m.label}
          </Chip>
        ))}
      </div>
      <div ref={ref}>
        <svg width={w} height={H} role="img" aria-label={`月ごとの${METRICS.find((m) => m.id === metric)!.label}`}>
          <defs>
            <linearGradient id="year-range" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={DATA.hot} />
              <stop offset="1" stopColor={DATA.cold} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={PAD.left - 4} y={y(t) + 4} className="chart-tick" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {months.map(({ m, a, b }) => {
            const i = +m - 1;
            const go = () => onMonth(`${year}-${m}`);
            return (
              <g key={m} className="year-month" onClick={go} role="button" aria-label={`${+m}月の概要を開く`}>
                <rect x={x(i) - step / 2} y={PAD.top} width={step} height={H - PAD.top - PAD.bottom + 18} fill="transparent" />
                {metric === "temp" ? (
                  <>
                    {b.max != null && b.min != null && bar(x(i) + bw * 0.6, b.max, b.min, false, "url(#year-range)")}
                    {a.max != null && a.min != null && bar(x(i) - bw * 0.6, a.max, a.min, true, "url(#year-range)")}
                  </>
                ) : (
                  <>
                    {b[metric] != null && bar(x(i) + bw * 0.6, b[metric]!, 0, false, color)}
                    {a[metric] != null && bar(x(i) - bw * 0.6, a[metric]!, 0, true, color)}
                  </>
                )}
                <text x={x(i)} y={H - 6} className="chart-tick" textAnchor="middle">
                  {+m}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="chart-key-note">
        塗りが{year}年、線が{prev}年の同じ日々。{metric === "temp" ? "棒は最高の平均〜最低の平均。" : `棒は月の合計（${metric === "rain" ? "mm" : "時間"}）。`}月を押すとその月の概要。
      </p>
    </div>
  );
}

/** 日中の肌感 by month: how many days fell in each step (the day's own estimate when the hours are not read). */
function YearFeel({ store, station, days, daysB }: { store: WeatherStore | null; station: string; days: string[]; daysB: string[] }) {
  const base = useContext(FeelContext);
  const scale = base.scale ?? 7;
  const steps = SCALE_STEPS[scale];
  const PI = 1; // 日中
  const count = (ds: string[]) =>
    steps.map((st) =>
      ds.filter((d) => {
        const lv = bandsFor(store, station, d, feelOn(store, station, d, base))?.bands[PI]?.level;
        return lv != null && st.of.includes(lv);
      }).length,
    );
  const bar = (c: number[], thin: boolean) => {
    const total = c.reduce((x, y) => x + y, 0);
    if (!total) return <span className={`month-feel-bar${thin ? " thin" : ""} empty`} />;
    return (
      <span className={`month-feel-bar${thin ? " thin" : ""}`}>
        {c.map((k, i) => (k ? <i key={i} className="feel-fill" style={{ flex: k, ...feelFillLook(FEEL_SCALE_COLORS[scale][i]) } as CSSProperties} aria-label={`${steps[i].label} ${k}日`}>{thin ? "" : k}</i> : null))}
      </span>
    );
  };
  return (
    <div className="ds-hours month-feel">
      {MONTHS.map((m) => {
        const ds = days.filter((d) => d.slice(5, 7) === m);
        if (!ds.length) return null;
        const dsB = daysB.filter((_, i) => days[i].slice(5, 7) === m);
        return (
          <div key={m} className="month-feel-row">
            <span className="month-feel-name">{+m}月</span>
            <span className="month-feel-bars">
              {bar(count(ds), false)}
              {bar(count(dsB), true)}
            </span>
          </div>
        );
      })}
      <p className="line-legend">
        {steps.map((s, i) => (
          <span key={s.label}>
            <i style={{ background: FEEL_SCALE_COLORS[scale][i], width: 10, height: 10, borderRadius: RADIUS.tick }} />
            {s.label}
          </span>
        ))}
      </p>
      <p className="chart-key-note">日中の肌感。太い帯がこの年、細い帯が前の年の同じ月。数字はその段の日数（時間ごとの記録を読んでいない日は、日の値からの見込み）。</p>
    </div>
  );
}

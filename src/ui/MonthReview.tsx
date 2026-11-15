// 見本（sample/month、マージしない）: 月の振り返り — a month beside the same month a year before, from the
// records only: the month in words, its numbers, each day's 最高〜最低, 肌感 by time band, and the days
// that stood out. Opened with ?month=YYYY-MM.

import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { dayParts, hoursIn, PARTS, type PartId } from "../../shared/dayParts";
import { SCALE_STEPS } from "../../shared/feel";
import { stormOfRow } from "../../shared/storm";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { num, signedDiff } from "../design/format";
import { DATA, FEEL_SCALE_COLORS, SHAPE } from "../design/tokens";
import { bandsFor, FeelBar, FeelContext } from "./FeelBar";
import { DayWeatherIcon } from "./WeatherIcon";
import { dayTone } from "../../shared/holidays";
import { Chip, GraphReadout, type ReadoutRow, SectionHead } from "./kit";
import { ModalSheet } from "./ModalSheet";
import { feelOn } from "../feelSeason";

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

export function MonthReview({ store, station, month, onClose, layout = "list" }: { store: WeatherStore | null; station: string; month: string; onClose: () => void; layout?: "list" | "calendar" | "combo" }) {
  const feel = useContext(FeelContext);
  const before = yearBefore(month);
  const days = daysOf(month);
  const daysB = daysOf(before);
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
  const a = statsOf(store, station, days, parts);
  const b = statsOf(store, station, daysB, parts);
  const f1 = (v: number | null, u = "") => (v == null ? "—" : `${v.toFixed(1)}${u}`);
  const d1 = (x: number | null, y: number | null, unit: string) => signedDiff(x, y, unit);
  const cnt = (n: number) => `${n}日`;
  const monthDates = { a: `’${month.slice(2, 4)}/${+month.slice(5)}`, b: `’${before.slice(2, 4)}/${+before.slice(5)}` };
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
    return at < 0 ? null : { date: days[at], v: v! };
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
          <RangeLegend now={label(month)} then={label(before)} />
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
function MonthRange({ a, b }: { a: (WeatherRow | null)[]; b: (WeatherRow | null)[] }) {
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
  return (
    <div ref={ref}>
      <svg width={w} height={H} role="img" aria-label="日ごとの最高〜最低">
        <defs>
          <linearGradient id="month-range" x1="0" y1="0" x2="0" y2="1">
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
        {Array.from({ length: n }, (_, i) => {
          const ra = a[i];
          const rb = b[i];
          return (
            <g key={i}>
              {num(rb?.max) != null && num(rb?.min) != null && <rect {...cap(x(i) + bw * 0.45, num(rb!.max)!, num(rb!.min)!)} fill="none" stroke="url(#month-range)" strokeWidth={1.1} opacity={0.7} />}
              {num(ra?.max) != null && num(ra?.min) != null && <rect {...cap(x(i) - bw * 0.45, num(ra!.max)!, num(ra!.min)!)} fill="url(#month-range)" />}
            </g>
          );
        })}
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
  const scale = base.scale;
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
function MonthCalendar({ store, station, days, rows, marks }: { store: WeatherStore | null; station: string; days: string[]; rows: (WeatherRow | null)[]; marks?: Map<string, string> }) {
  const lead = (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  return (
    <div className="month-cal">
      {WEEK.map((w, i) => (
        <span key={w} className={`month-cal-head${i === 5 ? " tone-saturday" : i === 6 ? " tone-holiday" : ""}`}>
          {w}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={`e${i}`} />
      ))}
      {days.map((d, i) => {
        const r = rows[i];
        const mx = num(r?.max);
        const mn = num(r?.min);
        const rain = num(r?.rain);
        const tone = dayTone(d);
        return (
          <div key={d} className="month-cal-day" style={marks?.has(d) ? { boxShadow: `0 0 0 1.5px ${marks.get(d)} inset` } : undefined}>
            <span className={`month-cal-date tone-${tone}`}>{+d.slice(8)}</span>
            <span className="month-cal-icon">{r ? <DayWeatherIcon row={r} station={station} size={18} /> : null}</span>
            <span className="month-cal-temp">
              <i style={{ color: DATA.hot }}>{mx == null ? "—" : mx.toFixed(0)}</i>
              <i style={{ color: DATA.cold }}>{mn == null ? "—" : mn.toFixed(0)}</i>
            </span>
            <span className="month-cal-feel">
              <FeelBar store={store} station={station} date={d} />
            </span>
            <span className="month-cal-rain">{rain != null && rain >= 1 ? rain.toFixed(0) : ""}</span>
          </div>
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
        小さい数字は前年の同じ月の同じ曜日との差（雨の日は前年の日数）。雨の日（1mm以上）：土日 {wet(now.end)}/{now.end.length}日・平日 {wet(now.mid)}/{now.mid.length}日（前年 土日 {wet(then.end)}/{then.end.length}日・平日 {wet(then.mid)}/{then.mid.length}日）。
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

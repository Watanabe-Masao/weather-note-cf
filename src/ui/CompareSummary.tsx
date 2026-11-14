// The two days side by side, laid out like the table: the target day (upper table) on the left,
// the comparison day (lower table) on the right; item and difference in the middle.
//
// Compact: one line per item (value · "item diff" · value), the chosen item highlighted.
// Minimised: a single line for the chosen item (max and min for temperature) — by ▴/▾ (remembered
// on this device), and on its own once the summary's dates have scrolled out of the sheet: the line
// then docks under the sheet's head (outside the scrolling area, covering nothing); tapping it
// scrolls back up.

import { type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CalendarSide } from "./CalendarModal";
import { createPortal } from "react-dom";
import { addDays } from "../../shared/dates";
import type { WeatherRow } from "../../shared/types";
import { dailyRadiation, hourlyExtreme } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { clock, hourOfDay } from "../data/sun";
import { digitsOf, lineLabel, num, signedDiff, UNIT } from "../design/format";
import type { DataColor } from "../design/tokens";
import { Badge, Button, CheckGlyph, confidenceOfRow, DayLabel, Glyph, SwipeHint } from "./kit";
import type { MetricId } from "../metrics";
import { useSun } from "./HourCompare";
import { useSwipeDays } from "./useSwipeDays";
import { DayWeatherIcon } from "./WeatherIcon";
import { BetaContext } from "../beta/settings";
import { baselineStateOf, driversOfDay, useBaselineHistory } from "../beta/useBaseline";
import type { BaselineState } from "../beta/adaptation";
import { beyondComfort, comfortRange, centreUnknown, ensembleState, LEARNING_LABELS, type LearningView, type State } from "../beta/comfort";
import type { BetaSettings } from "../beta/settings";
import { daytimeFeel, type FeelSettings } from "../../shared/feel";
import { ReportSheet } from "../beta/ReportSheet";
import { BasisSheet } from "../beta/BasisSheet";
import { useCentreVisible } from "../beta/useReports";
import { FeelContext } from "./FeelBar";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  other: string | null;
  today: string;
  /** The item chosen in the chips: its row is highlighted. */
  metric?: MetricId;
  /** Swipe sideways: move the selected day by ±1. */
  onStep?: (days: number) => void;
  /** Tap a date to pick it from the calendar. */
  pick?: (side: CalendarSide) => void;
}


const COLLAPSED = "weather-note:summary-collapsed";

function kindOf(store: WeatherStore | null, station: string, date: string): "予報" | "暫定" | "実績" | null {
  const day = store?.getDay(station, date);
  if (day?.state !== "ready" || !day.row) return null;
  if (day.row.type === "forecast") return "予報";
  return day.kind === "variable" ? "暫定" : "実績";
}

function relative(date: string, today: string): "今日" | "昨日" | "明日" | null {
  if (date === today) return "今日";
  if (date === addDays(today, -1)) return "昨日";
  if (date === addDays(today, 1)) return "明日";
  return null;
}


/** Sunrise difference in minutes, "+7分" / "−3分" / "±0". */
function minutes(a: string | null, b: string | null): string {
  const x = hourOfDay(a);
  const y = hourOfDay(b);
  if (x == null || y == null) return "";
  const d = Math.round((x - y) * 60);
  return d === 0 ? "±0" : d > 0 ? `+${d}分` : `−${-d}分`;
}

interface Row {
  key: string;
  /** The chip this row belongs to. */
  metric: MetricId;
  label: string;
  unit: string;
  tone?: string;
  digits: number;
  a: number | null;
  b: number | null;
}

function useCollapsed(): [boolean, (v: boolean) => void] {
  const [v, set] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED) === "1";
    } catch {
      return false;
    }
  });
  return [
    v,
    (next) => {
      set(next);
      try {
        localStorage.setItem(COLLAPSED, next ? "1" : "0");
      } catch {
        // Not remembering is harmless.
      }
    },
  ];
}

export function CompareSummary({ store, station, target, other, today, metric, onStep, pick }: Props) {
  const swipe = useSwipeDays(onStep);
  /** A date that opens its calendar when tapped (a button only when picking is offered). */
  const dateButton = (side: "target" | "compare", children: ReactNode) =>
    pick ? (
      <button
        className="cs-date-btn"
        onClick={(e) => {
          e.stopPropagation();
          pick(side);
        }}
        aria-label={side === "target" ? "対象日を選ぶ" : "比較日を選ぶ（区間をカスタムに）"}
      >
        {children}
      </button>
    ) : (
      children
    );
  const swipeDock = useSwipeDays(onStep);
  // The day a sideways pull goes to, shown in the space it opens.
  const hint = (pull: number) => <SwipeHint pull={pull} prev={addDays(target, -1)} next={addDays(target, 1)} />;
  const [collapsed, setCollapsed] = useCollapsed();
  const full = useRef<HTMLElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  // The pinned line docks in the sheet's slot under its head (outside the scrolling area).
  const [dock, setDock] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setDock((full.current?.closest(".sheet")?.querySelector(".sheet-dock") as HTMLElement | null) ?? null);
  }, [collapsed]);
  // Pinned as soon as the summary's head line (the two dates) has scrolled out of the top — the
  // rows below may still show, but without their dates they no longer say which day is which.
  useEffect(() => {
    const el = heads.current;
    const root = el?.closest(".sheet-body") as HTMLElement | null;
    if (!el || !root) return setPinned(false);
    const io = new IntersectionObserver(
      ([e]) => setPinned(!e.isIntersecting && e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0) + 1),
      { root, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [collapsed]);
  const rowOf = (d: string | null): WeatherRow | null => (d ? (store?.getDay(station, d).row ?? null) : null);
  const hoursOf = (d: string | null) => (d ? (store?.getHours(station, d).rows ?? null) : null);
  const a = rowOf(target);
  const b = rowOf(other);
  const sunA = useSun(station, target, today, a);
  const sunB = useSun(station, other, today, b);
  const years = !!other && other.slice(0, 4) !== target.slice(0, 4);
  // β: each day against its own recent past (最近の基準), in the air, in the sun and in the shade.
  const beta = useContext(BetaContext);
  const feelSettings = useContext(FeelContext);
  useBaselineHistory(store, station, beta.enabled ? [target, other] : [], "summary-baseline");
  const stA = baselineStateOf(store, station, target, beta.alpha);
  const stB = baselineStateOf(store, station, other, beta.alpha);
  const centreVisible = useCentreVisible();
  const depA = comfortOfDay(store, station, target, a, hoursOf(target), stA, beta, feelSettings);
  const depB = comfortOfDay(store, station, other, b, hoursOf(other), stB, beta, feelSettings);
  const [reporting, setReporting] = useState(false);
  const [basis, setBasis] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  // One line per value, units and digits by the design rules (format.ts).
  const r = (key: string, metric: MetricId, label: string, unit: string, a: number | null, b: number | null, tone?: DataColor): Row => ({
    key,
    metric,
    label,
    unit,
    tone,
    digits: digitsOf(unit),
    a,
    b,
  });
  const rows: Row[] = [
    r("max", "temp", "最高", UNIT.temp, num(a?.max), num(b?.max), "hot"),
    r("min", "temp", "最低", UNIT.temp, num(a?.min), num(b?.min), "cold"),
    r("rain", "rain", "降水", UNIT.rain, num(a?.rain), num(b?.rain), "rain"),
    r("radiation", "radiation", "日射", UNIT.radiation, dailyRadiation(a, hoursOf(target)), dailyRadiation(b, hoursOf(other)), "radiation"),
    r("sun", "light", "日照", UNIT.hours, num(a?.sun), num(b?.sun), "sun"),
    r("humidity", "humidity", "湿度", UNIT.percent, num(a?.humidity), num(b?.humidity), "humidity"),
    r("wind", "wind", "風速", UNIT.wind, num(a?.wind), num(b?.wind), "wind"),
    r("pMax", "pressure", "気圧最高", UNIT.pressure, hourlyExtreme(hoursOf(target), "pressure", "max"), hourlyExtreme(hoursOf(other), "pressure", "max"), "pressureHigh"),
    r("pMin", "pressure", "気圧最低", UNIT.pressure, hourlyExtreme(hoursOf(target), "pressure", "min"), hourlyExtreme(hoursOf(other), "pressure", "min"), "pressureLow"),
  ];

  const value = (v: number | null, row: Row) =>
    v == null ? (
      <span className="cs-none">—</span>
    ) : (
      <>
        {v.toFixed(row.digits)}
        <small className="unit">{row.unit}</small>
      </>
    );

  const head = (d: string | null, r: WeatherRow | null, side: "a" | "b") => {
    if (!d) return <span className="cs-none">該当日なし</span>;
    const rel = relative(d, today);
    const kind = kindOf(store, station, d);
    return (
      // Always two lines, whatever the day: the date (and 今日, the sky) above, the data's state under
      // it. Each side leans toward the middle, as its numbers below do, so a long and a short day
      // sit the same way instead of wrapping differently.
      <span className={`cs-head cs-${side}`}>
        <span className="cs-head-line">
          {rel && <Badge kind={rel} />}
          <span className="cs-date">{dateButton(side === "a" ? "target" : "compare", <DayLabel date={d} year={years && d === other} />)}</span>
          <DayWeatherIcon row={r} station={station} />
        </span>
        <span className="cs-head-state">{kind && <Badge kind={kind} confidence={confidenceOfRow(r)} />}</span>
      </span>
    );
  };

  const toggle = (
    <button
      className="cs-toggle"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "比較を広げる" : "比較を畳む"}
    >
      <Glyph name={collapsed ? "down" : "up"} size="12px" />
    </button>
  );

  // The line for the chosen item: its row(s) only.
  const chosen = rows.filter((r) => r.metric === (metric ?? "temp"));
  const lineRows = chosen.length ? chosen : rows.slice(0, 2);
  const short = (v: number | null, r: Row) => (v == null ? "—" : v.toFixed(r.digits));
  const line = (pinned: boolean) => (
    <section
      className={pinned ? "compare-summary collapsed pinned" : "compare-summary collapsed"}
      aria-label="対象日と比較日（1行）"
      onClick={pinned ? () => full.current?.closest(".sheet-body")?.scrollTo({ top: 0, behavior: "smooth" }) : undefined}
    >
      {/* Which side is which, said in words: 対象 on the left, 比較 on the right (as in the table).
          One row across the card, each side at its own end; another year reads as 'YY. */}
      <span className="cs-line-dates">
        <span className="cs-line-date">
          <small className="cs-side">対象</small>
          {relative(target, today) && <Badge kind={relative(target, today)!} />}
          {dateButton("target", <DayLabel date={target} />)}
          <DayWeatherIcon row={a} station={station} />
        </span>
        <span className="cs-line-date">
          <small className="cs-side">比較</small>
          {other &&
            dateButton(
              "compare",
              <span className="day-label">
                {years && <small className="cs-year">’{other.slice(2, 4)}/</small>}
                <DayLabel date={other} />
              </span>,
            )}
          <DayWeatherIcon row={b} station={station} />
        </span>
      </span>
      <span className="cs-line cs-a">
        {lineRows.map((r, i) => (
          <span key={r.key} className={r.tone ? `tone-${r.tone}` : undefined}>
            {i > 0 && <span className="cs-slash">/</span>}
            {short(r.a, r)}
          </span>
        ))}
        <small>{lineRows[0].unit}</small>
      </span>
      <span className="cs-mid cs-line-mid">
        <span className="cs-label">{lineLabel(lineRows.map((r) => r.label))}</span>
        <span className="cs-diff">{lineRows.map((r) => signedDiff(r.a, r.b, r.digits) || "—").join(" / ")}</span>
      </span>
      <span className="cs-line cs-b">
        {lineRows.map((r, i) => (
          <span key={r.key} className={r.tone ? `tone-${r.tone}` : undefined}>
            {i > 0 && <span className="cs-slash">/</span>}
            {short(r.b, r)}
          </span>
        ))}
        <small>{lineRows[0].unit}</small>
      </span>
      {!pinned && toggle}
    </section>
  );

  if (collapsed)
    return (
      <>
      <div className="swipe-frame sticky-line">
        {hint(swipe.pull)}
        <div ref={swipe.ref} className="cs-wrap swipeable" style={swipe.style}>
          {line(false)}
        </div>
      </div>
      </>
    );

  return (
    <>
      {/* Pinned: the line docks under the sheet's head, outside the scrolling area, so it never covers
          anything. Outside a sheet (no dock), a zero-height sticky holder beside the summary overlays it. */}
      {dock ? (
        pinned &&
        createPortal(
          <div className="swipe-frame cs-dock">
            {hint(swipeDock.pull)}
            <div ref={swipeDock.ref} className="swipeable" style={swipeDock.style}>
              {line(true)}
            </div>
          </div>,
          dock,
        )
      ) : (
        <div className="cs-pin" aria-hidden={!pinned}>
          {pinned && line(true)}
        </div>
      )}
    <div className="swipe-frame">
    {hint(swipe.pull)}
    <div ref={swipe.ref} className="cs-wrap swipeable" style={swipe.style}>
    <section ref={full} className="compare-summary compact" aria-label="対象日と比較日">
      <div ref={heads} className="cs-heads">
        {head(target, a, "a")}
        <span className="cs-vs">比較</span>
        {head(other, b, "b")}
        {toggle}
      </div>

      {rows.map((r) => (
        <div key={r.key} className={r.metric === metric ? "cs-row chosen" : "cs-row"}>
          <span className={`cs-val cs-a${r.tone ? ` tone-${r.tone}` : ""}`}>{value(r.a, r)}</span>
          <span className="cs-mid">
            <span className="cs-label">{r.label}</span>
            <span className="cs-diff">{signedDiff(r.a, r.b, r.digits)}</span>
          </span>
          <span className={`cs-val cs-b${r.tone ? ` tone-${r.tone}` : ""}`}>{value(r.b, r)}</span>
        </div>
      ))}

      <div className="cs-row cs-sun">
        <span className="cs-val cs-a">
          {clock(sunA?.sunrise ?? null)}–{clock(sunA?.sunset ?? null)}
        </span>
        <span className="cs-mid">
          <span className="cs-label">日の出</span>
          <span className="cs-diff">{minutes(sunA?.sunrise ?? null, sunB?.sunrise ?? null)}</span>
        </span>
        <span className="cs-val cs-b">
          {clock(sunB?.sunrise ?? null)}–{clock(sunB?.sunset ?? null)}
        </span>
      </div>

      {beta.enabled && <BetaRows a={depA} b={depB} loadingA={stA.state === "loading"} loadingB={stB.state === "loading"} onReport={target === today ? () => setReporting(true) : undefined} onBasis={() => setBasis(true)} saved={saved} learning={beta.learning} hidden={{ a: !centreVisible(target), b: other != null && !centreVisible(other) }} />}
    </section>
    </div>
    </div>
    {basis && <BasisSheet store={store} station={station} target={target} other={other} onClose={() => setBasis(false)} />}
    {reporting && <ReportSheet store={store} station={station} today={today} onClose={() => setReporting(false)} onSaved={() => setSaved(true)} />}
    </>
  );
}

/** A day's β values: its 最近の基準, comfort centre and range, and 日なた／日かげ against them. */
interface DayComfort {
  base: number;
  forecastMixed: boolean;
  st: State;
  sun: number | null;
  shade: number | null;
}

function comfortOfDay(
  store: WeatherStore | null,
  station: string,
  date: string | null,
  row: WeatherRow | null,
  hours: WeatherRow[] | null,
  base: BaselineState,
  beta: BetaSettings,
  feel: FeelSettings,
): DayComfort | null {
  if (!date || base.state !== "ready") return null;
  const rows = hours ?? [];
  const sun = daytimeFeel(rows, { ...feel, sun: true }, station);
  const shade = daytimeFeel(rows, { ...feel, sun: false }, station);
  // The day's values are daytime (日中・昼・夕方, by the sun): the night drivers are off, last night's cold is on.
  const x = driversOfDay(store, station, date, beta.alpha, sun ?? shade ?? 0, num(row?.humidity), { at: date ? Date.parse(`${date}T12:00:00+09:00`) : null });
  if (!x) return null;
  return { base: base.baseline.value, forecastMixed: base.baseline.forecastMixed, st: ensembleState(beta.ens, x), sun, shade };
}

/**
 * β rows: each day's 最近の基準, the comfort centre and range of that day (they move with it), and
 * where the day's 肌感（日なた／日かげ） sit: ℃ from the centre, and "範囲内" or how far past the edge.
 * "読み込み中" while past days are on their way, "履歴不足" when they came but are too few.
 */
const BETA_ROWS_OPEN = "weather-note:summary-beta-open";

/** Whether the β rows of the summary are open (folded by default: the summary stays short). Kept on this device. */
function useBetaRowsOpen(): [boolean, (open: boolean) => void] {
  const [open, set] = useState(() => {
    try {
      return localStorage.getItem(BETA_ROWS_OPEN) === "1";
    } catch {
      return false;
    }
  });
  return [
    open,
    (next: boolean) => {
      set(next);
      try {
        localStorage.setItem(BETA_ROWS_OPEN, next ? "1" : "0");
      } catch {
        // Not remembering is harmless.
      }
    },
  ];
}

function BetaRows({
  a,
  b,
  loadingA,
  loadingB,
  onReport,
  onBasis,
  saved,
  learning,
  hidden,
}: {
  learning?: LearningView;
  /** Today's centre before the day's first report (a, b: the two columns). */
  hidden?: { a: boolean; b: boolean };
  a: DayComfort | null;
  b: DayComfort | null;
  loadingA?: boolean;
  loadingB?: boolean;
  onReport?: () => void;
  onBasis?: () => void;
  saved?: boolean;
}) {
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;
  const where = (d: DayComfort, e: number | null) => {
    if (e == null) return <span className="cs-none">—</span>;
    const out = beyondComfort(d.st, e);
    return (
      <>
        {signed(Math.round((e - d.st.mu) * 10) / 10)}
        <small className={out === 0 ? "beta-in" : "beta-out"}>{out === 0 ? "範囲内" : `外 ${signed(Math.round(out * 10) / 10)}`}</small>
      </>
    );
  };
  const rows: { key: string; label: string; show: (d: DayComfort) => ReactNode; value: (d: DayComfort) => number | null }[] = [
    {
      key: "base",
      label: "最近の基準",
      value: (d) => d.base,
      show: (d) => (
        <>
          {d.base.toFixed(1)}
          <small className="unit">℃</small>
          {d.forecastMixed && <small className="beta-fc">予報含む</small>}
        </>
      ),
    },
    {
      key: "mu",
      label: "暑くも寒くもない肌感",
      value: (d) => d.st.mu,
      show: (d) => (
        <>
          {d.st.mu.toFixed(1)}
        </>
      ),
    },
    {
      key: "range",
      label: "ちょうどよい範囲",
      value: (d) => (d.st.h + d.st.g) * 2,
      show: (d) => (
        <span className="beta-range">
          {comfortRange(d.st)[0].toFixed(1)}〜{comfortRange(d.st)[1].toFixed(1)}
        </span>
      ),
    },
    { key: "sun", label: "日なた 中心から", value: (d) => (d.sun == null ? null : d.sun - d.st.mu), show: (d) => where(d, d.sun) },
    { key: "shade", label: "日かげ 中心から", value: (d) => (d.shade == null ? null : d.shade - d.st.mu), show: (d) => where(d, d.shade) },
  ];
  // The person's centre is not known yet (未学習・情報不足): only the 最近の基準 (from the weather)
  // is shown; a centre the reports have not given is not drawn as if it were known.
  const unknown = centreUnknown(learning?.state);
  const cell = (d: DayComfort | null, r: (typeof rows)[number], loading?: boolean, later?: boolean) =>
    later && r.key !== "base" ? (
      <span className="cs-none beta-short">記録後に表示</span>
    ) : unknown && r.key !== "base" ? (
      <span className="cs-none beta-short">未特定</span>
    ) : d ? (
      r.show(d)
    ) : (
      <span className="cs-none beta-short">{loading ? "読み込み中" : "履歴不足"}</span>
    );
  const [open, setOpen] = useBetaRowsOpen();
  return (
    <div className={open ? "cs-beta" : "cs-beta folded"} role="group" aria-label="肌感の中心とちょうどよい範囲（β版。研究中の推定）">
      <p className="cs-beta-head">
        <button className="cs-beta-fold" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "肌感の中心とちょうどよい範囲を畳む" : "肌感の中心とちょうどよい範囲を広げる"}>
          肌感の中心とちょうどよい範囲 <span className="beta-tag">β</span>
          {learning && <span className={`learn-tag ${learning.state}`}>{LEARNING_LABELS[learning.state]}</span>}
          <span className="cs-beta-chev" aria-hidden="true"><Glyph name={open ? "up" : "down"} size="10px" /></span>
        </button>
        {open && <small>
          {unknown ? `暑くも寒くもない肌感は記録からまだ特定できません（${learning?.missing.join("、")}）` : "中心も範囲も、最近の気温への慣れや湿度で動きます。記録から学ぶ研究中の推定です"}
        </small>}
        {(onBasis || onReport) && (
          <span className="cs-beta-actions">
            {onBasis && (
              <Button kind="quiet" size="sm" onClick={onBasis} aria-label="肌感の中心とちょうどよい範囲の計算の根拠を見る">
                根拠
              </Button>
            )}
            {onReport && (
              <Button size="sm" onClick={onReport}>
                {saved ? <><CheckGlyph />記録しました</> : "今の感じ方を記録"}
              </Button>
            )}
          </span>
        )}
      </p>
      {open && rows.map((r) => {
        const x = a ? r.value(a) : null;
        const y = b ? r.value(b) : null;
        return (
          <div key={r.key} className="cs-row beta">
            <span className="cs-val cs-a">{cell(a, r, loadingA, hidden?.a)}</span>
            <span className="cs-mid">
              <span className="cs-label">{r.label}</span>
              <span className="cs-diff">{r.key === "range" ? (x != null && y != null ? `幅 ${signedDiff(x, y, 1) || "±0"}` : "") : signedDiff(x, y, 1)}</span>
            </span>
            <span className="cs-val cs-b">{cell(b, r, loadingB, hidden?.b)}</span>
          </div>
        );
      })}
    </div>
  );
}


// The two days side by side, laid out like the table: the target day (upper table) on the left,
// the comparison day (lower table) on the right; item and difference in the middle.
//
// Compact: one line per item (value · "item diff" · value), the chosen item highlighted.
// Minimised: a single line for the chosen item (max and min for temperature) — by ▴/▾ (remembered
// on this device), and on its own once the summary's dates have scrolled out of the sheet: the line
// then docks under the sheet's head (outside the scrolling area, covering nothing); tapping it
// scrolls back up.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarModal } from "./CalendarModal";
import { createPortal } from "react-dom";
import { addDays } from "../../shared/dates";
import type { WeatherRow } from "../../shared/types";
import { dailyRadiation, hourlyExtreme } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { clock, hourOfDay } from "../data/sun";
import { digitsOf, num, signedDiff, UNIT } from "../design/format";
import type { DataColor } from "../design/tokens";
import { Badge, DayLabel, SwipeHint } from "./kit";
import type { MetricId } from "../metrics";
import { useSun } from "./HourCompare";
import { useSwipeDays } from "./useSwipeDays";
import { WeatherIcon } from "./WeatherIcon";

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
  /** Tap a date to pick it from a calendar. */
  pick?: DatePick;
}

/**
 * Picking a date from the summary: the target day moves (the interval stays), and a comparison
 * day picked freely makes the interval custom (the comparison mode becomes カスタム, still linked).
 */
export interface DatePick {
  bounds: { min: string; max: string };
  last: string;
  onTarget: (date: string) => void;
  onCompare: (date: string) => void;
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
  const [calendar, setCalendar] = useState<"target" | "compare" | null>(null);
  /** A date that opens its calendar when tapped (a button only when picking is offered). */
  const dateButton = (side: "target" | "compare", children: ReactNode) =>
    pick ? (
      <button
        className="cs-date-btn"
        onClick={(e) => {
          e.stopPropagation();
          setCalendar(side);
        }}
        aria-label={side === "target" ? "対象日を選ぶ" : "比較日を選ぶ（区間をカスタムに）"}
      >
        {children}
      </button>
    ) : (
      children
    );
  const calendarSheet = pick && calendar && (
    <CalendarModal
      title={calendar === "target" ? "対象日" : "比較日"}
      value={calendar === "target" ? target : (other ?? target)}
      min={calendar === "target" ? pick.bounds.min : "1977-01-01"}
      max={calendar === "target" ? pick.bounds.max : pick.last}
      onPick={(d) => (calendar === "target" ? pick.onTarget(d) : pick.onCompare(d))}
      onClose={() => setCalendar(null)}
    />
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
    r("radiation", "radiation", "日射", UNIT.radiation, dailyRadiation(a, hoursOf(target)), dailyRadiation(b, hoursOf(other)), "sun"),
    r("sun", "radiation", "日照", UNIT.hours, num(a?.sun), num(b?.sun), "sun"),
    r("humidity", "humidity", "湿度", UNIT.percent, num(a?.humidity), num(b?.humidity), "humidity"),
    r("wind", "wind", "風速", UNIT.wind, num(a?.wind), num(b?.wind), "wind"),
    r("pMax", "pressure", "気圧最高", UNIT.pressure, hourlyExtreme(hoursOf(target), "pressure", "max"), hourlyExtreme(hoursOf(other), "pressure", "max"), "hot"),
    r("pMin", "pressure", "気圧最低", UNIT.pressure, hourlyExtreme(hoursOf(target), "pressure", "min"), hourlyExtreme(hoursOf(other), "pressure", "min"), "cold"),
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
      <span className={`cs-head cs-${side}`}>
        {rel && <Badge kind={rel} />}
        <span className="cs-date">{dateButton(side === "a" ? "target" : "compare", <DayLabel date={d} year={years && d === other} />)}</span>
        <WeatherIcon text={(r?.dayWeather as string | null) ?? null} />
        {kind && <Badge kind={kind} />}
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
      {collapsed ? "▾" : "▴"}
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
          <WeatherIcon text={(a?.dayWeather as string | null) ?? null} />
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
          <WeatherIcon text={(b?.dayWeather as string | null) ?? null} />
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
        <span className="cs-label">{lineRows.map((r) => r.label).join("/")}</span>
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
      {calendarSheet}
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
      {calendarSheet}
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
    </section>
    </div>
    </div>
    </>
  );
}

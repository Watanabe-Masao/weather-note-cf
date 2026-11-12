// The calendar for picking the target day or the comparison day (rule: カレンダー).
//
// Top: the pair as it will be — 対象 ↔ 比較 and the interval in words (7日前, 前年同曜日 …) — so the
// choice is seen before it is made. For the comparison day, the presets sit above the month.
// Each day shows its weather and maximum temperature; the other side's day is marked, the current
// one framed, forecast days hatched. A tap previews (the top line changes); a second tap on the
// same day, or 決定, confirms. Months move with ‹ › or a sideways swipe; 年 jumps far.

import { useEffect, useMemo, useState } from "react";
import { addDays, daysOfMonth, FORECAST_DAYS, monthOf } from "../../shared/dates";
import { dayTone, holidayName, WEEKDAYS } from "../../shared/holidays";
import { COMPARE_MODES, type CompareMode, diffDays, matchDate } from "../compare";
import type { WeatherStore } from "../data/store";
import { dateLabel } from "../design/format";
import { ChevronIcon } from "./icons";
import { Chip, confidenceOfRow } from "./kit";
import { ModalSheet, useSheetClose } from "./ModalSheet";
import { useSwipeDays } from "./useSwipeDays";
import { DayWeatherIcon } from "./WeatherIcon";

export type CalendarSide = "target" | "compare";

interface Props {
  side: CalendarSide;
  target: string;
  compare: string | null;
  mode: CompareMode;
  /** Range for this side's day. */
  min: string;
  max: string;
  store: WeatherStore | null;
  station: string;
  today: string;
  /** The comparison day a target day would get (the interval stays). */
  partnerOf: (target: string) => string | null;
  onTarget: (date: string) => void;
  /** A comparison day picked freely: the interval becomes カスタム. */
  onCompare: (date: string) => void;
  onPreset: (mode: CompareMode) => void;
  onClose: () => void;
}

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** The interval between the two days in words: the preset's name when one matches, else days. */
export function intervalLabel(target: string, compare: string | null): string {
  if (!compare) return "";
  for (const { mode, label } of COMPARE_MODES) if (mode !== "custom" && matchDate(target, mode) === compare) return label;
  const d = diffDays(target, compare);
  if (d === 0) return "同じ日";
  // A year or more apart: count from the same date that many years away ("1年前の6日前"), which
  // reads far better than "371日前".
  const years = Math.round(d / 365.25);
  if (years !== 0) {
    const t = new Date(Date.parse(target + "T00:00:00Z"));
    t.setUTCFullYear(t.getUTCFullYear() + years);
    const rest = diffDays(t.toISOString().slice(0, 10), compare);
    const y = `${Math.abs(years)}年${years < 0 ? "前" : "後"}`;
    return rest === 0 ? `${y}の同じ日` : `${y}の${Math.abs(rest)}日${rest < 0 ? "前" : "後"}`;
  }
  return `${Math.abs(d)}日${d < 0 ? "前" : "後"}`;
}

interface Candidate {
  date: string;
  /** Picked through a preset: confirming applies the preset (not カスタム). */
  mode?: CompareMode;
}

function Body(p: Props) {
  const close = useSheetClose();
  const value = p.side === "target" ? p.target : (p.compare ?? p.target);
  const [cand, setCand] = useState<Candidate | null>(null);
  const shown = cand?.date ?? value;
  const [month, setMonth] = useState(monthOf(value));
  const canPrev = shiftMonth(month, -1) >= monthOf(p.min);
  const canNext = shiftMonth(month, 1) <= monthOf(p.max);
  const move = (n: number) => {
    const next = shiftMonth(month, n);
    if (next >= monthOf(p.min) && next <= monthOf(p.max)) setMonth(next);
  };
  const swipe = useSwipeDays(move);

  // The pair as it would be with the candidate.
  const pairTarget = p.side === "target" ? shown : p.target;
  const pairCompare = p.side === "target" ? p.partnerOf(shown) : shown;
  const other = p.side === "target" ? p.compare : p.target;

  // Load this month's days quietly, so each cell can show its weather.
  const days = daysOfMonth(month);
  useEffect(() => {
    p.store?.prefetch(
      p.station,
      days.filter((d) => d >= p.min && d <= p.max),
      "calendar",
    );
    return () => p.store?.prefetch(p.station, [], "calendar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, p.station]);

  const lead = new Date(days[0] + "T00:00:00Z").getUTCDay();
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = +p.max.slice(0, 4); y >= +p.min.slice(0, 4); y--) out.push(y);
    return out;
  }, [p.min, p.max]);

  const confirm = (c: Candidate | null) => {
    if (!c || (c.date === value && !c.mode)) return close();
    if (p.side === "target") p.onTarget(c.date);
    else if (c.mode) p.onPreset(c.mode);
    else p.onCompare(c.date);
    close();
  };
  const tap = (d: string) => {
    // A second tap on the previewed day confirms it.
    if (cand?.date === d) return confirm(cand);
    setCand({ date: d });
    if (monthOf(d) !== month) setMonth(monthOf(d));
  };

  const presets = p.side === "compare" ? COMPARE_MODES.filter((m) => m.mode !== "custom") : [];

  return (
    <>
      {/* The pair as it will be. */}
      <div className={cand ? "cal-pair changed" : "cal-pair"} aria-live="polite">
        <span className={p.side === "target" ? "cal-pair-side picking" : "cal-pair-side"}>
          <small>対象</small>
          {dateLabel(pairTarget)}
        </span>
        <span className="cal-pair-link" aria-hidden>
          ↔
        </span>
        <span className={p.side === "compare" ? "cal-pair-side picking" : "cal-pair-side"}>
          <small>比較</small>
          {pairCompare ? dateLabel(pairCompare, { year: pairCompare.slice(0, 4) !== pairTarget.slice(0, 4) }) : "—"}
        </span>
        <span className="cal-pair-interval">
          {intervalLabel(pairTarget, pairCompare)}
          {p.side === "compare" && cand && !cand.mode && !COMPARE_MODES.some((m) => m.mode !== "custom" && matchDate(pairTarget, m.mode) === pairCompare)
            ? "・カスタム"
            : ""}
        </span>
      </div>

      {presets.length > 0 && (
        <div className="chip-row cal-presets">
          {presets.map(({ mode, label }) => {
            const d = matchDate(p.target, mode);
            const on = cand ? cand.mode === mode : p.mode === mode;
            return (
              <Chip
                key={mode}
                size="sm"
                on={on}
                onClick={() => {
                  if (!d) return;
                  if (cand?.mode === mode) return confirm(cand);
                  setCand({ date: d, mode });
                  setMonth(monthOf(d));
                }}
              >
                {label}
              </Chip>
            );
          })}
        </div>
      )}

      <header className="calendar-head">
        <button className="icon-btn sm" disabled={!canPrev} onClick={() => move(-1)} aria-label="前の月">
          <ChevronIcon />
        </button>
        <strong>
          <select
            className="cal-year"
            value={month.slice(0, 4)}
            onChange={(e) => {
              const m = `${e.target.value}-${month.slice(5)}`;
              setMonth(m < monthOf(p.min) ? monthOf(p.min) : m > monthOf(p.max) ? monthOf(p.max) : m);
            }}
            aria-label="年"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
          {+month.slice(5)}月
        </strong>
        <button className="icon-btn sm flip" disabled={!canNext} onClick={() => move(1)} aria-label="次の月">
          <ChevronIcon />
        </button>
      </header>

      <div ref={swipe.ref} style={swipe.style} className="calendar-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i === 0 ? "cal-wd holiday" : i === 6 ? "cal-wd saturday" : "cal-wd"}>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={"pad" + i} />
        ))}
        {days.map((d) => {
          const enabled = d >= p.min && d <= p.max;
          const day = enabled ? p.store?.getDay(p.station, d) : null;
          const row = day?.state === "ready" ? day.row : null;
          const max = typeof row?.max === "number" ? Math.round(row.max as number) : null;
          const forecast = d >= p.today;
          // Each cell says which of four it is: a value, still loading, failed, or no data that day.
          const status = !enabled ? "outside" : !day || day.state === "empty" ? "loading" : day.state === "error" ? "failed" : max == null ? "none" : "ready";
          const cls = [
            "cal-day",
            `tone-${dayTone(d)}`,
            d === value ? "current" : "",
            d === cand?.date ? "candidate" : "",
            d === other ? "other" : "",
            d === p.today ? "today" : "",
            forecast && enabled ? "forecast" : "",
            `is-${status}`,
          ].join(" ");
          const spoken =
            status === "outside" ? (d > p.max ? "予報の範囲外" : "選べません") : status === "loading" ? "読み込み中" : status === "failed" ? "取得できませんでした" : status === "none" ? "データなし" : `最高${max}℃`;
          return (
            <button
              key={d}
              className={cls}
              disabled={!enabled}
              title={holidayName(d) || undefined}
              onClick={() => tap(d)}
              aria-label={`${dateLabel(d)}${holidayName(d) ? ` ${holidayName(d)}` : ""}${d === p.today ? " 今日" : ""}${forecast && enabled ? " 予報" : ""} ${spoken}${confidenceOfRow(row) === "C" ? " 信頼度C" : ""}${d === other ? (p.side === "target" ? " 比較日" : " 対象日") : ""}${d === value ? " 選択中" : ""}`}
              aria-pressed={d === cand?.date}
            >
              <span className="cal-n">{+d.slice(8)}</span>
              <span className="cal-icon" aria-hidden>
                {row ? <DayWeatherIcon row={row} station={p.station} /> : status === "loading" ? <i className="cal-skel" /> : null}
              </span>
              <span className="cal-max" aria-hidden>
                {status === "loading" ? <i className="cal-skel short" /> : status === "failed" || status === "none" ? <span className="cal-none">—</span> : (max ?? "")}
                {confidenceOfRow(row) === "C" ? <i className="cal-c">C</i> : null}
              </span>
              {d === other && <span className="cal-other">{p.side === "target" ? "比較" : "対象"}</span>}
            </button>
          );
        })}
      </div>

      {(() => {
        // Say why cells are blank, once, under the month.
        const ds = days.filter((d) => d >= p.min && d <= p.max);
        const failed = ds.some((d) => p.store?.getDay(p.station, d).state === "error");
        const beyond = days.some((d) => d > p.max);
        if (!failed && !beyond) return null;
        return (
          <p className="cal-note" role="status">
            {beyond && <span>{dateLabel(addDays(p.max, 1))}以降は予報がありません（{FORECAST_DAYS + 1}日先まで）。</span>}
            {failed && (
              <span>
                取得できなかった日があります（—）。
                <button className="state-retry" onClick={() => p.store?.retryAll()}>
                  再試行
                </button>
              </span>
            )}
          </p>
        );
      })()}

      <footer className="calendar-foot">
        <button
          onClick={() => {
            const t = p.today < p.min ? p.min : p.today > p.max ? p.max : p.today;
            setMonth(monthOf(t));
          }}
        >
          今月へ
        </button>
        <button className="primary" onClick={() => confirm(cand)} disabled={!cand}>
          決定
        </button>
      </footer>
      <p className="hint cal-hint">日をタップすると上の組み合わせが変わります。もう一度タップするか［決定］で決まります。</p>
    </>
  );
}

export function CalendarModal(props: Props) {
  return (
    <ModalSheet title={props.side === "target" ? "対象日を選ぶ" : "比較日を選ぶ"} onClose={props.onClose} className="calendar" size="fit">
      <Body {...props} />
    </ModalSheet>
  );
}

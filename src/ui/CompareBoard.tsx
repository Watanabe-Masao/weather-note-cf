// The comparison table: a target strip and a comparison strip, each with its date header.
// Linked: both strips render the same run of target days (the comparison cell is that day's partner)
// and scroll as one. Independent: each strip has its own run of days.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { addDays, daysBetween } from "../../shared/dates";
import { dayTone, weekdayOf } from "../../shared/holidays";
import { diffDays, matchDate, needsRewindow, stripWindow } from "../compare";
import type { WeatherStore } from "../data/store";
import { tableSeries } from "../chartMetrics";
import { formatValue, type Metric } from "../metrics";
import type { ViewState } from "../state";
import { CalendarModal } from "./CalendarModal";
import { DateNav } from "./DateNav";
import { FeelBar, FeelContext, LEVEL_COLORS } from "./FeelBar";
import { LEVELS } from "../../shared/feel";
import { Strip, StripSync } from "./Strip";
import { WeatherIcon } from "./WeatherIcon";

interface Props {
  store: WeatherStore | null;
  view: ViewState;
  today: string;
  last: string;
  bounds: { min: string; max: string };
  compareDate: string | null;
  metric: Metric;
  moveTarget: (date: string) => void;
  moveCompare: (date: string) => void;
  onToggleSun: () => void;
  /** Tap on a column: open that day's detail, paired with the day on the other side. */
  onOpenDay: (date: string, other: string | null) => void;
}

const EDGE_DAYS = 3;

/** A run of days around `center` that only moves when the centre gets close to its edge. */
function useWindow(center: string, min: string, max: string) {
  const [win, setWin] = useState(() => stripWindow(center, min, max));
  useEffect(() => {
    if (center < win.start || center > win.end || needsRewindow(center, win, min, max) || win.end > max || win.start < min)
      setWin(stripWindow(center, min, max));
  }, [center, min, max, win]);
  // At either end of the range, show three faded days so the edge reads as an edge, not as blank space.
  return useMemo(() => {
    const start = win.start === min ? addDays(min, -EDGE_DAYS) : win.start;
    const end = win.end === max ? addDays(max, EDGE_DAYS) : win.end;
    return daysBetween(start, end);
  }, [win, min, max]);
}

function kindLabel(store: WeatherStore | null, station: string, date: string) {
  const day = store?.getDay(station, date);
  if (day?.state !== "ready" || !day.row) return "";
  if (day.row.type === "forecast") return "予報";
  return day.kind === "variable" ? "暫定" : "実績";
}

function Column({
  store,
  station,
  date,
  metric,
  faded = false,
  onOpen,
}: {
  store: WeatherStore | null;
  station: string;
  date: string | null;
  metric: Metric;
  faded?: boolean;
  onOpen?: () => void;
}) {
  const feel = useContext(FeelContext);
  if (!date)
    return (
      <div className="cell-stack empty-partner">
        <span className="cell-date">—</span>
        <span className="cell-note">該当日なし</span>
      </div>
    );
  const day = store?.getDay(station, date);
  const tone = dayTone(date);
  const state = faded && day?.state !== "ready" ? "outside" : (day?.state ?? "empty");
  return (
    <div
      className={`cell-stack state-${state}${faded ? " state-outside" : ""}${onOpen && !faded ? " tappable" : ""}`}
      onClick={faded ? undefined : onOpen}
    >
      <span className={`cell-date tone-${tone}`}>
        {+date.slice(5, 7)}/{+date.slice(8)}
        <small>{weekdayOf(date)}</small>
      </span>
      <span className="cell-icon">
        {state === "ready" ? <WeatherIcon text={day?.row?.dayWeather as string | null} /> : state === "empty" ? <span className="skeleton icon" /> : null}
      </span>
      <span className="cell-kind">{state === "outside" ? "範囲外" : kindLabel(store, station, date)}</span>
      {tableSeries(metric).map((s) => (
        <span key={s.key} className={`cell-value tone-${s.tone}`}>
          {state === "ready" ? (
            formatValue(s.value(day?.row, metric.needsHours ? (store?.getHours(station, date).rows ?? null) : null, feel), metric.unit)
          ) : state === "error" ? (
            <button
              className="retry"
              onClick={(e) => {
                e.stopPropagation();
                store?.retryDay(station, date);
              }}
            >
              再試行
            </button>
          ) : state === "empty" ? (
            <span className="skeleton" />
          ) : null}
        </span>
      ))}
      {metric.id === "temp" && (
        <span className="cell-feel">{state === "outside" ? null : <FeelBar store={store} station={station} date={date} />}</span>
      )}
    </div>
  );
}

function Labels({ metric }: { metric: Metric }) {
  return (
    <div className="labels">
      <span className="label-date">日付</span>
      <span className="label-icon">天気</span>
      <span className="label-kind" />
      {tableSeries(metric).map((s) => (
        <span key={s.key} className={`label-value tone-${s.tone}`}>
          {s.label}
          <small>{metric.unit}</small>
        </span>
      ))}
      {metric.id === "temp" && <span className="label-feel">肌感</span>}
    </div>
  );
}

export function CompareBoard({
  store,
  view,
  today,
  last,
  bounds,
  compareDate,
  metric,
  moveTarget,
  moveCompare,
  onToggleSun,
  onOpenDay,
}: Props) {
  const [calendar, setCalendar] = useState<"target" | "compare" | null>(null);
  const sync = useMemo(() => (view.linked ? new StripSync() : null), [view.linked]);
  const targetDays = useWindow(view.target, bounds.min, bounds.max);
  const compareDays = useWindow(view.linked ? view.target : view.compare, view.linked ? bounds.min : "1977-01-01", view.linked ? bounds.max : last);
  const gestures = useRef(0);
  const hold = (active: boolean) => {
    gestures.current = Math.max(0, gestures.current + (active ? 1 : -1));
    store?.hold(gestures.current > 0);
  };

  const partner = (d: string) => (view.linked ? matchDate(d, view.mode, view.offset) : d);
  const station = view.station;
  const chip = view.target === today ? null : view.target > today ? "back" : "forward";

  return (
    <section className="board">
      <div className="side side-target">
        <DateNav
          label={`対象日 ${view.target.slice(0, 4)}`}
          date={view.target}
          canBack={view.target > bounds.min}
          canForward={view.target < bounds.max}
          onStep={(n) => moveTarget(addDays(view.target, n))}
          onOpenCalendar={() => setCalendar("target")}
          todayChip={chip}
          onToday={() => moveTarget(today)}
        />
        <div className="side-body">
          <Labels metric={metric} />
          <div className="strip-wrap">
            <Strip
              id="target"
              dates={targetDays}
              center={view.target}
              selectable={(d) => d >= bounds.min && d <= bounds.max}
              sync={sync}
              onSettle={moveTarget}
              onGesture={hold}
              renderColumn={(d) => (
                <Column
                  store={store}
                  station={station}
                  date={d}
                  metric={metric}
                  faded={d < bounds.min || d > bounds.max}
                  onOpen={() => onOpenDay(d, view.linked ? matchDate(d, view.mode, view.offset) : addDays(view.compare, diffDays(view.target, d)))}
                />
              )}
            />
          </div>
        </div>
      </div>

      <div className="side side-compare">
        <DateNav
          label={`比較日 ${compareDate?.slice(0, 4) ?? ""}`}
          date={compareDate}
          canBack={view.linked ? view.target > bounds.min : view.compare > "1977-01-01"}
          canForward={view.linked ? view.target < bounds.max : view.compare < last}
          onStep={(n) => (view.linked ? moveTarget(addDays(view.target, n)) : moveCompare(addDays(view.compare, n)))}
          onOpenCalendar={() => setCalendar("compare")}
        />
        <div className="side-body">
          <Labels metric={metric} />
          <div className="strip-wrap">
            <Strip
              id="compare"
              dates={compareDays}
              center={view.linked ? view.target : view.compare}
              selectable={(d) => (view.linked ? d >= bounds.min && d <= bounds.max : d >= "1977-01-01" && d <= last)}
              sync={sync}
              onSettle={view.linked ? moveTarget : moveCompare}
              onGesture={hold}
              renderColumn={(d) => (
                <Column
                  store={store}
                  station={station}
                  date={partner(d)}
                  metric={metric}
                  faded={view.linked ? d < bounds.min || d > bounds.max : d < "1977-01-01" || d > last}
                  onOpen={() => {
                    const shown = partner(d);
                    if (shown) onOpenDay(shown, view.linked ? d : addDays(view.target, diffDays(view.compare, d)));
                  }}
                />
              )}
            />
          </div>
        </div>
      </div>

      {metric.id === "temp" && (
        <p className="feel-legend">
          肌感
          {LEVELS.map((label, i) => (
            <span key={label}>
              <i style={{ background: LEVEL_COLORS[i] }} />
              {label}
            </span>
          ))}
          <span>
            <i className="dashed" />
            目安
          </span>
          <button className={view.sun ? "sun-toggle on" : "sun-toggle"} onClick={onToggleSun} aria-pressed={view.sun}>
            {view.sun ? "☀ 日なた" : "☁ 日かげ"}
          </button>
        </p>
      )}

      {calendar && (
        <CalendarModal
          title={calendar === "target" ? "対象日" : "比較日"}
          value={calendar === "target" ? view.target : (compareDate ?? view.target)}
          min={calendar === "target" ? bounds.min : "1977-01-01"}
          max={calendar === "target" ? bounds.max : last}
          onPick={(d) => (calendar === "target" ? moveTarget(d) : moveCompare(d))}
          onClose={() => setCalendar(null)}
        />
      )}
    </section>
  );
}

// "◀ 2026/11/10 ▶" header of a strip.
// Tap an arrow: one day. Long-press an arrow and slide in its direction: whole weeks (slide back to cancel).
// Tap the date: open the calendar.

import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { weekSteps } from "../compare";
import { dateLabel } from "../design/format";

const LONG_PRESS_MS = 400;

interface Props {
  label: string;
  date: string | null;
  canBack: boolean;
  canForward: boolean;
  onStep: (days: number) => void;
  onOpenCalendar: () => void;
  todayChip?: "back" | "forward" | null;
  onToday?: () => void;
  /** Controls at the right end of the header (linking and compare rule, or the focus button). */
  extra?: ReactNode;
}

function Arrow({ dir, disabled, onStep }: { dir: -1 | 1; disabled: boolean; onStep: (days: number) => void }) {
  const press = useRef<{ x: number; timer: number; long: boolean } | null>(null);
  const [weeks, setWeeks] = useState<number | null>(null);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { x: e.clientX, timer: 0, long: false };
    p.timer = window.setTimeout(() => {
      p.long = true;
      setWeeks(1);
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
    press.current = p;
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p?.long) return;
    const next = weekSteps(p.x, e.clientX, dir);
    if (next !== weeks) {
      setWeeks(next);
      navigator.vibrate?.(5);
    }
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (!p.long) onStep(dir);
    else if (weeks) onStep(dir * 7 * weeks);
    setWeeks(null);
  };
  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setWeeks(null);
  };

  return (
    <span className="arrow-wrap">
      <button
        className="arrow"
        aria-label={dir < 0 ? "前の日（長押しで週単位）" : "次の日（長押しで週単位）"}
        disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {dir < 0 ? "◀" : "▶"}
      </button>
      {weeks !== null && (
        <span className="week-badge" role="status">
          {weeks === 0 ? "キャンセル" : `${dir < 0 ? "−" : "＋"}${weeks}週`}
        </span>
      )}
    </span>
  );
}

export function DateNav({ label, date, canBack, canForward, onStep, onOpenCalendar, todayChip, onToday, extra }: Props) {
  return (
    // Left-aligned and compact: it stays clear of the centre band that runs through both tables.
    // The side is told by the label for screen readers and by the table's own shade on screen.
    <div className="date-nav" role="group" aria-label={label}>
      <Arrow dir={-1} disabled={!canBack} onStep={onStep} />
      <button className="date-button" onClick={onOpenCalendar} disabled={!date}>
        {date ? dateLabel(date, { year: true, weekday: false }) : "該当日なし"}
      </button>
      <Arrow dir={1} disabled={!canForward} onStep={onStep} />
      <span className="today-slot">
        {todayChip && (
          <button className="today-chip" onClick={onToday}>
            {todayChip === "back" ? "◀今日" : "今日▶"}
          </button>
        )}
      </span>
      {extra && <span className="date-nav-extra">{extra}</span>}
    </div>
  );
}

// "◀ 2026/11/10 ▶" header of a strip.
// Tap an arrow: one day. Long-press an arrow and slide down (or sideways in its direction): whole
// weeks, more the farther the finger goes; the badge shows the day it will land on. Slide back up to cancel.
// Tap the date: open the calendar.

import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { weekSteps } from "../compare";
import { dateLabel } from "../design/format";
import { ChevronIcon } from "./icons";

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

function Arrow({
  dir,
  disabled,
  onStep,
  side,
  onPreview,
}: {
  dir: -1 | 1;
  disabled: boolean;
  onStep: (days: number) => void;
  side: string;
  /** While held: the weeks it would jump (0 = cancel), null when let go. */
  onPreview: (weeks: number | null) => void;
}) {
  const press = useRef<{ x: number; y: number; timer: number; long: boolean } | null>(null);
  const [weeks, setWeeksState] = useState<number | null>(null);
  const setWeeks = (w: number | null) => {
    setWeeksState(w);
    onPreview(w);
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { x: e.clientX, y: e.clientY, timer: 0, long: false };
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
    const next = weekSteps(e.clientX - p.x, e.clientY - p.y, dir);
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
        aria-label={`${side}を${dir < 0 ? "1日前へ" : "1日後へ"}`}
        aria-description="長押しして下へ引くと週単位で移動します"
        disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <ChevronIcon dir={dir < 0 ? "left" : "right"} />
      </button>
    </span>
  );
}

export function DateNav({ label, date, canBack, canForward, onStep, onOpenCalendar, todayChip, onToday, extra }: Props) {
  // While an arrow is held, the date itself shows where the jump will land (it sits above the
  // finger, so it stays in sight while sliding down).
  const [preview, setPreview] = useState<{ dir: -1 | 1; weeks: number } | null>(null);
  const side = label.split(" ")[0];
  const landing = preview && date && preview.weeks > 0 ? addDays(date, preview.dir * 7 * preview.weeks) : null;
  return (
    // Left-aligned and compact: it stays clear of the centre band that runs through both tables.
    // The side is told by the label for screen readers and by the table's own shade on screen.
    <div className="date-nav" role="group" aria-label={label}>
      <Arrow dir={-1} disabled={!canBack} onStep={onStep} side={side} onPreview={(w) => setPreview(w == null ? null : { dir: -1, weeks: w })} />
      <button className="date-button" onClick={onOpenCalendar} disabled={!date} aria-label={date ? `${label.split(" ")[0]} ${dateLabel(date, { year: true })}。カレンダーを開く` : undefined}>
        {preview ? (
          <span className="week-preview">{landing ? dateLabel(landing, { year: true, weekday: false }) : date ? dateLabel(date, { year: true, weekday: false }) : ""}</span>
        ) : date ? (
          dateLabel(date, { year: true, weekday: false })
        ) : (
          "該当日なし"
        )}
      </button>
      <Arrow dir={1} disabled={!canForward} onStep={onStep} side={side} onPreview={(w) => setPreview(w == null ? null : { dir: 1, weeks: w })} />
      <span className="today-slot">
        {preview ? (
          <span className="week-badge" role="status" aria-live="assertive">
            {preview.weeks === 0 ? "取り消し" : `${preview.weeks}週${preview.dir < 0 ? "前" : "後"}`}
            <em>{preview.weeks === 0 ? "下へ引くと週を選べます" : "↓で増える・↑で取り消し"}</em>
          </span>
        ) : todayChip && (
          <button className="today-chip" onClick={onToday}>
            {todayChip === "back" ? <><ChevronIcon dir="left" size={13} />今日</> : <>今日<ChevronIcon dir="right" size={13} /></>}
          </button>
        )}
      </span>
      {extra && <span className="date-nav-extra">{extra}</span>}
    </div>
  );
}

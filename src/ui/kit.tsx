// Component kit: the small parts every screen is built from. Each has one look and one behaviour,
// so the same thing never looks different on two screens (rules: docs/design-system.md).

import type { CSSProperties, ReactNode } from "react";
import { dayTone } from "../../shared/holidays";
import { type DataColor } from "../design/tokens";
import { dateLabel, digitsOf, monthDay, num, weekdayOf } from "../design/format";

/** A choice chip. `size="sm"` for filters inside sheets. */
export function Chip({
  on,
  onClick,
  children,
  size = "md",
  tone,
  label,
}: {
  on?: boolean;
  onClick?: () => void;
  children: ReactNode;
  size?: "md" | "sm";
  /** A data colour for the chip's selected state (band lines in the trend). */
  tone?: string;
  label?: string;
}) {
  return (
    <button
      className={`chip${size === "sm" ? " sm" : ""}${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      style={on && tone ? ({ "--chip-tone": tone } as CSSProperties) : undefined}
    >
      {children}
    </button>
  );
}

/**
 * Segmented switch: one of a few views. The selected segment is the raised, bright one.
 * `onReselect` lets a tap on the selected segment do its second job (日なた ⇄ 日かげ).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  onReselect,
  label,
}: {
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  onReselect?: (id: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          onClick={() => (o.id === value ? onReselect?.(o.id) : onChange(o.id))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A round icon button with a 36 px target (the visible part may be smaller). */
export function IconButton({ label, onClick, children, size = "md" }: { label: string; onClick: () => void; children: ReactNode; size?: "md" | "sm" }) {
  return (
    <button className={`icon-btn${size === "sm" ? " sm" : ""}`} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

export type Kind = "予報" | "暫定" | "実績";

/** Status of a day's values. */
export function Badge({ kind }: { kind: Kind | "今日" | "昨日" | "明日" }) {
  const cls = kind === "予報" ? "forecast" : kind === "暫定" ? "provisional" : kind === "実績" ? "actual" : "relative";
  return <span className={`badge ${cls}`}>{kind}</span>;
}

/**
 * A date as text: the month/day in the normal ink and only the weekday in its day tone
 * (土 blue, 日・祝 red), so day colours never compete with data colours.
 */
export function DayLabel({ date, year = false, weekday = true }: { date: string; year?: boolean; weekday?: boolean }) {
  const tone = dayTone(date);
  return (
    <span className="day-label">
      {year ? dateLabel(date, { year: true, weekday: false }) : monthDay(date)}
      {weekday && <span className={`wd tone-${tone}`}>（{weekdayOf(date)}）</span>}
    </span>
  );
}

/** A value with its unit, digits by the unit; "—" when missing. */
export function Num({
  value,
  unit,
  hourly = false,
  tone,
  showUnit = true,
}: {
  value: unknown;
  unit: string;
  hourly?: boolean;
  tone?: DataColor;
  showUnit?: boolean;
}) {
  const v = num(value);
  if (v == null) return <span className="num none">—</span>;
  return (
    <span className={`num${tone ? ` tone-${tone}` : ""}`}>
      {v.toFixed(digitsOf(unit, hourly))}
      {showUnit && <small className="unit">{unit}</small>}
    </span>
  );
}

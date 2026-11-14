// Component kit: the small parts every screen is built from. Each has one look and one behaviour,
// so the same thing never looks different on two screens (rules: docs/design-system.md).

import { type CSSProperties, Fragment, type ReactNode, useState } from "react";
import { dayTone } from "../../shared/holidays";
import type { Confidence } from "../../shared/confidence";
import { type BandMark, barLook, type DataColor, type LineDay, type LineKind, type LineLook, lineLook } from "../design/tokens";
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
export function Badge({ kind, confidence }: { kind: Kind | "今日" | "昨日" | "明日"; confidence?: Confidence | null }) {
  const cls = kind === "予報" ? "forecast" : kind === "暫定" ? "provisional" : kind === "実績" ? "actual" : "relative";
  return (
    <span className={`badge ${cls}`}>
      {kind}
      {kind === "予報" && confidence && <Conf value={confidence} />}
    </span>
  );
}

/**
 * 信頼度 of a forecast day (A/B/C, from the ensemble's spread; shared/confidence.ts). Written as a
 * letter after 予報; only C carries a colour (the caution colour) — A and B stay quiet.
 */
export function Conf({ value }: { value: Confidence }) {
  return (
    <b className={`conf conf-${value}`} title={CONF_TEXT[value]}>
      {value}
    </b>
  );
}

export const CONF_TEXT: Record<Confidence, string> = {
  A: "信頼度A：予報の計算がよくそろっている",
  B: "信頼度B：計算に少しばらつきがある",
  C: "信頼度C：計算のばらつきが大きい（予報が変わりやすい）",
};

/** The 信頼度 of a day's row, when it is a forecast with one. */
export const confidenceOfRow = (row: { type?: unknown; confidence?: unknown } | null | undefined): Confidence | null =>
  row?.type === "forecast" && (row.confidence === "A" || row.confidence === "B" || row.confidence === "C") ? row.confidence : null;

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

/** The forecast mark in graphs: a hatch behind the lines (line style only ever says which day). */
export function ForecastHatch({ id }: { id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" className="hatch-bg" />
      <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
    </pattern>
  );
}

/**
 * A marker shape for the 時間区分 lines (their colours are a neutral family, so the shape tells them
 * apart). Drawn centred on (x, y); `hollow` for the comparison day.
 */
export function Mark({ shape, x, y, r = 3.4, color, hollow = false }: { shape: BandMark; x: number; y: number; r?: number; color: string; hollow?: boolean }) {
  const fill = hollow ? "var(--surface-base)" : color;
  const common = { fill, stroke: color, strokeWidth: 1.4 };
  switch (shape) {
    case "square":
      return <rect x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} rx={0.6} {...common} />;
    case "triangle":
      return <path d={`M${x} ${y - r * 1.1}L${x + r * 1.05} ${y + r * 0.8}H${x - r * 1.05}Z`} {...common} />;
    case "diamond":
      return <path d={`M${x} ${y - r * 1.15}L${x + r * 1.05} ${y}L${x} ${y + r * 1.15}L${x - r * 1.05} ${y}Z`} {...common} />;
    case "ring":
      return <circle cx={x} cy={y} r={r} fill="var(--surface-base)" stroke={color} strokeWidth={2} />;
    default:
      return <circle cx={x} cy={y} r={r} {...common} />;
  }
}

/** The same marker as a small inline icon (chips and legends). */
export function MarkIcon({ shape, color }: { shape: BandMark; color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mark-icon">
      <Mark shape={shape} x={6} y={6} r={3.6} color={color} />
    </svg>
  );
}

/**
 * The guide that follows the finger on a graph (rule: 触っている所に補助線): a vertical line at the
 * touched position and, for the target day's points, dashed lines across to the value axis, where
 * a tag in the line's colour gives the value (tags close together are pushed apart, never overlap).
 */
export function GuideLines({
  x,
  top,
  bottom,
  left,
  points,
}: {
  x: number;
  top: number;
  bottom: number;
  left: number;
  points: { y: number; color: string; label?: string }[];
}) {
  const TAG_H = 15;
  // Lay the tags out top to bottom with at least one tag height between them.
  const tags = points
    .map((p, i) => ({ ...p, i, ty: p.y }))
    .filter((p) => p.label)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < tags.length; k++) tags[k].ty = Math.max(tags[k].ty, tags[k - 1].ty + TAG_H + 1);
  const overflow = tags.length ? tags[tags.length - 1].ty - (bottom - TAG_H / 2) : 0;
  if (overflow > 0) for (const t of tags) t.ty -= overflow;
  return (
    <g className="guide" pointerEvents="none">
      <line x1={x} x2={x} y1={top} y2={bottom} className="guide-v" />
      {points.map((p, i) => (
        <line key={i} x1={left} x2={x} y1={p.y} y2={p.y} className="guide-h" stroke={p.color} />
      ))}
      {tags.map((t) => {
        const w = Math.max(20, t.label!.length * 5.6 + 6);
        return (
          <g key={`tag-${t.i}`} transform={`translate(${left - 2 - w}, ${t.ty - TAG_H / 2})`}>
            <rect width={w} height={TAG_H} rx={4} fill={t.color} className="guide-tag" />
            <text x={w / 2} y={11} textAnchor="middle" className="guide-tag-text">
              {t.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface ReadoutRow {
  key: string;
  label: string;
  /** Text colour of the values (a data colour), or none. */
  color?: string;
  mark?: BandMark;
  /** This row's unit, when it differs from the card's. */
  unit?: string;
  a: ReactNode;
  b?: ReactNode;
  diff?: string;
  /** Words, not numbers (明るさ, 空): smaller, and may take two lines rather than run into the next column. */
  text?: boolean;
}

/**
 * The values at the touched (or selected) position, in a card above the graph — the same card on
 * every graph: what · target · comparison · difference.
 */
/**
 * `dates` name the two days under their column heads (対象 / 比較), so the title stays short and
 * nothing is cut: a title that carried both dates ran out of its column.
 */
export function GraphReadout({ title, rows, unit, live, dates }: { title: ReactNode; rows: ReadoutRow[]; unit: string; live?: boolean; dates?: { a?: ReactNode; b?: ReactNode } }) {
  return (
    <div className={live ? "readout-card live" : "readout-card"} aria-live="polite">
      <div className="ro-grid">
        <b className="ro-title">{title}</b>
        <small className="ro-col">
          対象{dates?.a && <em>{dates.a}</em>}
        </small>
        <small className="ro-col">
          比較{dates?.b && <em>{dates.b}</em>}
        </small>
        <small className="ro-col">差</small>
        {rows.map((r) => (
          <Fragment key={r.key}>
            <span className="ro-label">
              {r.mark && <MarkIcon shape={r.mark} color={r.color ?? "currentColor"} />}
              {r.label}
            </span>
            <span className={r.text ? "ro-v ro-text" : "ro-v"} style={r.mark ? undefined : { color: r.color }}>
              {r.a}
              {typeof r.a === "string" && r.a !== "—" && (r.unit ?? unit) && <small className="unit">{r.unit ?? unit}</small>}
            </span>
            <span className={r.text ? "ro-v ro-b ro-text" : "ro-v ro-b"} style={r.mark ? undefined : { color: r.color }}>
              {r.b ?? "—"}
            </span>
            <span className="ro-v ro-diff">{r.diff || "—"}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * What a sideways pull will do (rule: 引っ張ったときの案内): the day it moves to appears in the space
 * the pull opens, and turns to "離すと移動" once releasing would move. `pull` is from useSwipeDays
 * (+ = next day, − = previous day; ±1 = far enough).
 */
export function SwipeHint({ pull, prev, next }: { pull: number; prev: string; next: string }) {
  const toNext = pull > 0;
  const amount = Math.min(1, Math.abs(pull));
  const ready = Math.abs(pull) >= 1;
  if (amount < 0.05) return null;
  return (
    <div className={`swipe-hint ${toNext ? "to-next" : "to-prev"}${ready ? " ready" : ""}`} style={{ opacity: Math.min(1, amount * 1.6) }} aria-hidden>
      <span className="swipe-hint-inner" style={{ transform: `translateX(${(toNext ? 1 : -1) * (1 - amount) * 40}px)` }}>
        {!toNext && <ChevronGlyph dir="left" />}
        <span className="swipe-hint-text">
          <b>{dateLabel(toNext ? next : prev)}</b>
          <small>{ready ? "離すと移動" : toNext ? "次の日" : "前の日"}</small>
        </span>
        {toNext && <ChevronGlyph dir="right" />}
      </span>
    </div>
  );
}

const ChevronGlyph = ({ dir }: { dir: "left" | "right" }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="swipe-hint-chevron">
    <path d={dir === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A note that stays short: one line always shown (what you must know, or nothing), and the rest
 * behind ⓘ for whoever wants how it is worked out. The explanation is never in the way of the graph.
 */
export function InfoNote({ children, more, className }: { children?: ReactNode; more: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`info-note${className ? ` ${className}` : ""}`}>
      <p>
        {children}
        <button className="info-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "説明を閉じる" : "説明を開く"}>
          ⓘ
        </button>
      </p>
      {open && <p className="info-more">{more}</p>}
    </div>
  );
}

/** A legend's neutral sample colour: the legend tells which day, the graph's colour tells what. */
const SAMPLE_INK = "var(--ink-secondary)";

/**
 * A legend's line sample, drawn by the line rule (tokens.ts lineLook) so it matches the graph's
 * lines exactly. Give `look` to copy a line as drawn, or `day` (and `color`, `kind`) to draw one.
 */
export function LineSample({ look, day = "target", color = SAMPLE_INK, kind = "value" }: { look?: LineLook; day?: LineDay; color?: string; kind?: LineKind }) {
  const l = look ?? lineLook(day, color, { kind });
  return (
    <svg className="line-sample" width="22" height="6" aria-hidden>
      <line x1="1" x2="21" y1="3" y2="3" stroke={l.stroke} strokeWidth={l.strokeWidth} strokeDasharray={l.strokeDasharray} opacity={l.opacity} />
    </svg>
  );
}

/** A legend's bar sample by the bar rule (tokens.ts barLook): the target filled, the comparison outlined. */
export function BarSample({ day, color = SAMPLE_INK }: { day: LineDay; color?: string }) {
  const b = barLook(day, color);
  return (
    <svg className="line-sample" width="12" height="12" aria-hidden>
      <rect x="1" y="1" width="10" height="10" rx="2" fill={b.fill} stroke={b.stroke} strokeWidth={1.5} opacity={b.opacity} />
    </svg>
  );
}

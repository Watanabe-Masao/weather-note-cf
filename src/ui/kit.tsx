// Component kit: the small parts every screen is built from. Each has one look and one behaviour,
// so the same thing never looks different on two screens (rules: docs/design-system.md).

import { type ButtonHTMLAttributes, type CSSProperties, Fragment, type ReactNode, useEffect, useState } from "react";
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

/**
 * 主・副・控えめ・危険 (docs/design-system.md 4.12, 操作の体系 #151). `primary` is the next step of the
 * open layer and there is one at most; `quiet` opens an explanation; `danger` cannot be undone.
 * `sm` sits in a row (32 high, pressable 44); `block` spans the width (44). `busy` turns a ring
 * before the words without changing the width.
 */
export type ButtonKind = "primary" | "secondary" | "quiet" | "danger";
export function Button({
  kind = "secondary",
  size = "md",
  block,
  busy,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; size?: "md" | "sm"; block?: boolean; busy?: boolean }) {
  const cls = ["btn", kind, size === "sm" && "sm", block && "block", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="btn-spin" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * Small marks drawn, not typed (#151): ◀ ▶ ＋ − ↔ ● ○ ▾ as characters sit at a height each font
 * chooses, so the same button looks centred on one phone and low on another. A drawn mark is
 * centred in its own box. Sized in em so it follows the text beside it; colour is the text's.
 */
export type GlyphName = "prev" | "next" | "plus" | "minus" | "pair" | "dot" | "ring" | "down" | "up";
const GLYPH: Record<GlyphName, ReactNode> = {
  prev: <path d="M9 1.5 2.5 6 9 10.5z" fill="currentColor" strokeLinejoin="round" />,
  next: <path d="M3 1.5 9.5 6 3 10.5z" fill="currentColor" strokeLinejoin="round" />,
  down: <path d="M2.5 4h7L6 8.5z" fill="currentColor" />,
  up: <path d="M2.5 8h7L6 3.5z" fill="currentColor" />,
  plus: <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  minus: <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  pair: <path d="M3.8 3.5 1.5 6l2.3 2.5M8.2 3.5 10.5 6 8.2 8.5M1.8 6h8.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />,
  dot: <circle cx="6" cy="6" r="3.5" fill="currentColor" />,
  ring: <circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />,
};
export function Glyph({ name, size = "0.85em" }: { name: GlyphName; size?: string }) {
  return (
    <svg className="glyph" viewBox="0 0 12 12" width={size} height={size} aria-hidden>
      {GLYPH[name]}
    </svg>
  );
}

/** ✓ for a button that has just done its job (記録しました). */
export function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * A step that cannot be undone, in two presses: the first arms it (filled red, `armedLabel`), the
 * second does it; left alone for 3 s it disarms. No confirm window.
 */
export function DangerButton({ label, armedLabel, onConfirm, disabled, block = true }: { label: ReactNode; armedLabel: ReactNode; onConfirm: () => void; disabled?: boolean; block?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <Button
      kind="danger"
      block={block}
      className={armed ? "armed" : undefined}
      disabled={disabled}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? armedLabel : label}
    </Button>
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
 * The levels of a value (肌感の段・明るさの段) beside a graph's axis: a thin strip in each level's
 * colour just left of the plot, and a guide line where one level meets the next. The plot itself
 * keeps the face every graph has, so the lines stay easy to see (#151 日を並べる画面の決まり 2).
 */
export function LevelScale({ left, right, bands }: { left: number; right: number; bands: { y1: number; y2: number; color: string }[] }) {
  return (
    <g className="level-scale" aria-hidden>
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={left - 5} y={b.y1 + 0.5} width={3} height={Math.max(0, b.y2 - b.y1 - 1)} rx={1.5} fill={b.color} />
          {i > 0 && <line x1={left} x2={right} y1={b.y2} y2={b.y2} className="chart-grid level" />}
        </g>
      ))}
    </g>
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
        // Right-aligned to the value axis, but never out past the graph's own left edge (a narrow
        // margin with a wide value would cut the tag: 19.7 shown as 9.7).
        return (
          <g key={`tag-${t.i}`} transform={`translate(${Math.max(0, left - 2 - w)}, ${t.ty - TAG_H / 2})`}>
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
        {rows.map((r) => {
          // The unit sits with the row's name, once, so every value is a bare number and the
          // numbers of a column line up on their decimal point (a unit on some rows only moved them).
          const u = r.text || (r.a != null && typeof r.a === "object") ? "" : (r.unit ?? unit);
          const kind = (v: ReactNode) => (typeof v === "string" || typeof v === "number" ? "" : " ro-icon");
          return (
            <Fragment key={r.key}>
              <span className="ro-label">
                {r.mark && <MarkIcon shape={r.mark} color={r.color ?? "currentColor"} />}
                {r.label}
                {u && <small className="ro-unit">{u}</small>}
              </span>
              <span className={`ro-v${r.text ? " ro-text" : ""}${kind(r.a)}`} style={r.mark ? undefined : { color: r.color }}>
                {r.a}
              </span>
              <span className={`ro-v ro-b${r.text ? " ro-text" : ""}${kind(r.b ?? "—")}`} style={r.mark ? undefined : { color: r.color }}>
                {r.b ?? "—"}
              </span>
              <span className="ro-v ro-diff">{r.diff || "—"}</span>
            </Fragment>
          );
        })}
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

/**
 * A section's heading inside a sheet (#151 時間帯の箱): a hairline above, the name at the left, and
 * an optional note or control at the right. Sections are told apart by this line, not by boxes, so
 * the boxes left are the two that mean something: the summary (raised) and a graph's readout (inset).
 */
export function SectionHead({ title, children, as: Tag = "h4" }: { title: ReactNode; children?: ReactNode; as?: "h3" | "h4" | "p" }) {
  return (
    <div className="section-head">
      <Tag className="section-title">{title}</Tag>
      {children}
    </div>
  );
}

/**
 * A help line under a setting (#151: 説明は短い1行): the first sentence shows, the rest opens with ⓘ.
 * `lead` sets it as a group's lead (a little larger) instead of a row's help.
 */
export function Help({ text, lead }: { text: string; lead?: boolean }) {
  const [open, setOpen] = useState(false);
  const cut = text.indexOf("。");
  const first = cut >= 0 ? text.slice(0, cut + 1) : text;
  const rest = cut >= 0 ? text.slice(cut + 1).trim() : "";
  const cls = lead ? "set-lead help" : "set-help help";
  return (
    <span className={cls}>
      <span className="help-first">
        {first}
        {rest && (
          <button className="info-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "説明を閉じる" : "説明を開く"}>
            ⓘ
          </button>
        )}
      </span>
      {open && rest && <span className="help-more">{rest}</span>}
    </span>
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

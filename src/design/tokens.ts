// Weather Note design engine: the one source for colour, type, space, shape, depth, layers and motion.
//
// Everything visual reads from here — CSS through the custom properties `applyTokens()` writes at
// start-up, and SVG charts through the exported values — so a colour or a timing is changed once.
// The rules for using them are in docs/design-system.md.

// ---- colour ---------------------------------------------------------------------------------

/** Surfaces, from the page up. Depth is shown by light, not by borders alone. */
const surface = {
  page: "#0a1420",
  base: "#101c2b",
  raised: "#15243a",
  overlay: "#1a2c44",
  inset: "#0d1826",
} as const;

const ink = {
  primary: "#eaf0f7",
  secondary: "#a9b9cb",
  tertiary: "#a9b9cb", // same as secondary since the 補足 comparison (chosen: 3); kept as its own role
  disabled: "#56677b",
  onAccent: "#07121e",
} as const;

const line = {
  strong: "#2a3f58",
  soft: "rgba(255, 255, 255, 0.06)",
  focus: "#7cc4ff",
  swatch: "rgba(255, 255, 255, 0.14)", // the light edge round a colour swatch, so neighbours separate
  shade: "rgba(0, 0, 0, 0.25)", // the dark edge round a strip of colours on a face
} as const;

/** Interaction: selection, links, the centre band. Never used for data. */
const accent = {
  base: "#7cc4ff",
  strong: "#4fa9f5",
  wash: "rgba(124, 196, 255, 0.10)",
  glow: "rgba(124, 196, 255, 0.22)",
} as const;

/**
 * Data colours. Each colour means one kind of value everywhere (table, graphs, summary, lists).
 * The target day and the comparison day are told apart by line style (solid / dashed) and fill
 * (filled / outline), never by colour.
 */
export const DATA = {
  hot: "#f39a86", // highest values: 最高気温, 気圧最高, 最大瞬間
  cold: "#74b6f5", // lowest values: 最低気温, 気圧最低
  temp: "#f39a86", // temperature over the hours (the same family as 最高)
  mean: "#8ea3b9", // means and references (平均, the air temperature behind 肌感（日なた）)
  rain: "#45c8d8", // rain amounts and chances
  snow: "#cdd9ff",
  sun: "#f5c865", // 日射量, 日照
  humidity: "#8fd8c4",
  wind: "#a9c6de",
  pressure: "#d8b48d",
  feel: "#c9a6f7", // 肌感（日なた） / 肌感（日かげ） as a value
} as const;

// ---- lines in graphs ---------------------------------------------------------------------------
//
// One rule for every graph (日別, 時間帯, 移り変わり, 時間区分):
//  - Which day is told by the line's form: the target day solid, the comparison day dashed. Never by colour.
//  - What the line is, by colour: the day's own value in its data colour; a reference drawn with it
//    (the weeks before the day, the air behind 肌感) in REFERENCE, thinner than the values.
//  - A line the person has set aside (tapped in the legend) turns DIMMED grey and thinner, and keeps
//    its form, so it still reads as that day.
//  - Bars: the target filled, the comparison outlined (the same "solid / not solid" as the lines).

export type LineDay = "target" | "compare";
export type LineKind = "value" | "reference";
/** main: the item's own series · minor: a second series drawn beside it (平均 among 最高/最低). */
export type LineWeight = "main" | "minor";

export const LINE = {
  dash: { target: undefined, compare: "6 4" },
  width: { main: { target: 2.4, compare: 1.6 }, minor: { target: 1.4, compare: 1 } },
  opacity: { target: 1, compare: 0.75 },
  /** References are this much of a value line's width. */
  referenceScale: 0.7,
  // From the ink palette, not new colours: references in the primary ink, set-aside lines in the disabled one.
  reference: ink.primary,
  dimmed: ink.disabled,
  dimmedScale: 0.7,
  dimmedOpacity: 0.8,
} as const;

export interface LineLook {
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string | undefined;
  opacity: number;
}

/** How a graph line looks, by the rule above. `color` is the item's data colour (unused for references). */
export function lineLook(
  day: LineDay,
  color: string,
  { kind = "value", weight = "main", dimmed = false }: { kind?: LineKind; weight?: LineWeight; dimmed?: boolean } = {},
): LineLook {
  let width: number = LINE.width[weight][day];
  if (kind === "reference") width *= LINE.referenceScale;
  if (dimmed) width = Math.max(1, width * LINE.dimmedScale);
  return {
    stroke: dimmed ? LINE.dimmed : kind === "reference" ? LINE.reference : color,
    strokeWidth: Math.round(width * 10) / 10,
    strokeDasharray: LINE.dash[day],
    opacity: dimmed ? LINE.dimmedOpacity : LINE.opacity[day],
  };
}

/** Bars by the same rule: the target filled, the comparison outlined. */
export function barLook(day: LineDay, color: string, dimmed = false): { fill: string; stroke: string; opacity: number } {
  const c = dimmed ? LINE.dimmed : color;
  return day === "target" ? { fill: c, stroke: "none", opacity: dimmed ? LINE.dimmedOpacity : 1 } : { fill: "none", stroke: c, opacity: dimmed ? LINE.dimmedOpacity : 0.8 };
}

/**
 * Weather icons (晴 / 曇 / 雨 …). Pictures, not data: the sun is a warmer yellow than DATA.sun so an
 * icon never reads as a 日照 value; glint is the white of a raindrop's highlight.
 */
export const ICON = { sun: "#f5b83d", cloud: "#dbe5f0", rain: "#6fb3f2", glint: "#ffffff" } as const;

/** The six 明るさ levels (shared/brightness.ts), dark to light: night navy to pale daylight. */
export const LIGHT_LEVELS = ["#0b1220", "#26305e", "#4f5b80", "#8d9bb3", "#d6dbe0", "#fff1bf"] as const;
export type DataColor = keyof typeof DATA;

/** The five 肌感 levels, cold to hot. The ends are kept apart from the 最低/最高 data colours. */
/** The seven 肌感 steps, cold to hot (fills only). Five and three use these, by the step they gather. */
export const FEEL_LEVELS = ["#5262d8", "#7f9cea", "#a9cbf2", "#a5d48f", "#f3d27a", "#f0a463", "#e5705c"] as const;
/** Colour of each step of the 5 and 3 scales (from the seven: the step's own colour). */
export const FEEL_SCALE_COLORS = {
  7: FEEL_LEVELS,
  5: ["#6474e4", "#a9cbf2", "#a5d48f", "#f3d27a", "#ec8466"],
  3: ["#8fa9ee", "#a5d48f", "#f0b06a"],
} as const;

/** Lines for the five 時間区分 in the trend graph (朝・日中・昼・夕方・夜): distinct from the level colours. */
/**
 * Lines of the five 時間区分 (朝・日中・昼・夕方・夜): a neutral family of their own, told apart by
 * lightness and marker shape — never a data colour (blue is 最低, yellow 日差し, …) and never a feel
 * level colour, which the graph shows behind them.
 */
export const BAND_LINES = ["#f4f7fb", "#cdd8e6", "#a9b8cb", "#8797ad", "#6a7a91"] as const;
export const BAND_MARKS = ["circle", "square", "triangle", "diamond", "ring"] as const;
export type BandMark = (typeof BAND_MARKS)[number];

/** Day tones for dates: only the date and weekday text carry them. */
const day = {
  saturday: "#86b8ff",
  holiday: "#ff9a8f",
} as const;

const status = {
  forecast: "#c6cfdb", // 予報: a neutral grey (not yet measured). Blue is kept for "chosen" (#151)
  provisional: "#d7b46a",
  warning: "#f0b45a",
  error: "#ff8a80",
} as const;

// ---- type, space, shape, depth ------------------------------------------------------------------

const font = {
  family: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif',
  numeric: 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Hiragino Sans", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace', // codes and clock times to read out character by character
} as const;

/**
 * Type scale (px), by role. Nothing on screen is smaller than `xs`.
 * - xs   注記・単位・状態の札・軸の目盛り
 * - sm   ラベル・補足・小さいチップ
 * - base 本文・ボタン・チップ
 * - md   値（表・読み取り）・小見出し
 * - lg   見出し・強調する値
 * - xl   いちばん大きい値
 * - input 入力欄（16 未満だと iPhone が拡大するため）
 */
const size = { xs: 10, sm: 11.5, base: 13, md: 15, lg: 17, xl: 20, input: 16 } as const;
const weight = { regular: 400, medium: 500, bold: 650 } as const;

const space = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 16, 8: 20, 9: 24 } as const;
/** Corners. `tick` is for small marks (swatches, bars, badges); circles use 50%. */
const radius = { tick: 2, xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** Elevation: what sits above what. Shadows deepen with height. */
const shadow = {
  card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 6px 18px rgba(0,0,0,0.22)",
  sheet: "0 -1px 0 rgba(255,255,255,0.06) inset, 0 -10px 30px rgba(0,0,0,0.36)",
  overlay: "0 -1px 0 rgba(255,255,255,0.07) inset, 0 -16px 48px rgba(0,0,0,0.55)",
  pinned: "0 8px 20px rgba(0,0,0,0.38)",
  lift: "0 1px 3px rgba(0,0,0,0.32)", // a chosen segment, a cell or a slider thumb a hair above its face
  float: "0 10px 28px rgba(0,0,0,0.45)", // a card floating over content (zoom card, toast)
  edge: "8px 0 10px -8px rgba(0,0,0,0.7)", // the edge of a pinned column that content scrolls under
} as const;

/** Stacking order (z-index). Only these values are used. */
export const LAYER = {
  base: 0,
  band: 5, // the centre band through both tables
  pinned: 6, // a summary line pinned inside the sheet
  scrim: 9, // dimming behind the raised bottom sheet
  sheet: 10, // the bottom sheet
  overlayBackdrop: 30, // dimming behind an overlay sheet
  overlay: 31, // overlay sheets (feel map, similar days, calendar, settings)
  popover: 40, // week badge, tooltips
} as const;

// ---- motion -----------------------------------------------------------------------------------

/** Durations (ms) and curves. Entering is slower than leaving; nothing longer than 460 ms. */
export const MOTION = {
  quick: 140, // feedback: press, toggle
  base: 220, // small moves: chips, fades
  enter: 380, // a sheet sliding in
  exit: 260, // a sheet sliding out
  settleMin: 220, // a released sheet settling (grows with distance)
  settleMax: 460,
  ease: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    sheet: "cubic-bezier(0.32, 0.72, 0, 1)", // iOS-like: quick start, long soft landing
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;

/** Effects: dimming, frosted glass, the light from above, and night on a time axis. */
const effect = {
  scrim: "rgba(3, 8, 14, 0.55)",
  backdrop: "rgba(3, 8, 14, 0.62)",
  blur: "10px",
  gloss: "rgba(255, 255, 255, 0.04)", // the faint light on a face's top edge (controls, cards, sheets)
  glossStrong: "rgba(255, 255, 255, 0.06)", // the same on a chosen control
  night: "rgba(0, 0, 0, 0.24)", // night hours behind a graph
  twilight: "rgba(0, 0, 0, 0.12)", // twilight hours behind a graph
} as const;

// ---- output -------------------------------------------------------------------------------------

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** All tokens as CSS custom properties: --surface-base, --data-hot, --space-4, --motion-enter … */
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (group: string, values: Record<string, string | number>, unit = "") => {
    for (const [k, v] of Object.entries(values)) out[`--${group}-${kebab(k)}`] = typeof v === "number" ? `${v}${unit}` : v;
  };
  put("surface", surface);
  put("ink", ink);
  put("line", line);
  put("accent", accent);
  put("data", DATA);
  put("day", day);
  put("status", status);
  FEEL_LEVELS.forEach((c, i) => (out[`--feel-${i}`] = c));
  put("font", font);
  put("size", size, "px");
  put("weight", weight);
  put("space", space, "px");
  put("radius", radius, "px");
  put("shadow", shadow);
  put("layer", LAYER);
  put("motion", { quick: MOTION.quick, base: MOTION.base, enter: MOTION.enter, exit: MOTION.exit }, "ms");
  put("ease", MOTION.ease);
  put("effect", effect);
  return out;
}

/** Write the tokens onto :root (once, before the first render). */
export function applyTokens(root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(cssVariables())) root.style.setProperty(k, v);
}

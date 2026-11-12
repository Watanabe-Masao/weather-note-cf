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
  mean: "#8ea3b9", // means and references (平均, the air temperature behind 日なた温度)
  rain: "#45c8d8", // rain amounts and chances
  snow: "#cdd9ff",
  sun: "#f5c865", // 日射量, 日照
  humidity: "#8fd8c4",
  wind: "#a9c6de",
  pressure: "#d8b48d",
  feel: "#c9a6f7", // 日なた温度 / 日かげ温度 as a value
  light: "#ece2c4", // 明るさ (felt brightness): pale daylight
} as const;
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
  forecast: "#7cc4ff",
  provisional: "#d7b46a",
  warning: "#f0b45a",
  error: "#ff8a80",
} as const;

// ---- type, space, shape, depth ------------------------------------------------------------------

const font = {
  family: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif',
  numeric: 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Hiragino Sans", sans-serif',
} as const;

/** Type scale (px). Values are larger than labels; labels never go below `xs`. */
const size = { xs: 10, sm: 11.5, base: 13, md: 15, lg: 17, xl: 20, value: 18 } as const;
const weight = { regular: 400, medium: 500, bold: 650 } as const;

const space = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 16, 8: 20, 9: 24 } as const;
const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** Elevation: what sits above what. Shadows deepen with height. */
const shadow = {
  card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 6px 18px rgba(0,0,0,0.22)",
  sheet: "0 -1px 0 rgba(255,255,255,0.06) inset, 0 -10px 30px rgba(0,0,0,0.36)",
  overlay: "0 -1px 0 rgba(255,255,255,0.07) inset, 0 -16px 48px rgba(0,0,0,0.55)",
  pinned: "0 8px 20px rgba(0,0,0,0.38)",
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

/** Effects: dimming and frosted glass. */
const effect = {
  scrim: "rgba(3, 8, 14, 0.55)",
  backdrop: "rgba(3, 8, 14, 0.62)",
  blur: "10px",
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

// Weather Note design engine: the one source for colour, type, space, shape, depth, layers and motion.
//
// Everything visual reads from here — CSS through the custom properties `applyTokens()` writes at
// start-up, and SVG charts through the exported values — so a colour or a timing is changed once.
// The rules for using them are in docs/design-system.md.

// ---- colour ---------------------------------------------------------------------------------

// ---- themes (#241) --------------------------------------------------------------------------------
//
// Three themes on one structure (知覚品質に基づくカラーシステム再設計書 v1.0, 2026-11-16): Deep Navy (the
// dark one), Mist Green and Warm White. A colour keeps its meaning in every theme (the same hue for an
// item); its lightness is set per theme so it reads as strongly on that face: text 4.5:1 and graph
// lines 3:1 against the faces it sits on, checked by test/ui/themes.test.ts. The accent is green in all
// three (操作だけ, never data); 湿度 moved to teal so it stays apart from it (ΔE ≥ 10). Each graph role
// sits as far from the face in every theme (#243), the 肌感 steps as one diverging scale (4.4 … 2.4 … 4.4),
// and Deep Navy's temperatures and 肌感 are matched by impression, not chroma (#244). Values: #241, #242.

export type ThemeName = "navy" | "mist" | "warm";
export const THEME_NAMES: ThemeName[] = ["navy", "mist", "warm"];
export const THEME_LABEL: Record<ThemeName, string> = {
  navy: "Deep Navy",
  mist: "Mist Green",
  warm: "Warm White",
};

interface Palette {
  dark: boolean;
  surface: Record<"page" | "base" | "raised" | "overlay" | "inset", string>;
  ink: Record<
    "primary" | "secondary" | "tertiary" | "disabled" | "onAccent" | "onFeel",
    string
  >;
  line: Record<
    "strong" | "soft" | "focus" | "swatch" | "highlight" | "shade",
    string
  >;
  accent: Record<"base" | "strong" | "wash" | "glow", string>;
  data: Record<(typeof DATA_KEYS)[number], string>;
  day: Record<"saturday" | "holiday", string>;
  status: Record<"forecast" | "provisional" | "warning" | "error", string>;
  icon: Record<"sun" | "moon" | "cloud" | "rain" | "glint", string>;
  feel: string[];
  feel5: string[];
  feel3: string[];
  /** The inner edge of a 肌感 cell (肌感マップ): a few pixels of a lighter tone of its step, inside the frame. */
  feelEdge: string[];
  bands: string[];
  shadow: Record<
    "card" | "sheet" | "overlay" | "pinned" | "lift" | "float" | "edge" | keyof typeof SHARED_SHADOW,
    string
  >;
  effect: Record<
    | "scrim"
    | "backdrop"
    | "blur"
    | "gloss"
    | "glossStrong"
    | "sheen"
    | "quiet"
    | "estimated"
    | "estimatedQuiet"
    | "veil",
    string
  >;
  /** Reference lines in graphs (the weeks before, the air behind 肌感): below the comparison day (P4 under P2). */
  reference: { color: string; opacity: number };
  /** The graph's grid and its forecast hatch: opaque, each as far from the face in every theme. */
  chart: Record<"grid" | "hatch", string>;
  /** The comparison day's line: its opacity puts it at 80% of the main line's distance from the face. */
  compareOpacity: number;
}
const DATA_KEYS = [
  "hot",
  "cold",
  "temp",
  "mean",
  "rain",
  "snow",
  "sun",
  "radiation",
  "humidity",
  "humidityLow",
  "wind",
  "gust",
  "pressure",
  "pressureHigh",
  "pressureLow",
  "feel",
] as const;

/**
 * Shadows made of the theme's own lines and glow (the same in every theme, the colours come from the theme):
 * the accent's glow round what is chosen or touched, a button's bevel and its press, a swatch's lit top,
 * and the rule beside a pinned column.
 */
const SHARED_SHADOW = {
  glow: "0 0 14px var(--accent-glow)",
  bevel: "inset 0 1px 0 var(--line-highlight), inset 0 -1px 0 var(--line-shade)",
  pressed: "inset 0 1px 2px var(--line-shade)",
  swatchTop: "0 1px 0 var(--line-swatch) inset",
  rule: "1px 0 0 var(--line-strong)",
};

const DARK_SHADOW = {
  ...SHARED_SHADOW,
  card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 6px 18px rgba(0,0,0,0.22)",
  sheet: "0 -1px 0 rgba(255,255,255,0.06) inset, 0 -10px 30px rgba(0,0,0,0.36)",
  overlay:
    "0 -1px 0 rgba(255,255,255,0.07) inset, 0 -16px 48px rgba(0,0,0,0.55)",
  pinned: "0 8px 20px rgba(0,0,0,0.38)",
  lift: "0 1px 3px rgba(0,0,0,0.32)", // a chosen segment, a cell or a slider thumb a hair above its face
  float: "0 10px 28px rgba(0,0,0,0.45)", // a card floating over content (zoom card, toast)
  edge: "8px 0 10px -8px rgba(0,0,0,0.7)", // the edge of a pinned column that content scrolls under
};
// On a light face a shadow is a soft shade, and the lit edge is white.
const lightShadow = (tint: string) => ({
  ...SHARED_SHADOW,
  card: `0 1px 0 rgba(255,255,255,0.6) inset, 0 4px 14px rgba(${tint},0.10)`,
  sheet: `0 -1px 0 rgba(255,255,255,0.7) inset, 0 -8px 26px rgba(${tint},0.16)`,
  overlay: `0 -1px 0 rgba(255,255,255,0.8) inset, 0 -14px 40px rgba(${tint},0.24)`,
  pinned: `0 6px 16px rgba(${tint},0.16)`,
  lift: `0 1px 3px rgba(${tint},0.18)`,
  float: `0 10px 26px rgba(${tint},0.22)`,
  edge: `8px 0 10px -8px rgba(${tint},0.3)`,
});
// On a light face, what is behind a raised sheet recedes into the page's own light (a dark veil reads
// as grime there); an overlay still dims, more lightly than on Deep Navy. A quiet or estimated picture
// keeps more of itself: the same lowering of opacity takes far more contrast from a light face.
const lightEffect = (tint: string, page: string, veil: string) => ({
  scrim: `rgba(${page},0.55)`,
  backdrop: `rgba(${tint},0.30)`,
  blur: "10px",
  gloss: "rgba(255, 255, 255, 0.35)",
  glossStrong: "rgba(255, 255, 255, 0.55)",
  sheen: "rgba(255, 255, 255, 0.3)",
  quiet: "1",
  estimated: "1",
  estimatedQuiet: "1",
  veil,
});

// 肌感の7段（2026-11-18 渡辺さん「寒い＝#3232FF をベースに色の表」「枠の内側を数ピクセル #3265FF のグラデーション」
// 「Warm White とグリーンも合わせて見直し」）：3テーマで同じ色。段は明るさではなく鮮やかさで分ける（寒い・暑いが
// いちばん鮮やか、ふつうがいちばん落ち着く）。どの段も白い数字が読める明るさ（4.5:1 以上）で、数字は ink.onFeel。
// 縁は各段の少し明るい色（寒い #3232FF → #3265FF と同じ寄せ方）。
const FEEL = {
  feel: ["#3232ff", "#0072e5", "#007db0", "#547e5d", "#a46700", "#bd5700", "#e22919"],
  feel5: ["#3232ff", "#007db0", "#547e5d", "#a46700", "#e22919"],
  feel3: ["#0072e5", "#547e5d", "#bd5700"],
  feelEdge: ["#3265ff", "#3b8eeb", "#4394bd", "#719275", "#b68043", "#cc7546", "#ee5c50"],
};

const THEMES: Record<ThemeName, Palette> = {
  navy: {
    dark: true,
    surface: {
      page: "#00071f",
      base: "#041029",
      raised: "#0d1c36",
      overlay: "#0d1d37",
      inset: "#010b23",
    },
    // tertiary as secondary: the 補足 comparison chose 3 (one quiet ink, size and place tell the rest).
    ink: {
      primary: "#d9d1c4",
      secondary: "#b8b4aa",
      tertiary: "#b8b4aa",
      disabled: "#6c727c",
      onAccent: "#00071f",
      onFeel: "#ffffff",
    },
    line: {
      strong: "#354764",
      soft: "rgba(255, 255, 255, 0.06)",
      focus: "#91b49b",
      swatch: "rgba(255, 255, 255, 0.14)",
      highlight: "rgba(255, 255, 255, 0.35)",
      shade: "rgba(0, 0, 0, 0.25)",
    },
    accent: {
      base: "#91b49b",
      strong: "#7da587",
      wash: "rgba(145, 180, 155, 0.12)",
      glow: "rgba(145, 180, 155, 0.24)",
    },
    data: {
      hot: "#ea7742",
      cold: "#409ded",
      temp: "#ea7742",
      mean: "#8ea3b9",
      rain: "#45c8d8",
      snow: "#cdd9ff",
      sun: "#f5c865",
      radiation: "#f2a15c",
      humidity: "#8ee0cf",
      humidityLow: "#1ba7a0",
      wind: "#a9c6de",
      gust: "#d6e6f4",
      pressure: "#d8b48d",
      pressureHigh: "#e9c896",
      pressureLow: "#b48a5c",
      feel: "#c9a6f7",
    },
    day: { saturday: "#86b8ff", holiday: "#ff9a8f" },
    status: {
      forecast: "#c6cfdb",
      provisional: "#d7b46a",
      warning: "#f0b45a",
      error: "#ff8a80",
    },
    icon: {
      sun: "#b28b44",
      moon: "#989274",
      cloud: "#88939e",
      rain: "#6996c0",
      glint: "#ffffff",
    },
    ...FEEL,
    bands: ["#f4f7fb", "#cdd8e6", "#a9b8cb", "#8797ad", "#6a7a91"],
    shadow: DARK_SHADOW,
    effect: {
      scrim: "rgba(3, 8, 14, 0.55)",
      backdrop: "rgba(3, 8, 14, 0.62)",
      blur: "10px",
      gloss: "rgba(255, 255, 255, 0.04)",
      glossStrong: "rgba(255, 255, 255, 0.06)",
      sheen: "rgba(255, 255, 255, 0.16)",
      quiet: "1",
      estimated: "1",
      estimatedQuiet: "1",
      // The icon's fill: no colour of its own, a veil over whatever face the icon sits on (its line is
      // the colour), so the fill keeps one relation to the card, the sheet and the sunk face alike.
      veil: "rgba(255, 255, 255, 0.05)",
    },
    reference: { color: "#44536b", opacity: 1 },
    chart: { grid: "#1c2a3f", hatch: "#2b384f" },
    compareOpacity: 0.89,
  },
  mist: {
    dark: false,
    surface: {
      page: "#c4d0c1",
      base: "#d2dccf",
      raised: "#e7eae4",
      overlay: "#e9ece6",
      inset: "#c9d5c6",
    },
    ink: {
      primary: "#26382c",
      secondary: "#465a4b",
      tertiary: "#475a4a",
      disabled: "#748678",
      onAccent: "#ffffff",
      onFeel: "#ffffff",
    },
    line: {
      strong: "#9eaf9b",
      soft: "#c3d0c1",
      focus: "#28543f",
      swatch: "rgba(38, 56, 44, 0.18)",
      highlight: "rgba(255, 255, 255, 0.6)",
      shade: "rgba(38, 56, 44, 0.2)",
    },
    accent: {
      base: "#356c53",
      strong: "#28543f",
      wash: "rgba(53, 108, 83, 0.12)",
      glow: "rgba(53, 108, 83, 0.22)",
    },
    data: {
      hot: "#9c3622",
      cold: "#045b9a",
      temp: "#9c3622",
      mean: "#4d6074",
      rain: "#075c70",
      snow: "#555e7f",
      sun: "#765000",
      radiation: "#934b12",
      humidity: "#054a42",
      humidityLow: "#214741",
      wind: "#38556e",
      gust: "#53616d",
      pressure: "#765235",
      pressureHigh: "#76592a",
      pressureLow: "#7d5629",
      feel: "#68458c",
    },
    day: {
      saturday: "#325fa0",
      holiday: "#9d423b",
    },
    status: {
      forecast: "#575f6a",
      provisional: "#795900",
      warning: "#a56f06",
      error: "#a73a36",
    },
    icon: {
      sun: "#7c5802",
      moon: "#685e35",
      cloud: "#515f6f",
      rain: "#19619b",
      glint: "#ffffff",
    },
    ...FEEL,
    bands: ["#26382c", "#35483b", "#45584b", "#56695c", "#677b6d"],
    shadow: lightShadow("38, 56, 44"),
    effect: lightEffect("30, 44, 36", "196, 208, 193", "rgba(0, 0, 0, 0.07)"),
    reference: { color: "#838d98", opacity: 1 },
    chart: { grid: "#b6c1cc", hatch: "#a4aeb9" },
    compareOpacity: 0.89,
  },
  warm: {
    dark: false,
    surface: {
      page: "#f7f5f0",
      base: "#f0ede6",
      raised: "#fffefb",
      overlay: "#ffffff",
      inset: "#e9e5dd",
    },
    ink: {
      primary: "#243448",
      secondary: "#536274",
      tertiary: "#616b73",
      disabled: "#939a9e",
      onAccent: "#ffffff",
      onFeel: "#ffffff",
    },
    line: {
      strong: "#d0cdc5",
      soft: "#e2ded6",
      focus: "#28543f",
      swatch: "rgba(36, 52, 72, 0.16)",
      highlight: "rgba(255, 255, 255, 0.7)",
      shade: "rgba(36, 52, 72, 0.18)",
    },
    accent: {
      base: "#356c53",
      strong: "#28543f",
      wash: "rgba(53, 108, 83, 0.10)",
      glow: "rgba(53, 108, 83, 0.20)",
    },
    data: {
      hot: "#ab442f",
      cold: "#1268ab",
      temp: "#ab442f",
      mean: "#596d81",
      rain: "#017587",
      snow: "#616b8c",
      sun: "#8a6503",
      radiation: "#a5560e",
      humidity: "#074a48",
      humidityLow: "#224746",
      wind: "#526f88",
      gust: "#5e6c79",
      pressure: "#88613e",
      pressureHigh: "#846636",
      pressureLow: "#8b6335",
      feel: "#7955a2",
    },
    day: {
      saturday: "#3e6cae",
      holiday: "#ac4f47",
    },
    status: {
      forecast: "#646c76",
      provisional: "#866614",
      warning: "#b67d16",
      error: "#b54842",
    },
    icon: {
      sun: "#8b6305",
      moon: "#746b41",
      cloud: "#5d6c7c",
      rain: "#296ea9",
      glint: "#ffffff",
    },
    ...FEEL,
    bands: ["#243448", "#334459", "#43546a", "#53657b", "#64768d"],
    shadow: lightShadow("36, 52, 72"),
    effect: lightEffect("36, 46, 60", "247, 245, 240", "rgba(0, 0, 0, 0.065)"),
    reference: { color: "#919ba6", opacity: 1 },
    chart: { grid: "#c8d3df", hatch: "#b4bfca" },
    compareOpacity: 0.9,
  },
};
export const themePalette = (t: ThemeName): Readonly<Palette> => THEMES[t];

let current: ThemeName = "navy";
export const currentTheme = () => current;

// The colours of the theme in use. CSS reads them through custom properties (applyTheme); SVG charts
// read these objects, which applyTheme fills in place, so a theme change redraws them (the app is
// mounted again on a change, src/main.tsx).
const surface = { ...THEMES.navy.surface };
const ink = { ...THEMES.navy.ink };
const line = { ...THEMES.navy.line };
const accent = { ...THEMES.navy.accent };
const chart = { ...THEMES.navy.chart };

/**
 * Data colours. Each colour means one kind of value everywhere (table, graphs, summary, lists).
 * The target day and the comparison day are told apart by line style (solid / dashed) and fill
 * (filled / outline), never by colour.
 */
/**
 * One colour per item, so switching items changes the picture (気圧 used to look like 気温, 日差し like
 * 日照). An item with a high and a low uses one hue: the high light, the low deep (#151).
 */
export const DATA: Record<(typeof DATA_KEYS)[number], string> = {
  ...THEMES.navy.data,
};

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
  width: {
    main: { target: 2.4, compare: 1.6 },
    minor: { target: 1.4, compare: 1 },
  },
  opacity: { target: 1, compare: THEMES.navy.compareOpacity },
  /** References are this much of a value line's width. */
  referenceScale: 0.7,
  // References in each theme's own opaque grey, 2.4 from the face: under the comparison day it is read
  // against (#151, #243); set-aside lines in the disabled ink.
  reference: THEMES.navy.reference.color as string,
  referenceOpacity: THEMES.navy.reference.opacity as number,
  dimmed: ink.disabled,
  dimmedScale: 0.7,
  // 0.55 (#173): at 0.8 a set-aside reference line hardly changed (ΔE 15.6 from its own look).
  dimmedOpacity: 0.55,
};

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
  {
    kind = "value",
    weight = "main",
    dimmed = false,
  }: { kind?: LineKind; weight?: LineWeight; dimmed?: boolean } = {},
): LineLook {
  let width: number = LINE.width[weight][day];
  if (kind === "reference") width *= LINE.referenceScale;
  if (dimmed) width = Math.max(1, width * LINE.dimmedScale);
  return {
    stroke: dimmed
      ? LINE.dimmed
      : kind === "reference"
        ? LINE.reference
        : color,
    strokeWidth: Math.round(width * 10) / 10,
    strokeDasharray: LINE.dash[day],
    opacity: dimmed
      ? LINE.dimmedOpacity
      : kind === "reference"
        ? LINE.opacity[day] * LINE.referenceOpacity
        : LINE.opacity[day],
  };
}

/** Bars by the same rule: the target filled, the comparison outlined. */
export function barLook(
  day: LineDay,
  color: string,
  dimmed = false,
): { fill: string; stroke: string; opacity: number } {
  const c = dimmed ? LINE.dimmed : color;
  return day === "target"
    ? { fill: c, stroke: "none", opacity: dimmed ? LINE.dimmedOpacity : 1 }
    : { fill: "none", stroke: c, opacity: dimmed ? LINE.dimmedOpacity : 0.8 };
}

// ---- shapes in graphs (質感) -----------------------------------------------------------------------
//
// 「少しだけ角を取る」: marks get soft corners, never so round that where a value ends is lost.
//  - Amount bars (降水量・日射量・日照, 0 から積む): only the top corners, `bar.radius`; the foot stays
//    square on the 0 line, so the length from 0 still reads. A short or narrow bar gets a smaller
//    round (never past its own height or a quarter of its width).
//  - Range bars (気温の「幅」: 最高〜最低): round at both ends (a capsule) — both ends are values, and
//    the round lies inside the bar, so its tip is the value.
//  - Value labels: the target day's main lines only, the high side above its point and the low side
//    below (`valueLabel`), with a halo of the face behind so a line crossing them never cuts a digit.
//  - Joins: a day's line is one path (round joins), so a dashed line's rhythm runs on through the days.

export const SHAPE = {
  bar: { radius: 3, widthShare: 0.25 },
  /** 幅 bars: width (a share of a day, at most maxWidth), the centres `offset` widths either side of the day's. */
  range: {
    maxWidth: 12,
    share: 0.24,
    offset: 0.62,
    compareStroke: 1.4,
    meanOverhang: 2,
    meanWidth: 2.4,
  },
  /** Distance (px) from a point to its label's baseline: above, and below (the digits' height added). */
  valueLabel: { above: 7, below: 15, halo: 3 },
} as const;

/**
 * An amount bar from the 0 line up to y, its top corners rounded (SHAPE.bar). `h` is the bar's
 * height; the foot (y + h) stays square.
 */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number = SHAPE.bar.radius,
): string {
  // A narrow bar (時間帯: 24 to a row) gets a smaller round, so it stays a bar with soft corners
  // and never turns into a pill: at most a quarter of its width.
  const k = Math.max(0, Math.min(r, w * SHAPE.bar.widthShare, h));
  const n = (v: number) => Math.round(v * 100) / 100;
  if (k === 0) return `M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return `M${n(x)},${n(y + h)}V${n(y + k)}A${n(k)},${n(k)} 0 0 1 ${n(x + k)},${n(y)}H${n(x + w - k)}A${n(k)},${n(k)} 0 0 1 ${n(x + w)},${n(y + k)}V${n(y + h)}Z`;
}

/**
 * Weather icons (晴 / 曇 / 雨 …). Pictures, not data: the sun is a warmer yellow than DATA.sun so an
 * icon never reads as a 日照 value; glint is the white of a raindrop's highlight.
 */
export const ICON: Palette["icon"] = { ...THEMES.navy.icon }; // cloud: as quiet as the secondary ink, now that clouds are drawn in line

/** The six 明るさ levels (shared/brightness.ts), dark to light: night navy to pale daylight. */
export const LIGHT_LEVELS = [
  "#0b1220",
  "#26305e",
  "#4f5b80",
  "#8d9bb3",
  "#d6dbe0",
  "#fff1bf",
] as const;
export type DataColor = keyof typeof DATA;

/** The five 肌感 levels, cold to hot. The ends are kept apart from the 最低/最高 data colours. */
/** The seven 肌感 steps, cold to hot (fills only). Five and three use these, by the step they gather. */
export const FEEL_LEVELS: string[] = [...THEMES.navy.feel];
/** Colour of each step of the 5 and 3 scales (from the seven: the step's own colour). */
export const FEEL_SCALE_COLORS: Record<7 | 5 | 3, string[]> = {
  7: FEEL_LEVELS,
  5: [...THEMES.navy.feel5],
  3: [...THEMES.navy.feel3],
};
/** The inner edge of each of the seven steps (肌感マップ's cells). */
export const FEEL_EDGES: string[] = [...THEMES.navy.feelEdge];
/** The inner edge of a step's colour (any scale: the 5 and 3 steps are steps of the seven). */
export const feelEdgeOf = (color: string): string | undefined => FEEL_EDGES[FEEL_LEVELS.indexOf(color)];
/**
 * 肌感の塗り（面）の見え方（2026-11-18、design-system 2.0b「肌感の塗り」）：段の色で塗り、枠の内側に少し明るい色を
 * ぼかし（FEEL_CELL）、数字は白（ink.onFeel）。CSS の `.feel-fill` と組にして使う。肌感マップのマス・月の振り返りの帯
 * のように数字を載せる面はこれで塗る。凡例や行の頭の小さな見本（12px 以下）は縁を付けない（ぼかしで色が見えなくなる）。
 */
export const feelFillLook = (color: string): Record<string, string> => ({ background: color, "--feel-edge": feelEdgeOf(color) ?? "transparent" });

/** Lines for the five 時間区分 in the trend graph (朝・日中・昼・夕方・夜): distinct from the level colours. */
/**
 * Lines of the five 時間区分 (朝・日中・昼・夕方・夜): a neutral family of their own, told apart by
 * lightness and marker shape — never a data colour (blue is 最低, yellow 日差し, …) and never a feel
 * level colour, which the graph shows behind them.
 */
export const BAND_LINES: string[] = [...THEMES.navy.bands];
export const BAND_MARKS = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "ring",
] as const;
export type BandMark = (typeof BAND_MARKS)[number];

/** Day tones for dates: only the date and weekday text carry them. */
const day = { ...THEMES.navy.day };

const status = { ...THEMES.navy.status };

// ---- type, space, shape, depth ------------------------------------------------------------------

const font = {
  family:
    'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif',
  numeric:
    'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Hiragino Sans", sans-serif',
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
// The steps are iOS's text styles at the standard setting (#151): xs = Caption 2 (11, the smallest
// iOS uses), sm = Caption 1, base = Footnote, md = Subheadline, lg = Headline/Body, xl = Title 3.
const size = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 15,
  lg: 17,
  xl: 20,
  input: 16,
} as const;
/** The type scale for text drawn in SVG, where a CSS size would be read in the drawing's own units. */
export const TYPE_SIZE = size;

/**
 * Text roles on the data faces (読み取り・日別の表・比較サマリー; #151). Each role is one size,
 * weight, face and ink wherever it appears, so a value reads as a value on every card.
 * - 見出し   the card's or row's heading (12時, 11/14（土）)       base · bold · numeric · primary
 * - 指標名   what a row is (最高, 手前1週の平均, 寒暖差)           sm · regular · text · secondary
 * - 主要数値 the values themselves, in the item's colour           md · regular · numeric · data
 *            (the comparison day's the same, at the 比較 tone)
 * - 比較数値 a difference (差, +0.8)                                base · regular · numeric · primary
 * - 補足     units, column heads, 実績／予報 (℃, 対象, 予報)       xs · regular · tertiary
 * e2e (TR) checks that every part given a role draws it the same.
 */
export const TEXT_ROLES = {
  見出し: { size: "base", weight: "bold", ink: "primary" },
  指標名: { size: "sm", weight: "regular", ink: "secondary" },
  主要数値: { size: "md", weight: "regular", ink: "data" },
  比較数値: { size: "base", weight: "regular", ink: "primary" },
  補足: { size: "xs", weight: "regular", ink: "tertiary" },
} as const;
// bold = iOS Semibold (600): Hiragino has W3 and W6 only, so 650 drew the kanji at W6 (600) and
// the figures heavier; 600 is the one weight both faces draw.
const weight = { regular: 400, medium: 500, bold: 600 } as const;

const space = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 10,
  6: 12,
  7: 16,
  8: 20,
  9: 24,
} as const;
/** Corners. `tick` is for small marks (swatches, bars, badges); circles use 50%. */
const radius = {
  tick: 2,
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;
/** The corners for code (an SVG's rx, an inline style): the same steps as --radius-* in CSS. */
export const RADIUS = radius;

/**
 * The table's 肌感 band (FeelBar): one strip with soft corners (`radius.xs`), the time bands' colours
 * blended over `blur` of a band's width at each border, and a thin `divider` of the face between them
 * — the bands still count, without hard tiles. Today's band now is ringed (`ring`).
 */
export const FEEL_BAND = { divider: 1.5, blur: 0.22, ring: 1.5 } as const;
/**
 * 線の太さ（design-system 2.3、2026-11-18）：役割で決まる。hair 区切り・枠・グリッド・目盛り、select 選んでいる枠・
 * 強調の輪・当日の枠、focus フォーカスの輪・操作のアイコンの線・強い区切り。グラフの値の線は lineLook / barLook から。
 */
export const STROKE = { hair: 1, select: 1.5, focus: 2 } as const;

/** The least a finger can press (px, iPhone): a control drawn smaller is pressable this far past what it shows. */
export const TAP = { min: 44 } as const;
/** 肌感マップ's cell: its inner edge fades over edgeBlur from a band edgeSpread wide (px). */
export const FEEL_CELL = { edgeBlur: 4, edgeSpread: 1 } as const;

/** Elevation: what sits above what. Shadows deepen with height. */
const shadow = { ...THEMES.navy.shadow };

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
const effect = { ...THEMES.navy.effect };

// ---- output -------------------------------------------------------------------------------------

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** All tokens as CSS custom properties: --surface-base, --data-hot, --space-4, --motion-enter … */
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (
    group: string,
    values: Record<string, string | number>,
    unit = "",
  ) => {
    for (const [k, v] of Object.entries(values))
      out[`--${group}-${kebab(k)}`] = typeof v === "number" ? `${v}${unit}` : v;
  };
  put("surface", surface);
  put("ink", ink);
  put("line", line);
  put("accent", accent);
  put("chart", chart);
  put("data", DATA);
  put("day", day);
  put("status", status);
  FEEL_LEVELS.forEach((c, i) => (out[`--feel-${i}`] = c));
  FEEL_EDGES.forEach((c, i) => (out[`--feel-edge-${i}`] = c));
  put("font", font);
  put("size", size, "px");
  put("weight", weight);
  put("space", space, "px");
  put("radius", radius, "px");
  put("feel-band", { divider: FEEL_BAND.divider, ring: FEEL_BAND.ring }, "px");
  put("feel-cell", FEEL_CELL, "px");
  put("tap", TAP, "px");
  put("stroke", STROKE, "px");
  put("shadow", shadow);
  put("layer", LAYER);
  put(
    "motion",
    {
      quick: MOTION.quick,
      base: MOTION.base,
      enter: MOTION.enter,
      exit: MOTION.exit,
    },
    "ms",
  );
  put("ease", MOTION.ease);
  put("effect", effect);
  return out;
}

/**
 * 空の色の上に描くもの（2026-11-20 渡辺さんの実機、#241）：太陽と月のグラフ・空を見上げる・時間帯の太陽の帯は、地が
 * 空の色（shared/sky.ts）で、どのテーマでも同じ（夜は紺）。その上の線・点・文字をページの地に合わせたテーマの色で描くと、
 * 明るいテーマでは濃い線が紺の空に溶ける（「線は乗っている面に対して 3:1」の面は、ページではなく空）。そこで空の上だけは
 * テーマによらず Deep Navy の色（暗い地に合わせた色）を使う。style に渡すと、その中の文字・線・面の色の変数が置き換わる。
 */
export function onSkyVars(): Record<string, string> {
  const out: Record<string, string> = {};
  const n = THEMES.navy;
  for (const [group, values] of [["ink", n.ink], ["line", n.line], ["surface", n.surface]] as const)
    for (const [k, v] of Object.entries(values)) out[`--${group}-${kebab(k)}`] = v;
  return out;
}
/** 空の上の太陽と月の色（onSkyVars と同じ考え）。 */
export const SKY_ICON: Palette["icon"] = THEMES.navy.icon;

/** Write the tokens onto :root (once, before the first render). */
/**
 * Puts a theme in use: the colour objects SVG reads are filled in place, and every token is written
 * as a CSS custom property on the root, with the page's color-scheme and the browser's theme colour.
 */
export function applyTheme(
  name: ThemeName,
  root: HTMLElement = document.documentElement,
) {
  const t = THEMES[name];
  current = name;
  Object.assign(surface, t.surface);
  Object.assign(ink, t.ink);
  Object.assign(line, t.line);
  Object.assign(accent, t.accent);
  Object.assign(chart, t.chart);
  Object.assign(DATA, t.data);
  Object.assign(day, t.day);
  Object.assign(status, t.status);
  Object.assign(ICON, t.icon);
  Object.assign(shadow, t.shadow);
  Object.assign(effect, t.effect);
  FEEL_LEVELS.splice(0, FEEL_LEVELS.length, ...t.feel);
  FEEL_EDGES.splice(0, FEEL_EDGES.length, ...t.feelEdge);
  FEEL_SCALE_COLORS[5] = [...t.feel5];
  FEEL_SCALE_COLORS[3] = [...t.feel3];
  BAND_LINES.splice(0, BAND_LINES.length, ...t.bands);
  LINE.reference = t.reference.color;
  LINE.referenceOpacity = t.reference.opacity;
  LINE.opacity.compare = t.compareOpacity;
  LINE.dimmed = t.ink.disabled;
  for (const [k, v] of Object.entries(cssVariables()))
    root.style.setProperty(k, v);
  root.dataset.theme = name;
  root.style.colorScheme = t.dark ? "dark" : "light";
  if (typeof document !== "undefined")
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", t.surface.page);
}

/** The tokens of the theme in use (Deep Navy until another is chosen). */
export function applyTokens(root: HTMLElement = document.documentElement) {
  applyTheme(current, root);
}

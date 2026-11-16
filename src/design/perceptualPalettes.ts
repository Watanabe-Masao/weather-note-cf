/**
 * Perceptual-distance redesign candidates (not yet activated).
 *
 * Brand invariant: Deep Navy = depth, Mist Green = nature, Warm White = light.
 * Equal semantic roles should have comparable *perceived* salience on each theme.
 * Numeric contrast is a safety check, not a substitute for device-level review.
 *
 * Do not use this module as the live source until screenshot and accessibility
 * checks have been completed. Existing tokens.ts remains authoritative.
 */
export type ThemeName = "deep-navy" | "mist-green" | "warm-white";

export interface PerceptualPalette {
  surface: { page: string; base: string; raised: string; overlay: string; inset: string };
  ink: { primary: string; secondary: string };
  border: { card: string; control: string; divider: string; selected: string };
  accent: string;
  chart: {
    temperature: string;
    lowTemperature: string;
    reference: string;
    grid: string;
    forecastHatch: string;
  };
  icon: { moon: string; sun: string; cloud: string };
}

/** Initial candidates; every foreground/background pairing needs validation. */
export const PERCEPTUAL_PALETTES: Record<ThemeName, PerceptualPalette> = {
  "deep-navy": {
    surface: { page: "#101B2C", base: "#172337", raised: "#1E2C40", overlay: "#243349", inset: "#131F30" },
    ink: { primary: "#D9D1C4", secondary: "#ADA99F" },
    border: { card: "#42536A", control: "#60768D", divider: "#34465A", selected: "#91B49B" },
    accent: "#91B49B",
    chart: { temperature: "#D89C8B", lowTemperature: "#83B6DB", reference: "#A9B4BF", grid: "#35465A", forecastHatch: "#536176" },
    icon: { moon: "#C4B78E", sun: "#D9B15E", cloud: "#A8B8C8" },
  },
  "mist-green": {
    surface: { page: "#C4D0C1", base: "#D2DCCF", raised: "#F1F4EE", overlay: "#F0F3EC", inset: "#A6B9A5" },
    ink: { primary: "#26382C", secondary: "#4B6050" },
    border: { card: "#9EAF9B", control: "#819881", divider: "#B0C0AD", selected: "#356C53" },
    accent: "#356C53",
    chart: { temperature: "#A85142", lowTemperature: "#356D98", reference: "#667A70", grid: "#AAB9A8", forecastHatch: "#9CAC9C" },
    icon: { moon: "#786A45", sun: "#9B721D", cloud: "#667F83" },
  },
  "warm-white": {
    surface: { page: "#F7F5F0", base: "#F0EDE6", raised: "#FFFEFB", overlay: "#FFFFFF", inset: "#E9E5DD" },
    ink: { primary: "#243448", secondary: "#536274" },
    border: { card: "#D0CDC5", control: "#B9B5AB", divider: "#DFDBD3", selected: "#356C53" },
    accent: "#356C53",
    chart: { temperature: "#B65A49", lowTemperature: "#3273A5", reference: "#7A8791", grid: "#D6D2CA", forecastHatch: "#C9C6BF" },
    icon: { moon: "#85744A", sun: "#A97B1A", cloud: "#71899D" },
  },
};

/** Relative luminance of an opaque sRGB hex color, for WCAG checks. */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid sRGB color: ${hex}`);
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast for two opaque colors. This does NOT model perceived salience. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Roles to compare using identical content and geometry across all themes:
 * - main temperature: strongest chart series
 * - comparison temperature: same hue, dashed and slightly less salient
 * - reference: subdued but legible
 * - moon/cloud/sun: recognizable at actual small icon size
 * - grid/hatch: subordinate to data; hatch must not mask the line
 *
 * A numeric pass does not constitute visual approval. Check on iPhone in both
 * bright and dim surroundings and test color-vision variations.
 */

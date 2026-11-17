// The values written by hand in src/ (#142): spacing, line widths, transparency, shadows, times and, in
// the code, corners and sizes. Counted by kind and value, so test/ui/hardcode.test.ts can hold them to
// the list in test/ui/hardcode-budget.json: a value off the scale is an exception on the list, and the
// list may not grow (docs/design-system.md「段にない値」).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The scales in src/design/tokens.ts (space, radius, MOTION), as px / ms. */
export const SPACE_STEPS = new Set([2, 4, 6, 8, 10, 12, 16, 20, 24]);
const MOTION_STEPS = new Set([140, 220, 260, 380]);

export interface Hit {
  /** e.g. 余白・段の値 / 余白・段にない値 / 線の太さ / 透かし・不透明度 … */
  kind: string;
  /** The value written (3px, 1.5, accent-base 8% …). */
  value: string;
  file: string;
  line: number;
  text: string;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?)$/.test(f) ? [p] : [];
  });
}

/** Comments out, line breaks kept (so line numbers stay). */
const blankComments = (s: string, css: boolean) =>
  s.replace(css ? /\/\*[\s\S]*?\*\//g : /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

function scanCss(file: string, src: string, out: Hit[]) {
  blankComments(src, true)
    .split("\n")
    .forEach((l, i) => {
      for (const m of l.matchAll(/(?:^|[\s;{])([a-z-]+)\s*:\s*([^;{}]+)/g)) {
        const [, prop, raw] = m;
        const val = raw.trim();
        const add = (kind: string, value: string) => out.push({ kind, value, file, line: i + 1, text: `${prop}: ${val}`.slice(0, 160) });
        const pxs = [...val.replace(/var\([^)]*\)/g, "").matchAll(/(-?\d*\.?\d+)px/g)].map((x) => Math.abs(Number(x[1]))).filter((n) => n !== 0);
        if (/^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-[a-z]+)?$/.test(prop)) {
          for (const n of pxs) add(SPACE_STEPS.has(n) ? "余白・段の値" : "余白・段にない値", `${n}px`);
        } else if (/^(border|outline)(-(top|right|bottom|left))?(-width)?$/.test(prop)) {
          for (const n of pxs) add("線の太さ", `${n}px`);
        } else if (prop === "stroke-width" || prop === "text-decoration-thickness") {
          if (!val.includes("var(")) add("線の太さ", val.replace(/px$/, "") + "px");
        } else if (prop === "box-shadow") {
          for (const part of val.split(/,(?![^(]*\))/).map((p) => p.trim().replace(/\s*!important$/, ""))) {
            if (part === "none" || /^var\(--shadow-[a-z]+\)$/.test(part)) continue;
            const ring = /^(?:inset )?0 0 0 ([\d.]+)px\b/.exec(part);
            if (ring) add("線の太さ", `${ring[1]}px`);
            else if (/px/.test(part)) add("影", part.replace(/var\(--([a-z-]+)\)/g, "$1").replace(/color-mix\(.*\)/, "mix"));
          }
        } else if (/^(transition|animation)(-duration|-delay)?$/.test(prop)) {
          for (const t of val.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
            const ms = t[2] === "s" ? Number(t[1]) * 1000 : Number(t[1]);
            add(MOTION_STEPS.has(ms) ? "時間・段の値" : "時間・段にない値", `${ms}ms`);
          }
          for (const e of val.replace(/var\([^)]*\)/g, "").matchAll(/cubic-bezier\([^)]*\)|\b(ease-in-out|ease-in|ease-out|linear|ease)\b/g)) add("時間・動きの曲線", e[0]);
        } else if (prop === "opacity" && !val.includes("var(")) {
          add("透かし・不透明度", val);
        }
        for (const cm of val.matchAll(/color-mix\(in srgb, var\(--([a-z0-9-]+)\) (\d+(?:\.\d+)?)%/g)) add("透かし・混ぜる割合", `${cm[1]} ${cm[2]}%`);
      }
    });
}

function scanCode(file: string, src: string, out: Hit[]) {
  const screen = file.startsWith("ui/") || file.endsWith(".tsx");
  blankComments(src, false)
    .split("\n")
    .forEach((l, i) => {
      const add = (kind: string, value: string, text: string) => out.push({ kind, value, file, line: i + 1, text: text.slice(0, 160) });
      for (const m of l.matchAll(/strokeWidth(?:=\{?\s*|:\s*)["']?(\d*\.?\d+)\b/g)) add("線の太さ", `${m[1]}px`, m[0]);
      for (const m of l.matchAll(/strokeDasharray=["{]\s*["']?([\d. ]+\d)/g)) add("線の太さ・破線", m[1], m[0]);
      for (const m of l.matchAll(/\b(?:opacity|fillOpacity|strokeOpacity)(?:=\{?\s*|:\s*)(\d*\.\d+|[01])\b/g)) add("透かし・不透明度", m[1], m[0]);
      for (const m of l.matchAll(/\b(?:rx|ry)=\{?\s*["']?(\d*\.?\d+)\b|borderRadius:\s*(\d+)/g)) add("角の丸み", `${m[1] ?? m[2]}`, m[0]);
      for (const m of l.matchAll(/\b(?:padding|margin|gap)(?:Top|Bottom|Left|Right)?:\s*(\d+)/g)) add(SPACE_STEPS.has(Number(m[1])) ? "余白・段の値" : "余白・段にない値", `${m[1]}px`, m[0]);
      for (const m of l.matchAll(/fontSize(?:=\{?\s*|:\s*)["']?(\d*\.?\d+)\b/g)) add("文字の大きさ", m[1], m[0]);
      // Times a person feels (a long press, how long a note stays): in the screens only, not the data's waits.
      if (screen) {
        for (const m of l.matchAll(/(?:setTimeout|setInterval)\([\s\S]*?,\s*(\d+)\)/g)) add("時間・操作", `${m[1]}ms`, m[0]);
        for (const m of l.matchAll(/\b[A-Z_]*(?:MS|LONG_PRESS|DELAY)\w*\s*=\s*(\d{2,5})\b(?!\s*\*)|\bms\s*=\s*(\d{2,5})\b/g)) add("時間・操作", `${m[1] ?? m[2]}ms`, m[0]);
      }
      for (const m of l.matchAll(/transition:\s*["'`]([^"'`]*)/g))
        for (const t of m[1].matchAll(/(\d+)ms/g)) add(MOTION_STEPS.has(Number(t[1])) ? "時間・段の値" : "時間・段にない値", `${t[1]}ms`, m[0]);
    });
}

/** Every value written by hand in src/ (src/design is the tokens themselves, and is left out). */
export function hardcodedValues(root: string): Hit[] {
  const out: Hit[] = [];
  for (const p of files(root)) {
    const file = p.slice(root.length + 1);
    if (file.startsWith("design/")) continue;
    const src = readFileSync(p, "utf8");
    if (file.endsWith(".css")) scanCss(file, src, out);
    else scanCode(file, src, out);
  }
  return out;
}

/** kind → value → count, sorted, as test/ui/hardcode-budget.json holds it. */
export function budgetOf(hits: Hit[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const h of hits) (out[h.kind] ??= {})[h.value] = (out[h.kind][h.value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort(([a], [b]) => (parseFloat(a) - parseFloat(b)) || (a < b ? -1 : 1)))]),
  );
}

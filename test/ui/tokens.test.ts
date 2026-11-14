/// <reference lib="dom" />
// tokens.ts also writes the tokens into the page (applyTokens), so it needs the DOM types.
// Guards for the design tokens (#142): every var(--…) names a token or a variable set on the spot,
// so a misspelt name can no longer fall back to a colour of its own.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssVariables } from "../../src/design/tokens";

const SRC = join(__dirname, "../../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?)$/.test(f) ? [p] : [];
  });
}

const all = files(SRC).map((p) => ({ p: p.slice(SRC.length + 1), s: readFileSync(p, "utf8") }));

describe("design tokens", () => {

  it("every var(--…) is a token or a variable set in the code", () => {
    const tokens = new Set(Object.keys(cssVariables()));
    // Set on the spot: `--col: …` in CSS, or the name as a string in TSX (`["--col" as string]: …`).
    const local = new Set(all.flatMap(({ s }) => [...s.matchAll(/["'](--[a-z0-9-]+)["']|(?:^|[\s{;])(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1] ?? m[2])));
    const unknown = all.flatMap(({ p, s }) =>
      [...s.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]).filter((v) => !tokens.has(v) && !local.has(v)).map((v) => `${p}: ${v}`),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("a token is used without a fallback of its own (the fallback would drift from the token)", () => {
    const tokens = new Set(Object.keys(cssVariables()));
    const withFallback = all.flatMap(({ p, s }) =>
      [...s.matchAll(/var\((--[a-z0-9-]+)\s*,/g)].map((m) => m[1]).filter((v) => tokens.has(v)).map((v) => `${p}: ${v}`),
    );
    expect(withFallback).toEqual([]);
  });
});

describe("type scale", () => {
  const css = readFileSync(join(SRC, "styles.css"), "utf8");

  it("every font-size is a step of the scale (or inherits, or a step under its parent floored at xs)", () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].replace(/\s*!important/, "").trim());
    const ok = (v: string) => /^var\(--size-(xs|sm|base|md|lg|xl|input)\)$/.test(v) || v === "inherit" || /^max\(var\(--size-xs\), [0-9.]+em\)$/.test(v);
    expect(sizes.filter((v) => !ok(v))).toEqual([]);
  });

  it("weights and families come from the tokens, and the font shorthand is not used (it would hide a size)", () => {
    expect([...css.matchAll(/(?:^|[\s;{])font:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => v !== "inherit")).toEqual([]);
    expect([...css.matchAll(/font-weight:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--weight-[a-z]+\)$/.test(v))).toEqual([]);
    expect([...css.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--font-[a-z]+\)$/.test(v) && v !== "inherit")).toEqual([]);
  });

  it("the input size is used only on inputs (16px keeps iPhone from zooming)", () => {
    const rules = [...css.matchAll(/([^{}]+)\{[^}]*font-size:\s*var\(--size-input\)/g)].map((m) => m[1].trim());
    expect(rules.filter((r) => !/input/.test(r))).toEqual([]);
  });
});

describe("faces: colour, corners, depth", () => {
  const css = readFileSync(join(SRC, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("no colour is written in the stylesheet (tokens or color-mix of tokens only)", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []).toEqual([]);
  });

  it("no colour is written in the screens' code (src/ui, src/App.tsx): it comes from the tokens", () => {
    const code = all.filter(({ p }) => /\.tsx?$/.test(p) && !p.startsWith("design/"));
    const hits = code.flatMap(({ p, s }) => (s.match(/["'`]#[0-9a-fA-F]{3,8}["'`]|rgba?\([0-9][^)]*\)/g) ?? []).map((m) => `${p}: ${m}`));
    expect(hits).toEqual([]);
  });

  it("corners are steps of the radius scale (or 0, or a circle)", () => {
    const values = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
    const ok = (v: string) => v.split(/\s+/).every((p) => /^var\(--radius-[a-z]+\)$/.test(p) || p === "0" || p === "50%");
    expect(values.filter((v) => !ok(v))).toEqual([]);
  });

  it("stacking uses the layers (a small local order inside one part is fine)", () => {
    const values = [...css.matchAll(/z-index:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(values.filter((v) => !/^var\(--layer-[a-z-]+\)$/.test(v) && !/^[0-3]$/.test(v))).toEqual([]);
  });
});

describe("cards: 浮いた面 and 沈んだ面 only (#151)", () => {
  const css = readFileSync(join(SRC, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const CARDS = ["compare-summary", "band-summary", "lt-head", "cal-pair", "set-group", "cond-list", "cond-table", "readout-card", "predict-card", "sun-card"];
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

  it("each card's surface, corner and edge are set in the one card rule, not again on its own", () => {
    const again = rules.flatMap(({ sel, body }) => {
      const parts = sel.split(",").map((p) => p.trim());
      const own = CARDS.filter((c) => parts.includes(`.${c}`));
      // The card rules list several cards; a rule naming one card alone must not redo its face.
      if (own.length !== 1 || parts.length > 1) return [];
      return /(^|;)\s*(background|border-radius|box-shadow)\s*:/.test(body) ? [`.${own[0]}`] : [];
    });
    expect(again).toEqual([]);
  });
});

describe("marks are drawn, not typed (#151)", () => {
  // ◀ ▶ ＋ − ↔ ● ○ ▾ ☀ ☁ typed as a button's or a tag's whole content sit at the height each font
  // chooses (low on one phone, centred on another). They are drawn with kit's Glyph instead. A mark
  // inside a sentence (確かさは ●●● ほど) is text and stays.
  const MARK = "[◀▶◁▷＋−↔⇄●○▾▴▼▲☀☁]";
  it("no mark is typed as the whole content of an element", () => {
    // A − or ＋ chosen in a ternary is a number's sign (−4.9), which is text; the marks below are not.
    const ICON = "[◀▶◁▷↔⇄●○▾▴▼▲☀☁]";
    const alone = new RegExp(`(>\\s*${MARK}+\\s*<)|(\\{\\s*"${MARK}+"(\\.repeat\\([^)]*\\))?\\s*\\})|(\\?\\s*"${ICON}+"\\s*:)|(:\\s*"${ICON}+"\\s*\\})`, "g");
    const code = all.filter(({ p }) => /\.tsx$/.test(p));
    const hits = code.flatMap(({ p, s }) => (s.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "").match(alone) ?? []).map((m) => `${p}: ${m.trim()}`));
    expect(hits).toEqual([]);
  });
  it("and not as a CSS content mark", () => {
    const css = readFileSync(join(SRC, "styles.css"), "utf8");
    expect(css.match(new RegExp(`content:\\s*"${MARK}+"`, "g")) ?? []).toEqual([]);
  });
});

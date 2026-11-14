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

describe("design tokens", () => {
  const all = files(SRC).map((p) => ({ p: p.slice(SRC.length + 1), s: readFileSync(p, "utf8") }));

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

  it("the input size is used only on inputs (16px keeps iPhone from zooming)", () => {
    const rules = [...css.matchAll(/([^{}]+)\{[^}]*font-size:\s*var\(--size-input\)/g)].map((m) => m[1].trim());
    expect(rules.filter((r) => !/input/.test(r))).toEqual([]);
  });
});

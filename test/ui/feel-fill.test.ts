// 肌感の塗り（面）はエンジンの部品だけで描く (2026-11-18 渡辺さん「外枠のぼかしもエンジンに」)：縁の色（--feel-edge）を
// 渡すのは feelFillLook だけ、縁のぼかしを描くのは .feel-fill（と、上端の光を重ねる肌感マップのマス）だけ。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEEL_LEVELS, feelEdgeOf, feelFillLook } from "../../src/design/tokens";

const SRC = join(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?)$/.test(f) ? [p] : [];
  });
const all = files(SRC).map((p) => ({ p: p.slice(SRC.length + 1), s: readFileSync(p, "utf8") }));

describe("肌感の塗り（feelFillLook・.feel-fill）", () => {
  it("gives every step its own lighter edge", () => {
    for (const c of FEEL_LEVELS) expect(feelFillLook(c)).toEqual({ background: c, "--feel-edge": feelEdgeOf(c) });
  });
  it("hands the edge colour over only through feelFillLook", () => {
    const by = all.filter((f) => !f.p.startsWith("design/") && f.p.endsWith(".tsx") && f.s.includes('"--feel-edge"'));
    expect(by.map((f) => f.p)).toEqual([]);
  });
  it("draws the edge only in .feel-fill and 肌感マップ's cells", () => {
    const css = all.filter((f) => f.p.endsWith(".css"));
    const rules = css.flatMap((f) => [...f.s.matchAll(/([^{}]+)\{[^}]*var\(--feel-edge,[^}]*\}/g)].map((m) => m[1].trim().split("\n").pop()!.trim()));
    expect(rules.sort()).toEqual([".bm-a", ".bm-b", ".feel-fill"]);
  });
});

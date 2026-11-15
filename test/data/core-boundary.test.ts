// 層の境目 (docs/engineering-principles.md 1): files in src/core import nothing from outside
// src/core but the shared types — no store, no React, no settings, no fetching.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseAst } from "rolldown/parseAst";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const CORE = join(ROOT, "src/core");
const ALLOWED = new Set([join(ROOT, "shared/types.ts")]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("src/core stays inside its walls", () => {
  for (const file of files(CORE))
    it(relative(ROOT, file), () => {
      const text = readFileSync(file, "utf8");
      for (const [, spec] of text.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)) {
        expect(spec.startsWith("."), `${spec}: パッケージを読み込まない`).toBe(true);
        const target = resolve(dirname(file), spec);
        const path = /\.tsx?$/.test(target) ? target : `${target}.ts`;
        const inside = path.startsWith(CORE + "/") || ALLOWED.has(path);
        expect(inside, `${spec}: src/core の外を読み込まない`).toBe(true);
      }
      expect(text, "fetch しない").not.toMatch(/\bfetch\(/);
    });
});

// 計算式とパラメータを分ける (principles 5): outside params.ts and constants.ts, the only numbers
// written in src/core are 0 and 1. Every other number has a name, a unit and a basis there. Read
// from the syntax tree (the parser the build already uses, rolldown/oxc; TypeScript 7 has no JS
// API), so comments, strings and template text are not numbers, and a number inside ${…} is.
const NUMBER_FILES = /(^|\/)(params|constants)\.ts$/;
function numbersIn(text: string): string[] {
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "Literal" && (typeof n.value === "number" || typeof n.value === "bigint")) out.push(String(n.value));
    for (const v of Object.values(n)) visit(v);
  };
  visit(parseAst(text, { lang: "ts" }));
  return out;
}

describe("no magic numbers in formulas", () => {
  for (const file of files(CORE).filter((f) => !NUMBER_FILES.test(f)))
    it(relative(ROOT, file), () => {
      const numbers = numbersIn(readFileSync(file, "utf8"));
      expect(numbers.filter((n) => +n !== 0 && +n !== 1), "数は params.ts か constants.ts に名前を付けて置く").toEqual([]);
    });

  it("the check reads code, not comments or strings", () => {
    expect(numbersIn("const x = a * 0.7; // 30日\nconst s = \"24時\";")).toEqual(["0.7"]);
    expect(numbersIn("const t = `${a * 3600}秒 30分`;")).toEqual(["3600"]);
    expect(numbersIn("x[0] + x1 - 1 + 1e3 + 0x10 + 2n")).toEqual(["0", "1", "1000", "16", "2"]);
    expect(numbersIn("/* 24 */ type H = 24;")).toEqual(["24"]);
  });
});

// 学習なし版と学習あり版 (principles 0): only learned/ may reach learned/. The material, the
// estimates and the plain version never read the learned version or the answers.
describe("the plain version does not lean on learning", () => {
  for (const file of files(CORE).filter((f) => !f.startsWith(join(CORE, "learned") + "/")))
    it(relative(ROOT, file), () => {
      const text = readFileSync(file, "utf8");
      for (const [, spec] of text.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)) {
        const target = resolve(dirname(file), spec);
        expect(target.startsWith(join(CORE, "learned")), `${spec}: 学習あり版を読み込まない`).toBe(false);
      }
    });
});

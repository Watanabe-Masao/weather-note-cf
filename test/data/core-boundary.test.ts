// 層の境目 (docs/engineering-principles.md 1): files in src/core import nothing from outside
// src/core but the shared types — no store, no React, no settings, no fetching.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

// 依存の図 (principles 5, 8 DRY): drawn from the formulas, never by hand. This test also writes the
// document when asked (npm run core-map).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type AnyFormula, coreMapDoc, edges, FORMULAS, MATERIAL_INPUTS } from "../../src/core";

const DOC = resolve(__dirname, "../../docs/core-map.md");

describe("the map is the formulas'", () => {
  if (process.env.CORE_MAP_WRITE) it("writes docs/core-map.md", () => writeFileSync(DOC, coreMapDoc()));

  it("docs/core-map.md is up to date (npm run core-map)", () => {
    expect(readFileSync(DOC, "utf8")).toBe(coreMapDoc());
  });

  it("every formula in src/core/estimate is on the map", () => {
    const modules = import.meta.glob("../../src/core/estimate/*/formula.ts", { eager: true }) as Record<string, Record<string, unknown>>;
    const found = Object.values(modules).flatMap((m) => Object.values(m).filter((v): v is AnyFormula => typeof v === "object" && v != null && "compute" in v && "needs" in v));
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(FORMULAS, f.id).toContain(f);
  });

  it("ids and keys are unique, and a key is never a material's name", () => {
    const ids = FORMULAS.map((f) => `${f.id}@${f.version}`);
    const keys = FORMULAS.map((f) => f.key);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(Object.keys(MATERIAL_INPUTS)).not.toContain(k);
  });

  it("every need comes from the material or from a formula on the map", () => {
    const known = new Set([...Object.keys(MATERIAL_INPUTS), ...FORMULAS.map((f) => f.key)]);
    for (const e of edges()) expect(known.has(e.from), `${e.to} needs ${e.from}`).toBe(true);
  });

  it("no formula depends on itself, however far round", () => {
    const next = new Map<string, string[]>();
    for (const e of edges()) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean =>
      (next.get(from) ?? []).some((n) => n === target || (!seen.has(n) && (seen.add(n), reaches(n, target, seen))));
    for (const f of FORMULAS) expect(reaches(f.key, f.key), f.id).toBe(false);
  });
});

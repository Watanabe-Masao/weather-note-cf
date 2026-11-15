// The model system's catalog (#189): the rules it keeps, and the map written from it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../../src/model/catalog";
import { modelMap, recipeSources } from "../../src/model/map";
import { type Catalog, ruleGaps, validate } from "../../src/model/registry";
import { MODELS } from "../../src/beta/engine/model";
import { DRIVERS } from "../../src/beta/engine/drivers";

describe("model catalog", () => {
  it("is whole: every input, driver and part it names is registered, and nothing runs in a circle", () => {
    expect(validate(CATALOG)).toEqual([]);
  });

  it("finds what is wrong", () => {
    const bad: Catalog = {
      ...CATALOG,
      parts: [...CATALOG.parts, { id: "x/a", label: "", family: "日", status: "候補", inputs: ["x/b"], unit: "", impl: "" }, { id: "x/b", label: "", family: "日", status: "候補", inputs: ["x/a", "入力/ない"], unit: "", impl: "" }],
    };
    const errs = validate(bad);
    expect(errs.some((e) => e.startsWith("循環"))).toBe(true);
    expect(errs.some((e) => e.includes("入力/ない"))).toBe(true);
  });

  it("keeps the data rule: a part in use reads only sources that records and forecasts both have, but for the gaps named with their issue", () => {
    const gaps = ruleGaps(CATALOG);
    expect(gaps.filter((g) => !g.known)).toEqual([]);
    // Today's known gap: β's stored warmth reads the measured radiation, else the forecast's (#103).
    expect(gaps.map((g) => g.part).sort()).toEqual(["余熱/日中の日射", "日射/実測か予報"]);
  });

  it("has every β model as a recipe, with the same drivers in the same roles", () => {
    for (const m of MODELS) {
      const r = CATALOG.recipes.find((x) => x.id === `β/${m.id}`)!;
      expect(r.roles.中心 ?? []).toEqual(m.mu);
      expect(r.roles.幅 ?? []).toEqual(m.h);
      expect(r.roles.場所 ?? []).toEqual(m.e ?? []);
    }
    expect(CATALOG.drivers.map((d) => d.key).sort()).toEqual(Object.keys(DRIVERS).sort());
  });

  it("says which sources a recipe reads in the end", () => {
    expect(recipeSources(CATALOG, "従来版")).toEqual(expect.arrayContaining(["入力/気温", "入力/日照"]));
    expect(recipeSources(CATALOG, "β/M7")).toContain("入力/日射の予報");
  });

  it("the map in docs is the one the catalog writes (npm run model-map)", () => {
    const doc = readFileSync(new URL("../../docs/model-map.md", import.meta.url), "utf8");
    expect(doc.trim()).toBe(modelMap(CATALOG).trim());
  });
});

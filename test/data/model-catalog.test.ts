// The model system's catalog (#189): the rules it keeps, and the map written from it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../../src/model/catalog";
import { driverSources, modelMap } from "../../src/model/map";
import { type Catalog, ruleGaps, validate } from "../../src/model/registry";
import { MODELS } from "../../src/beta/engine/model";
import { DRIVERS } from "../../src/beta/engine/drivers";
import { MODEL_VERSION } from "../../src/beta/engine/prediction";

describe("model catalog", () => {
  it("is whole: every input, driver and part it names is registered, nothing runs in a circle, every difference is named", () => {
    expect(validate(CATALOG)).toEqual([]);
  });

  it("finds what is wrong", () => {
    const bad: Catalog = {
      ...CATALOG,
      parts: [
        ...CATALOG.parts,
        { id: "x/a", label: "", family: "日", status: "候補", inputs: ["x/b"], unit: "", impl: "" },
        { id: "x/b", label: "", family: "日", status: "候補", inputs: ["x/a", "入力/ない"], unit: "", impl: "" },
      ],
      drivers: [...CATALOG.drivers, { key: "z", label: "", unit: "", learn: { from: ["日/雨"], impl: "", stored: true }, predict: { from: ["日/雨"], impl: "" } }],
    };
    const errs = validate(bad);
    expect(errs.some((e) => e.startsWith("循環"))).toBe(true);
    expect(errs.some((e) => e.includes("入力/ない"))).toBe(true);
    expect(errs.some((e) => e.includes("要因 z") && e.includes("違いが書かれていない"))).toBe(true);
  });

  it("keeps the data rule: weather in both records and forecasts, but for the gaps named with their issue", () => {
    const gaps = ruleGaps(CATALOG);
    expect(gaps.filter((g) => !g.known)).toEqual([]);
    // Today's only gap: radiation measured or forecast (#103), and what is built from it.
    expect(new Set(gaps.map((g) => g.known))).toEqual(new Set([103]));
    expect(gaps.map((g) => g.what).sort()).toEqual(["余熱/日中の日射", "要因 radNight", "要因 radNightWind", "日/日射", "日射/実測か予報"].sort());
  });

  it("lists the drivers learning and a day's prediction build differently (S2 makes them one)", () => {
    expect(CATALOG.drivers.filter((d) => d.differs).map((d) => d.key)).toEqual(["E", "windFelt", "hNow", "sky", "radNight", "radNightWind", "coldNightWind", "y"]);
  });

  it("has every β model as a recipe with the same drivers in the same roles, and one model version", () => {
    for (const m of MODELS) {
      const r = CATALOG.recipes.find((x) => x.id === `β/${m.id}`)!;
      expect(r.roles.中心 ?? []).toEqual(m.mu);
      expect(r.roles.幅 ?? []).toEqual(m.h);
      expect(r.roles.場所 ?? []).toEqual(m.e ?? []);
    }
    expect(Object.keys(DRIVERS).every((k) => CATALOG.drivers.some((d) => d.key === k))).toBe(true);
    expect(CATALOG.modelVersion).toBe(MODEL_VERSION);
  });

  it("says which weather a driver's prediction reads in the end", () => {
    expect(driverSources(CATALOG, "spring")).toEqual(["計算/日付と地点"]);
    expect(driverSources(CATALOG, "radNight")).toContain("入力/日射の予報");
  });

  it("the map in docs is the one the catalog writes (npm run model-map)", () => {
    const doc = readFileSync(new URL("../../docs/model-map.md", import.meta.url), "utf8");
    expect(doc.trim()).toBe(modelMap(CATALOG).trim());
  });
});

// #47: the model the app uses must have an adopted experiment record, and every record must be
// complete. Raising MODEL_VERSION without a record fails here — a model is never promoted
// without its checks written down.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Manifest, problems } from "../../research/comfort-model/manifest";
import { MODEL_VERSION } from "../../src/beta/comfort";
import { SCALE_VERSION } from "../../src/beta/reports";

const dir = new URL("../../research/comfort-model/experiments/", import.meta.url);
const manifests = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, m: JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Manifest }));

describe("#47: model promotion", () => {
  it("every experiment record is complete", () => {
    for (const { file, m } of manifests) expect(problems(m), file).toEqual([]);
    for (const { file, m } of manifests) expect(file).toBe(`${m.id}.json`);
  });

  it(`the model in use (${MODEL_VERSION}) has an adopted record on the current scale version`, () => {
    const adopted = manifests.filter(({ m }) => m.modelVersion === MODEL_VERSION && m.decision === "adopted");
    expect(adopted.length, `research/comfort-model/experiments/ に ${MODEL_VERSION} の採用の記録がない`).toBeGreaterThan(0);
    expect(adopted.some(({ m }) => m.scaleVersion === SCALE_VERSION)).toBe(true);
  });

  it("refuses an incomplete or self-contradicting record", () => {
    expect(problems({ id: "x" }).length).toBeGreaterThan(5);
    const ok = manifests[0].m;
    expect(problems({ ...ok, checks: { ...ok.checks, performance: false }, decision: "adopted" })).toContain("不合格の項目があるのに採用している");
    expect(problems({ ...ok, dataset: { ...ok.dataset, kind: "real", period: null } })).toContain("実データなのに評価の期間がない");
  });
});

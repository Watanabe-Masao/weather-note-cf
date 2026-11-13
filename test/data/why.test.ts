import { describe, expect, it } from "vitest";
import { MODELS, priorFor } from "../../src/beta/engine/model";
import { whyLine, whyTerms } from "../../src/beta/engine/why";
import type { Drivers } from "../../src/beta/engine/drivers";
import type { Ensemble } from "../../src/beta/engine/ensemble";

const fitOf = (id: string, edit: (t: number[]) => void) => {
  const model = MODELS.find((m) => m.id === id)!;
  const prior = priorFor(model);
  const theta = [...prior.mean];
  edit(theta);
  return { model, theta, cov: null, prior, n: 40, logEvidence: 0 };
};
const x = { e: 15, a: 18, dT1: -4, h1: 65, sun1: 5, rain1: 0, v7: 2, windFelt: "weak" } as unknown as Drivers;

describe("なぜ (#118)", () => {
  it("is the shared constants exactly: nothing to say", () => {
    const ens: Ensemble = { alpha: 0.8, fits: [fitOf("M1", () => {})], weights: [1], n: 40 };
    const t = whyTerms(ens, x);
    expect(t[0].effect).toBeCloseTo(0, 9);
    expect(whyLine(t)).toBe("");
  });

  it("names the person's level and the previous day's change, largest first", () => {
    // M1: the person's level 2.4 above. M3: the same, and −0.2 per ℃ of 前日の変化 (−4 ℃: +0.8).
    const m1 = fitOf("M1", (t) => (t[0] = 20.4));
    const m3 = fitOf("M3", (t) => {
      t[0] = 20.4;
      t[2] = -0.2;
    });
    const ens: Ensemble = { alpha: 0.8, fits: [m1, m3], weights: [0.5, 0.5], n: 40 };
    const t = whyTerms(ens, x);
    expect(t[0].key).toBe("personal");
    expect(t[0].effect).toBeCloseTo(2.4, 9);
    expect(t[1].key).toBe("dT1");
    expect(t[1].effect).toBeCloseTo(0.5 * 0.8, 9);
    const line = whyLine(t);
    expect(line).toContain("出発点（従来版の中心＋慣れ）より +2.4（寒く感じやすい）");
    expect(line).toContain("前日の気温の変化で ちょうどよいが +0.4（寒く感じる側）");
  });
});

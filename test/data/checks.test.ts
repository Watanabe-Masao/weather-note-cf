import { describe, expect, it } from "vitest";
import { checksOf, MIN_FOR_SLOPE, sharedPrediction } from "../../src/beta/engine/checks";
import { seeded } from "../../src/beta/engine/diagnostics";
import { type Report, SCALE_VERSION } from "../../src/beta/reports";

/** Answers of a person who feels 0.6 colder per m/s of wind than the 肌感 says, predicted with the
 *  shared constants (as if nothing was learned), so the checks should point at the wind. */
function people(n: number, windFault: number, seed = 4): Report[] {
  const r = seeded(seed);
  const out: Report[] = [];
  let t = Date.parse("2026-10-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    t += (r() < 0.5 ? 6 : 30) * 3_600_000;
    const a = 18 + r() * 4, e = a + (r() - 0.5) * 16, wind = r() * 7;
    const felt = e - windFault * (wind - 3);
    const p = sharedPrediction(felt, a);
    let u = r(), y = 3;
    for (let k = 0; k < 7; k++) if ((u -= p[k]) <= 0) { y = k - 3; break; }
    const probs = sharedPrediction(e, a);
    out.push({
      id: `r${i}`,
      at: new Date(t).toISOString(),
      sensation: y,
      scaleVersion: SCALE_VERSION,
      exposure: "shade",
      snapshot: { date: "2026-10-01", hour: 8 + Math.floor(r() * 12), temp: e, humidity: 50 + r() * 40, wind, solar: null, from: {}, sunTemp: e, shadeTemp: e, forecastSky: null, forecastSkyCode: null, sunshine: r() },
      baseline: { value: a, alpha: 0.8 },
      comfort: { probs, mode: probs.indexOf(Math.max(...probs)) - 3, models: [] },
      context: { version: 1, from: "button", shownFeel: e, shownExposure: "shade", shownLevel: probs.indexOf(Math.max(...probs)), firstSensation: y, picks: 1, predictionSeen: true, sensationAtPrediction: y, changedAfterPrediction: i % 10 === 0 },
      updatedAt: 1,
    } as unknown as Report);
  }
  return out;
}

describe("checks on the person's own reports (#117, #118)", () => {
  it("points at the wind when the 肌感 misjudges it, and only at it", () => {
    const c = checksOf(people(300, 0.6));
    expect(c.n).toBe(300);
    const wind = c.slopes.find((s) => s.key === "wind")!;
    expect(wind.flagged).toBe(true);
    expect(wind.slope!.slope).toBeLessThan(0);
    expect(c.slopes.filter((s) => s.flagged).map((s) => s.key)).toEqual(["wind"]);
  });

  it("finds nothing when the predictions are right, and keeps the PIT flat", () => {
    const c = checksOf(people(400, 0, 9));
    expect(c.slopes.some((s) => s.flagged)).toBe(false);
    for (const k of c.pit) expect(Math.abs(k - 40)).toBeLessThan(20);
    expect(Math.abs(c.residualMean!)).toBeLessThan(0.3);
    // β predicted exactly the shared constants here: no difference between them.
    expect(c.base!.diff!.mean).toBeCloseTo(0, 9);
  });

  it("does not judge slopes on a few answers, and counts what was seen before answering", () => {
    const c = checksOf(people(MIN_FOR_SLOPE - 1, 0.6));
    expect(c.slopes.every((s) => s.slope == null && !s.flagged)).toBe(true);
    expect(c.context!.n).toBe(MIN_FOR_SLOPE - 1);
    expect(c.context!.changedAfterPrediction).toBe(2);
    expect(checksOf([]).base).toBeNull();
  });
});

describe("the person's levels on the hour graph (#118)", () => {
  it("are the β state's boundaries: centre ± half-range, then outer steps", async () => {
    const { personalThresholds } = await import("../../src/beta/useDayComfort");
    expect(personalThresholds({ mu: 21, h: 2.5, g: 4, s: 1 } as never)).toEqual([10.5, 14.5, 18.5, 23.5, 27.5, 31.5]);
  });
});

describe("朝・夕方の見込みの言葉 (#118)", () => {
  it("names the likeliest step, the next one when close, and how sure", async () => {
    const { outlookWords, sureness } = await import("../../src/ui/PartsOutlook");
    // 7 levels: mostly 涼しい (2), some 寒い (1).
    const w = outlookWords([0, 0.3, 0.6, 0.1, 0, 0, 0], 7);
    expect([w.first, w.second, w.p]).toEqual([2, 1, 0.6]);
    expect(outlookWords([0, 0.1, 0.8, 0.1, 0, 0, 0], 7).second).toBeNull();
    // On 3 steps, 寒い and 涼しい gather into 寒い側.
    expect(outlookWords([0, 0.3, 0.6, 0.1, 0, 0, 0], 3).first).toBe(0);
    expect([sureness(0.75), sureness(0.55), sureness(0.3)]).toEqual([3, 2, 1]);
  });
});

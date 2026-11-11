import { describe, expect, it } from "vitest";
import { errorStats, fitCorrection, predict, priorSensation } from "../../src/beta/predict";
import type { Report } from "../../src/beta/reports";

const T: [number, number, number, number] = [10, 15, 21, 25];

describe("β: the predicted sensation", () => {
  it("reads the place's temperature through the 肌感 boundaries onto −3…+3", () => {
    expect(priorSensation(18, T)).toBe(0); // middle of 過ごしやすい
    expect(priorSensation(15, T)).toBe(-1);
    expect(priorSensation(21, T)).toBe(1);
    expect(priorSensation(10, T)).toBe(-2);
    expect(priorSensation(25, T)).toBe(2);
    expect(priorSensation(-20, T)).toBe(-3); // clamped
    expect(priorSensation(45, T)).toBe(3);
  });

  it("follows the person's own boundaries", () => {
    expect(priorSensation(18, [12, 17, 23, 27])).toBeLessThan(0);
  });

  const report = (i: number, sensation: number, shade: number, windFelt: Report["windFelt"] = "weak"): Report => ({
    id: String(i),
    at: new Date(Date.UTC(2026, 10, 1 + (i % 28), 3)).toISOString(),
    station: "47893",
    sensation: sensation as Report["sensation"],
    exposure: "shade",
    windFelt,
    snapshot: { date: "", hour: 12, temp: shade, humidity: 60, wind: 2, solar: 0, from: {}, sunTemp: shade + 4, shadeTemp: shade, forecastSky: null, forecastSkyCode: null },
    baseline: null,
    departures: null,
    history: Array(60).fill(shade),
    updatedAt: 0,
  });

  it("keeps the correction near 0 with few reports and learns a steady miss with many", () => {
    const few = fitCorrection([report(1, 2, 18)], 0.8, T); // one report 2 steps warmer than the prior's 0
    expect(Math.abs(few.coef[0])).toBeLessThan(1); // moves less than half of one miss
    const many = fitCorrection(Array.from({ length: 80 }, (_, i) => report(i, 1, 18)), 0.8, T);
    expect(many.coef[0]).toBeGreaterThan(0.8);
    const p = predict({ e: 18, d: 0, windFelt: "weak" }, many, T, 0);
    expect(p.value).toBeCloseTo(p.prior + p.correction, 1);
    expect(p.label).toBe("やや暖かい");
  });

  it("learns that a strong wind feels colder", () => {
    const list = Array.from({ length: 80 }, (_, i) => (i % 2 ? report(i, -1, 18, "strong") : report(i, 0, 18, "weak")));
    const fit = fitCorrection(list, 0.8, T);
    expect(predict({ e: 18, d: 0, windFelt: "strong" }, fit, T, 0).value).toBeLessThan(predict({ e: 18, d: 0, windFelt: "weak" }, fit, T, 0).value);
  });

  it("sums up the misses of the predictions made at sending", () => {
    const withPred = (r: Report, v: number): Report => ({ ...r, prediction: { value: v, label: "", prior: v, correction: 0, n: 0, model: "", at: 0 } });
    const s = errorStats([withPred(report(1, 1, 18), 0), withPred(report(2, -1, 18), 0), withPred(report(3, 0, 18), 0), report(4, 2, 18)]);
    expect(s).toMatchObject({ n: 3, bias: 0, mae: 0.7, hit: 0.33 });
  });
});

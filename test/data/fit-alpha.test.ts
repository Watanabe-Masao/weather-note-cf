import { describe, expect, it } from "vitest";
import { runningMean } from "../../src/beta/adaptation";
import { fitAlpha, leastSquaresSse, MIN_REPORTS, STANDARD_ALPHA } from "../../src/beta/fitAlpha";
import type { Report } from "../../src/beta/reports";

/** Deterministic noise. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) - 0.5;
}

/** Reports over `days` days of a season that warms then cools, felt with a true α and γ. */
function simulate(trueAlpha: number, gamma: number, days = 60, perDay = 1, seed = 1): Report[] {
  const noise = rng(seed);
  const series = Array.from({ length: days + 30 }, (_, i) => 15 + 8 * Math.sin(i / 9) + 2 * noise());
  const out: Report[] = [];
  for (let d = 30; d < days + 30; d++) {
    for (let k = 0; k < perDay; k++) {
      const history = Array.from({ length: 30 }, (_, j) => series[d - 1 - j]);
      const base = runningMean(history.map((mean) => ({ mean, forecast: false })), trueAlpha)!.value;
      const t = series[d] + 3 * noise();
      const e = t + 2;
      const raw = 0.25 * (e - 20) + gamma * (t - base) + 0.3 * noise();
      const sensation = Math.max(-3, Math.min(3, Math.round(raw))) as Report["sensation"];
      out.push({
        id: `${d}-${k}`,
        at: new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString(),
        station: "47893",
        sensation,
        exposure: "shade",
        windFelt: "weak",
        snapshot: { date: "", hour: 12, temp: t, humidity: 60, wind: 2, solar: 0, from: {}, sunTemp: e + 3, shadeTemp: e, forecastSky: null, forecastSkyCode: null },
        baseline: null,
        departures: null,
        history,
        updatedAt: 0,
      });
    }
  }
  return out;
}

describe("β: 慣れの速さ from the reports", () => {
  it("waits for enough reports over enough days, using the standard α meanwhile", () => {
    const few = simulate(0.7, 0.3, 10);
    const fit = fitAlpha(few);
    expect(fit).toMatchObject({ status: "collecting", alpha: STANDARD_ALPHA });
    expect(fit.n).toBeLessThan(MIN_REPORTS);
  });

  it("recovers α when the reports carry a history effect", () => {
    const fit = fitAlpha(simulate(0.65, 0.35, 90, 2));
    expect(fit.status).toBe("fitted");
    // The fit is weakly identified (as the proposal notes): over ten noise seeds it lands within 0.15.
    expect(Math.abs(fit.alpha - 0.65)).toBeLessThanOrEqual(0.15);
    expect(fit.improvement!).toBeGreaterThan(0);
  });

  it("does not claim an effect the data does not show", () => {
    const fit = fitAlpha(simulate(0.65, 0, 90, 2));
    expect(fit.status).toBe("no-effect");
    expect(fit.alpha).toBe(STANDARD_ALPHA);
  });

  it("solves least squares exactly on a perfect line", () => {
    expect(leastSquaresSse([[1, 0], [1, 1], [1, 2]], [1, 3, 5])).toBeCloseTo(0, 9);
    expect(leastSquaresSse([[1, 1], [1, 1]], [1, 2])).toBeNull(); // nothing to tell the columns apart
  });
});

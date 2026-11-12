import { describe, expect, it } from "vitest";
import { inputQuality, MAX_LAG_MIN, observedAt } from "../../src/beta/quality";
import type { Report } from "../../src/beta/reports";

const snap = (over: Record<string, unknown> = {}) => ({
  date: "2026-11-12",
  hour: 12,
  temp: 18,
  humidity: 60,
  wind: 2,
  solar: 400,
  from: { temp: "amedas", humidity: "amedas", wind: "amedas", solar: "forecast" },
  sunTemp: 21,
  shadeTemp: 17,
  forecastSky: null,
  forecastSkyCode: null,
  ...over,
});
const report = (over: Record<string, unknown> = {}) =>
  ({ id: "r", at: "2026-11-12T03:20:00.000Z", sensation: 0, exposure: "sun", windFelt: "weak", history: [15], baseline: { value: 15 }, updatedAt: 1, ...over, snapshot: "snapshot" in over ? over.snapshot : snap() }) as unknown as Report;

describe("MATH-02: input quality", () => {
  it("reads the observed hour in Japan time", () => {
    expect(new Date(observedAt("2026-11-12", 12)).toISOString()).toBe("2026-11-12T03:00:00.000Z");
    expect(new Date(observedAt("2026-11-12", 24)).toISOString()).toBe("2026-11-12T15:00:00.000Z");
  });

  it("uses an observed, recent hour for learning, noting the radiation lent by the forecast", () => {
    const q = inputQuality(report());
    expect(q).toMatchObject({ status: "observed", lagMin: 20, trainable: true, reason: null });
    expect(q.flags).toEqual(["solar-lent", "mixed-sources"]);
  });

  it("keeps but does not learn from a forecast temperature, a stale hour or a missing snapshot", () => {
    const forecast = inputQuality(report({ snapshot: snap({ from: { temp: "forecast", humidity: "forecast", wind: "forecast" } }) }));
    expect(forecast).toMatchObject({ status: "forecast", trainable: false });
    expect(forecast.reason).toContain("予報");
    const stale = inputQuality(report({ at: new Date(observedAt("2026-11-12", 12) + (MAX_LAG_MIN + 1) * 60_000).toISOString() }));
    expect(stale.trainable).toBe(false);
    expect(stale.flags).toContain("stale");
    expect(inputQuality(report({ snapshot: null })).reason).toContain("気温がない");
    expect(inputQuality(report({ history: [] })).reason).toContain("履歴");
  });

  it("marks missing values instead of filling them", () => {
    const q = inputQuality(report({ snapshot: snap({ humidity: null, wind: null }) }));
    expect(q.flags).toEqual(expect.arrayContaining(["humidity-missing", "wind-missing"]));
    expect(q.trainable).toBe(true); // the models that need them simply take no part (comfort.ts)
  });
});

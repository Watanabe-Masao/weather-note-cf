// 学習なし版の肌感（日かげ）: material → wind.person → feel.shade, checked by its properties over
// many inputs (fast-check) and against the app's current 肌感 (shared/feel.ts), which it rebuilds.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEEL, feelOf } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import { type Estimate, FEEL_SHADE_MISSENARD, feelShade, hourOf, shadeFeel, SURROUNDINGS_ALPHA, windPerson, windPersonSettings } from "../../src/core";
import { parseTable } from "../../worker/src/jma-tables";
import { fixture } from "../fixture";

const ALPHAS = Object.values(SURROUNDINGS_ALPHA);

function hour(t: number | null, h: number | null, v: number | null, kind: "actual" | "forecast" = "actual") {
  const row: WeatherRow = {
    date: "2026-11-15",
    n: 13,
    type: kind,
    provider: kind === "forecast" ? "Open-Meteo" : "JMA",
    raw: {},
    quality: { temp: t == null ? "missing" : "normal", humidity: h == null ? "missing" : "normal", wind: v == null ? "missing" : "normal" },
    temp: t,
    humidity: h,
    wind: v,
  };
  return hourOf(row, "47893")!;
}

const valueOf = (e: Estimate) => ("value" in e ? e.value : null);

const temp = fc.double({ min: -30, max: 45, noNaN: true });
const humidity = fc.double({ min: 0, max: 100, noNaN: true });
const wind = fc.double({ min: 0, max: 40, noNaN: true });
const alpha = fc.constantFrom(...ALPHAS);
const height = fc.double({ min: 1, max: 60, noNaN: true });

describe("the plain 肌感（日かげ） rebuilds the app's current one", () => {
  it("for any weather, setting and anemometer height, record or forecast", () => {
    fc.assert(
      fc.property(temp, humidity, wind, alpha, height, fc.boolean(), (t, h, v, a, ht, forecast) => {
        const now = feelOf(t, h, v, forecast, { ...DEFAULT_FEEL, sun: false, alpha: a, stationHeight: ht });
        const next = valueOf(shadeFeel(hour(t, h, v, forecast ? "forecast" : "actual"), { anemometerHeight: ht }, { windPerson: windPersonSettings(a) }));
        expect(next).not.toBeNull();
        expect(next!).toBeCloseTo(now!, 9);
      }),
    );
  });

  it("for every hour of a real JMA day", () => {
    const rows: WeatherRow[] = parseTable(fixture("hourly.html"), true).map((r) => ({ ...r, date: "2025-11-01", type: "actual", provider: "JMA" }));
    for (const r of rows) {
      const s = { ...DEFAULT_FEEL, sun: false };
      const next = valueOf(shadeFeel(hourOf(r, "47893")!, { anemometerHeight: s.stationHeight }, { windPerson: windPersonSettings(s.alpha) }));
      const now = feelOf(r.temp, r.humidity, r.wind, false, s);
      if (now == null) expect(next).toBeNull();
      else expect(next!).toBeCloseTo(now, 9);
    }
  });
});

describe("no data, no value — and the reason reaches the material (principles 2)", () => {
  it("any missing material makes the result missingInput, naming it", () => {
    fc.assert(
      fc.property(fc.option(temp), fc.option(humidity), fc.option(wind), (t, h, v) => {
        fc.pre(t == null || h == null || v == null);
        const e = shadeFeel(hour(t, h, v), { anemometerHeight: 10 }, { windPerson: windPersonSettings(0.4) });
        expect(e).toMatchObject({ absent: "missingInput" });
        const inputs = Object.keys((e as { inputs: Record<string, string> }).inputs);
        if (t == null) expect(inputs).toContain("temp");
        if (h == null) expect(inputs).toContain("humidity");
        if (v == null) expect(inputs).toContain("windPerson.wind");
      }),
    );
  });

  it("a record with no known anemometer height has no 肌感; a forecast's wind is at 10 m", () => {
    const sets = { windPerson: windPersonSettings(0.4) };
    expect(shadeFeel(hour(15, 60, 3), { anemometerHeight: null }, sets)).toMatchObject({ absent: "missingInput", inputs: { "windPerson.windHeight": "notProvided" } });
    expect(valueOf(shadeFeel(hour(15, 60, 3, "forecast"), { anemometerHeight: null }, sets))).not.toBeNull();
  });

  it("outside the formula's range it says so, and never clamps", () => {
    const sets = { windPerson: windPersonSettings(0.4) };
    expect(shadeFeel(hour(15, 60, -1), { anemometerHeight: 10 }, sets)).toMatchObject({ absent: "outOfDomain", input: "windPerson.wind", got: -1 });
    expect(shadeFeel(hour(15, 101, 3), { anemometerHeight: 10 }, sets)).toMatchObject({ absent: "outOfDomain", input: "humidity" });
    expect(shadeFeel(hour(15, 60, 3), { anemometerHeight: 0 }, sets)).toMatchObject({ absent: "outOfDomain", input: "windPerson.windHeight" });
  });
});

describe("what it is made of travels with it (principles 5)", () => {
  it("both formulas and both sets, by version, with the numbers used", () => {
    const e = shadeFeel(hour(15, 60, 3), { anemometerHeight: 10 }, { windPerson: windPersonSettings(0.3) });
    expect(e.trace.map((s) => [s.formula, s.params])).toEqual([
      [`${windPerson.id}@${windPerson.version}`, "settings@1"],
      [`${feelShade.id}@${feelShade.version}`, `${FEEL_SHADE_MISSENARD.id}@${FEEL_SHADE_MISSENARD.version}`],
    ]);
    expect(e.trace[0].values).toEqual({ personHeight: 1.5, alpha: 0.3 });
  });

  it("every number of every set has a unit and a basis", () => {
    for (const set of [FEEL_SHADE_MISSENARD, windPersonSettings(0.4)])
      for (const [k, p] of Object.entries(set.values)) {
        expect(Number.isFinite(p.value), k).toBe(true);
        expect(typeof p.unit, k).toBe("string");
        expect(p.basis.length, k).toBeGreaterThan(0);
      }
  });

  it("a formula's parameter names are exactly its sets' names", () => {
    expect(Object.keys(FEEL_SHADE_MISSENARD.values).sort()).toEqual([...feelShade.params].sort());
    expect(Object.keys(windPersonSettings(0.4).values).sort()).toEqual([...windPerson.params].sort());
  });
});

describe("properties of the shape", () => {
  const sets = { windPerson: windPersonSettings(0.4) };
  const at = (t: number, h: number, v: number) => valueOf(shadeFeel(hour(t, h, v), { anemometerHeight: 10 }, sets))!;

  it("is a finite number everywhere in its range", () => {
    fc.assert(fc.property(temp, humidity, wind, (t, h, v) => Number.isFinite(at(t, h, v))));
  });

  it("warmer air feels warmer", () => {
    fc.assert(fc.property(temp, temp, humidity, wind, (t1, t2, h, v) => (t1 < t2 ? at(t1, h, v) <= at(t2, h, v) + 1e-9 : true)));
  });

  it("in cool air (below the neutral 37℃), more wind never feels warmer", () => {
    fc.assert(fc.property(fc.double({ min: -30, max: 30, noNaN: true }), humidity, wind, wind, (t, h, v1, v2) => (v1 < v2 ? at(t, h, v2) <= at(t, h, v1) + 1e-9 : true)));
  });
});

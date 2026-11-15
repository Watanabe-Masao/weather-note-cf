// 学習なし版の肌感（日なた）: the sun's position, 日照から推測した日射 and 肌感（日なた） rebuilt in the
// core, against the app's current ones (shared/sunTimes.ts, shared/mrt.ts, shared/feel.ts), and by
// their properties — above all, night decided by the sun, not by a blank cell.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEEL, feelOf } from "../../shared/feel";
import { sunshineRadiation as legacyRadiation } from "../../shared/mrt";
import { solarAltitude as legacyAltitude, stationLatLon } from "../../shared/sunTimes";
import { type Estimate, hourStartOf, type MaterialHour, shadeFeel, sunFeel, sunshineRadiation, windPersonSettings } from "../../src/core";
import { solarAltitude } from "../../src/core/estimate/sun/position";

const KOCHI = stationLatLon("47893")!;
const site = { anemometerHeight: DEFAULT_FEEL.stationHeight, lat: KOCHI.lat, lon: KOCHI.lon };
const settings = { alpha: DEFAULT_FEEL.alpha, absorb: DEFAULT_FEEL.absorb };
const valueOf = (e: Estimate) => ("value" in e ? e.value : null);

function hour(date: string, n: number, v: { temp?: number; humidity?: number; wind?: number; sunshine: number | null; rain: number | null }, kind: "record" | "forecast" = "record"): MaterialHour {
  return {
    station: "47893",
    date,
    hour: n,
    kind,
    provider: kind === "forecast" ? "Open-Meteo" : "JMA",
    provisional: false,
    values: { temp: v.temp ?? 15, humidity: v.humidity ?? 60, wind: v.wind ?? 2, rain: v.rain, sunshine: v.sunshine, pressure: 1013 },
    absent: { ...(v.sunshine == null ? { sunshine: "blank" as const } : {}), ...(v.rain == null ? { rain: "notObserved" as const } : {}) },
    rough: [],
  };
}

const date = fc.integer({ min: 0, max: 364 }).map((d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10));
const n = fc.integer({ min: 1, max: 24 });
const share = fc.double({ min: 0, max: 1, noNaN: true });
const rain = fc.oneof(fc.constant(0), fc.double({ min: 0, max: 30, noNaN: true }));
/** Whether the sun is up at any of the hour's 12 moments (legacy, by date and minute). */
const anyUp = (d: string, h: number) => Array.from({ length: 12 }, (_, i) => legacyAltitude(d, (h - 1) * 60 + 2.5 + 5 * i, KOCHI.lat, KOCHI.lon)).some((a) => a > 0);

describe("the sun's position is the app's", () => {
  it("for any moment of the year", () => {
    fc.assert(
      fc.property(date, fc.double({ min: 0, max: 1439, noNaN: true }), (d, m) => {
        const ms = Date.parse(`${d}T00:00:00+09:00`) + m * 60_000;
        expect(solarAltitude(ms, KOCHI.lat, KOCHI.lon)).toBeCloseTo(legacyAltitude(d, m, KOCHI.lat, KOCHI.lon), 9);
      }),
    );
  });
});

describe("日照から推測した日射 rebuilds shared/mrt.ts", () => {
  it("whenever there is 日照", () => {
    fc.assert(
      fc.property(date, n, share, rain, (d, h, s, mm) => {
        const now = legacyRadiation({ date: d, n: h, sun: s, rain: mm }, KOCHI);
        const next = valueOf(sunshineRadiation(hour(d, h, { sunshine: s, rain: mm }), site));
        expect(next!).toBeCloseTo(now!, 6);
      }),
    );
  });

  it("at night a blank 日照 is no loss: the hour is dark (0)", () => {
    fc.assert(
      fc.property(date, n, rain, (d, h, mm) => {
        fc.pre(!anyUp(d, h));
        expect(valueOf(sunshineRadiation(hour(d, h, { sunshine: null, rain: mm }), site))).toBe(0);
      }),
    );
  });

  it("while the sun can shine, a blank 日照 leaves the hour without radiation, saying why", () => {
    const e = sunshineRadiation(hour("2026-06-21", 13, { sunshine: null, rain: 0 }), site);
    expect(e).toMatchObject({ absent: "missingInput", inputs: { sunshine: "blank" } });
  });

  it("a missing rain is missing, never 0 (the app's own took 0)", () => {
    expect(sunshineRadiation(hour("2026-06-21", 13, { sunshine: 0.5, rain: null }), site)).toMatchObject({ absent: "missingInput", inputs: { rain: "notObserved" } });
  });

  it("is never negative; more 日照 never darkens; rain darkens an hour without 日照", () => {
    fc.assert(
      fc.property(date, n, share, share, (d, h, a, b) => {
        const r = (s: number, mm = 0) => valueOf(sunshineRadiation(hour(d, h, { sunshine: s, rain: mm }), site))!;
        expect(r(a)).toBeGreaterThanOrEqual(0);
        if (a < b) expect(r(a)).toBeLessThanOrEqual(r(b) + 1e-9);
        expect(r(0, 5)).toBeLessThanOrEqual(r(0) + 1e-9);
      }),
    );
  });
});

describe("肌感（日なた） rebuilds feel-1s", () => {
  const temp = fc.double({ min: -5, max: 38, noNaN: true });
  const hum = fc.double({ min: 10, max: 100, noNaN: true });
  const wind = fc.double({ min: 0, max: 15, noNaN: true });

  it("for any hour with 日照, record or forecast", () => {
    fc.assert(
      fc.property(date, n, share, rain, temp, hum, wind, fc.boolean(), (d, h, s, mm, t, rh, v, forecast) => {
        const rad = legacyRadiation({ date: d, n: h, sun: s, rain: mm }, KOCHI);
        const now = feelOf(t, rh, v, forecast, { ...DEFAULT_FEEL, sun: true }, rad);
        const next = valueOf(sunFeel(hour(d, h, { temp: t, humidity: rh, wind: v, sunshine: s, rain: mm }, forecast ? "forecast" : "record"), site, settings));
        expect(next!).toBeCloseTo(now!, 6);
      }),
    );
  });

  it("at night, 日なた is 日かげ", () => {
    fc.assert(
      fc.property(date, n, temp, hum, wind, (d, h, t, rh, v) => {
        fc.pre(!anyUp(d, h));
        const m = hour(d, h, { temp: t, humidity: rh, wind: v, sunshine: null, rain: 0 });
        expect(valueOf(sunFeel(m, site, settings))!).toBeCloseTo(valueOf(shadeFeel(m, site, { windPerson: windPersonSettings(settings.alpha) }))!, 9);
      }),
    );
  });

  it("is never cooler than 日かげ", () => {
    fc.assert(
      fc.property(date, n, share, rain, temp, hum, wind, (d, h, s, mm, t, rh, v) => {
        const m = hour(d, h, { temp: t, humidity: rh, wind: v, sunshine: s, rain: mm });
        expect(valueOf(sunFeel(m, site, settings))!).toBeGreaterThanOrEqual(valueOf(shadeFeel(m, site, { windPerson: windPersonSettings(settings.alpha) }))! - 1e-9);
      }),
    );
  });

  it("without the place, there is no 日なた (and it says which)", () => {
    const m = hour("2026-06-21", 13, { sunshine: 0.5, rain: 0 });
    expect(sunFeel(m, { anemometerHeight: 10 }, settings)).toMatchObject({ absent: "missingInput", inputs: { "radSunshine.lat": "notProvided", "radSunshine.lon": "notProvided" } });
  });

  it("names every formula and set on the way", () => {
    const e = sunFeel(hour("2026-06-21", 13, { sunshine: 0.5, rain: 0 }), site, settings);
    expect(e.trace.map((s) => s.formula)).toEqual(["wind.person@1", "feel.shade@1", "rad.sunshine@1", "wind.ten@1", "feel.sun@1"]);
  });
});

describe("JMA's hour n begins at (n − 1):00 JST", () => {
  it("hour 1 at 0:00, hour 24 at 23:00", () => {
    expect(new Date(hourStartOf("2026-11-15", 1)).toISOString()).toBe("2026-11-14T15:00:00.000Z");
    expect(new Date(hourStartOf("2026-11-15", 24)).toISOString()).toBe("2026-11-15T14:00:00.000Z");
  });
});

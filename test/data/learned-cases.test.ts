// 答えから比べる材料へ (#207): which answers count, where each sits in time, the day before's evening
// for the short history, and the place — the board's data assembly, without a store.

import { describe, expect, it } from "vitest";
import { DEFAULT_FEEL } from "../../shared/feel";
import { stationLatLon } from "../../shared/sunTimes";
import type { WeatherRow } from "../../shared/types";
import { type Report, SCALE_VERSION } from "../../src/beta/reports";
import { casesFromAnswers, countedAnswers, HISTORY_DAYS, placeOf } from "../../src/ui/learnedCases";

const KOCHI = stationLatLon("47893")!;
const site = { anemometerHeight: 10, lat: KOCHI.lat, lon: KOCHI.lon };
const feel = { alpha: DEFAULT_FEEL.alpha, absorb: DEFAULT_FEEL.absorb, thresholds: DEFAULT_FEEL.thresholds };
const q = { temp: "normal", humidity: "normal", wind: "normal", rain: "normal", sun: "normal" } as const;

const hourRows = (date: string): WeatherRow[] =>
  Array.from({ length: 24 }, (_, i) => ({ date, n: i + 1, type: "actual", provider: "JMA", raw: {}, quality: { ...q }, temp: 10 + i * 0.3, humidity: 60, wind: 2, rain: 0, sun: 0 }));
const dayRow = (date: string): WeatherRow => ({ date, n: +date.slice(8), type: "actual", provider: "JMA", raw: {}, quality: { temp: "normal" }, temp: 15 });

function report(over: Partial<Report>): Report {
  return { id: "r", at: "2026-11-15T04:10:00.000Z", station: "47893", sensation: 0, exposure: "shade", windFelt: "weak", snapshot: null, baseline: null, departures: null, updatedAt: 0, scaleVersion: SCALE_VERSION, ...over } as Report;
}

describe("which answers count", () => {
  it("this station, today's words only", () => {
    const got = countedAnswers([report({ id: "a" }), report({ id: "b", station: "47891" }), report({ id: "c", scaleVersion: SCALE_VERSION - 1 })], "47893");
    expect(got.map((x) => x.r.id)).toEqual(["a"]);
  });
});

describe("where an answer sits in time", () => {
  it("from when it was sent: 0:30 JST is hour 1 of that date; 13:10 JST is hour 14", () => {
    expect(placeOf(report({ at: "2026-11-14T15:30:00.000Z" }))).toEqual({ date: "2026-11-15", hour: 1 });
    expect(placeOf(report({ at: "2026-11-15T04:10:00.000Z" }))).toEqual({ date: "2026-11-15", hour: 14 });
  });
});

describe("cases from answers", () => {
  const look = { hours: (d: string) => hourRows(d), day: (d: string) => dayRow(d) };

  it("the step, the time, and every input from the materials", () => {
    const [c] = casesFromAnswers(countedAnswers([report({ id: "a", sensation: -2 })], "47893"), "47893", look, site, feel);
    expect(c).toMatchObject({ id: "a", date: "2026-11-15", answer: 1 });
    for (const k of ["feel", "shift", "shiftL2", "short", "rate", "level"] as const) expect("value" in c.inputs[k], k).toBe(true);
  });

  it("hour 1 reads the day before's evening (the short history across midnight)", () => {
    const [c] = casesFromAnswers(countedAnswers([report({ at: "2026-11-14T15:30:00.000Z" })], "47893"), "47893", look, site, feel);
    expect("value" in c.inputs.short).toBe(true);
    const [none] = casesFromAnswers(countedAnswers([report({ at: "2026-11-14T15:30:00.000Z" })], "47893"), "47893", { ...look, hours: (d) => (d === "2026-11-15" ? hourRows(d) : []) }, site, feel);
    expect(none.inputs.short).toMatchObject({ absent: "tooShort" });
  });

  it("半々 gives no 肌感; the long histories need their days (L2: the last 60)", () => {
    const [mixed] = casesFromAnswers(countedAnswers([report({ exposure: "mixed" })], "47893"), "47893", look, site, feel);
    expect(mixed.inputs.feel).toMatchObject({ absent: "missingInput" });
    const short = { ...look, day: (d: string) => (Date.parse("2026-11-15") - Date.parse(d) <= 30 * 86_400_000 ? dayRow(d) : null) };
    const [c] = casesFromAnswers(countedAnswers([report({})], "47893"), "47893", short, site, feel);
    expect("value" in c.inputs.shift).toBe(true); // L1: 30 days are enough
    expect("value" in c.inputs.shiftL2).toBe(true); // L2: 30 of 60 days carry most of α 0.8's weight
    expect(HISTORY_DAYS).toBe(60);
  });
});

import { LEVELS } from "../../shared/feel";
import { describe, expect, it } from "vitest";
import { jstHourOf, jstIso, recentDay, type Report, SENSATIONS, snapshotOf, toCsv, windMemory } from "../../src/beta/reports";
import { DEFAULT_FEEL } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";

const hour = (n: number, over: Partial<WeatherRow> = {}): WeatherRow => ({
  date: "2026-11-11",
  n,
  type: "actual",
  provider: "JMA-amedas",
  raw: {},
  quality: {},
  temp: 15 + n / 10,
  humidity: 60,
  wind: 2,
  from: "amedas",
  ...over,
});

describe("β②: what a report records", () => {
  it("takes the latest hour with a temperature, with each value's source", () => {
    const rows = [hour(19), hour(20, { solar: 0, origin: { solar: "forecast" } }), hour(21, { type: "forecast", from: "forecast" })];
    const s = snapshotOf(rows, 20, DEFAULT_FEEL)!;
    expect(s.hour).toBe(20);
    expect(s.from).toEqual({ temp: "amedas", humidity: "amedas", wind: "amedas", solar: "forecast" });
    expect(s.sunTemp).not.toBeNull();
    expect(s.shadeTemp).not.toBeNull();
  });

  it("keeps the hour's sunshine and the candidate 日なた (feel-2, 案C) beside feel-1 (D18)", () => {
    // 12時 (11–12時) on 11 November at Kochi, all sunny: the candidate adds the direct sun to 日かげ.
    const sunny = snapshotOf([hour(11), hour(12, { sun: 1, solar: 600 })], 12, DEFAULT_FEEL, null, undefined, { latest: null, now: Date.parse("2026-11-11T12:30:00+09:00"), station: "47893" })!;
    expect(sunny.sunshine).toBe(1);
    expect(sunny.sunIndex2!).toBeGreaterThan(sunny.shadeTemp! + 3);
    // No sunshine (overcast): the candidate's 日なた is 日かげ — feel-1 still adds the radiation.
    const dull = snapshotOf([hour(11), hour(12, { sun: 0, solar: 200 })], 12, DEFAULT_FEEL, null, undefined, { latest: null, now: Date.parse("2026-11-11T12:30:00+09:00"), station: "47893" })!;
    expect(dull.sunIndex2).toBe(dull.shadeTemp);
    expect(dull.sunTemp!).toBeGreaterThan(dull.shadeTemp!);
    // Without the hour's sunshine: no candidate value (never invented).
    expect(snapshotOf([hour(12)], 12, DEFAULT_FEEL)!.sunIndex2).toBeNull();
  });

  it("is null without hours (never invents the weather)", () => {
    expect(snapshotOf([], 12, DEFAULT_FEEL)).toBeNull();
    expect(snapshotOf([hour(15)], 12, DEFAULT_FEEL)).toBeNull(); // nothing at or before 12時
  });

  it("knows the hour in Japan (24 for midnight, as JMA counts)", () => {
    expect(jstHourOf(Date.parse("2026-11-11T11:30:00Z"))).toBe(20);
    expect(jstHourOf(Date.parse("2026-11-11T15:10:00Z"))).toBe(24);
    expect(jstIso("2026-11-11T11:30:05.000Z")).toBe("2026-11-11T20:30:05+09:00");
  });
});

describe("β②: the sky and the days before", () => {
  it("keeps the forecast's weather for an observed hour, as the forecast's", () => {
    const rows = [hour(12, { weather: "曇り", weatherCode: 3, origin: { weather: "forecast", weatherCode: "forecast" } })];
    expect(snapshotOf(rows, 12, DEFAULT_FEEL)).toMatchObject({ forecastSky: "曇り", forecastSkyCode: 3 });
    expect(snapshotOf([hour(12)], 12, DEFAULT_FEEL)).toMatchObject({ forecastSky: null });
  });

  it("records a past day with its source", () => {
    const row = { date: "2026-11-10", n: 10, type: "actual" as const, provider: "JMA", raw: {}, quality: {}, temp: 16, humidity: 70, sun: 4.2, rain: 0, dayWeather: "晴" };
    expect(recentDay("2026-11-10", row, "fixed")).toMatchObject({ mean: 16, humidity: 70, sun: 4.2, weather: "晴", from: "jma-fixed" });
    expect(recentDay("2026-11-10", null, null)).toMatchObject({ mean: null, from: null });
  });
});

describe("β②: wind as an amount over time", () => {
  it("takes the mean of the last 6 and 12 hours and of last night, across midnight", () => {
    const day = (date: string, w: (n: number) => number) => Array.from({ length: 24 }, (_, i) => hour(i + 1, { date, wind: w(i + 1) }));
    const before = day("2026-11-10", (n) => (n >= 18 ? 6 : 1)); // windy evening the day before
    const today = day("2026-11-11", (n) => (n <= 6 ? 4 : 2));
    const m = windMemory(today, before, 3, "47893"); // at 3時
    expect(m.wind6h).toBe(5); // 22時–3時: 6,6,4,4,4 … mean of 21:00<t≤3:00
    // Kochi in November: sunset 17:09, sunrise 6:31 → 18–24時 and 1–6時.
    expect(m.windLastNight).toBe(5.1);
    expect(windMemory(today, null, 12, "47893").windLastNight).toBe(4); // only today's 1–6時 known
  });

  it("takes last night from sunset to sunrise, not 18時–6時", () => {
    const day = (date: string, w: (n: number) => number) => Array.from({ length: 24 }, (_, i) => hour(i + 1, { date, wind: w(i + 1) }));
    // June in Kochi: sunset 19:19, sunrise 4:56 → 20–24時 and 1–4時 (18・19時 and 5・6時 are daylight).
    const before = day("2026-06-20", (n) => (n === 18 || n === 19 ? 10 : 2));
    const today = day("2026-06-21", (n) => (n === 5 || n === 6 ? 10 : 2));
    expect(windMemory(today, before, 12, "47893").windLastNight).toBe(2);
  });
});

describe("β②: the scale", () => {
  it("has seven steps from 極寒 (−3) to 猛暑 (+3), the same words as the 肌感 levels", () => {
    expect(SENSATIONS.map((s) => [s.value, s.label])).toEqual([
      [-3, "極寒"],
      [-2, "寒い"],
      [-1, "涼しい"],
      [0, "ちょうどよい"],
      [1, "暖かい"],
      [2, "暑い"],
      [3, "猛暑"],
    ]);
    expect(SENSATIONS.map((s) => s.label)).toEqual([...LEVELS]);
  });
});

describe("β②: CSV with the comfort prediction", () => {
  it("writes the centre, range and the chance of each answer", () => {
    const r: Report = {
      id: "z",
      at: "2026-11-11T11:30:00.000Z",
      station: "47893",
      sensation: 1,
      exposure: "sun",
      windFelt: "weak",
      snapshot: null,
      baseline: null,
      departures: null,
      comfort: {
        probs: [0, 0, 0.05, 0.3, 0.5, 0.15, 0],
        mode: 1,
        expected: 0.8,
        state: { mu: 19.4, h: 2.8, g: 4.3, s: 0.9 },
        offset: 3.6,
        beyond: 0.8,
        models: [{ id: "M1", weight: 1, probs: [0, 0, 0.05, 0.3, 0.5, 0.15, 0], mode: 1, mu: 19.4, h: 2.8 }],
        n: 12,
        alpha: 0.8,
        at: 0,
      },
      updatedAt: 1,
    };
    const [header, line] = toCsv([r]).trim().split("\r\n");
    const cols = header.replace("\uFEFF", "").split(",");
    const cells = line.split(",");
    const at = (k: string) => cells[cols.indexOf(k)];
    expect([at("comfort_mu"), at("comfort_half_range"), at("comfort_beyond"), at("pred_mode"), at("p_p1"), at("pred_error")]).toEqual(["19.4", "2.8", "0.8", "1", "0.5", "0.2"]);
    // #63 P1: the preference questions — unanswered stays empty, and differs from a report made before them.
    expect([at("thermal_preference"), at("drink_preference"), at("preference_version")]).toEqual(["", "", ""]);
    const [, asked] = toCsv([{ ...r, preferenceVersion: 1, drinkPreference: "either" }]).trim().split("\r\n");
    const c2 = asked.split(",");
    expect([c2[cols.indexOf("thermal_preference")], c2[cols.indexOf("drink_preference")], c2[cols.indexOf("preference_version")]]).toEqual(["", "either", "1"]);
  });
});

describe("β②: CSV", () => {
  const base: Report = {
    id: "a",
    at: "2026-11-11T11:30:00.000Z",
    station: "47893",
    sensation: -1,
    exposure: "shade",
    windFelt: "strong",
    sky: "cloudy",
    snapshot: null,
    baseline: { value: 17.3, forecastMixed: false, coverage: 1, alpha: 0.8 },
    departures: { air: -2.4, sun: null, shade: -4 },
    updatedAt: 1,
  };
  it("writes one row per live report, oldest first, readable by Excel", () => {
    const csv = toCsv([{ ...base, id: "b", at: "2026-11-12T00:00:00.000Z" }, base, { ...base, id: "c", deleted: true }]);
    expect(csv.startsWith("﻿at_jst,opened_at_jst,notified_at_jst,station,sensation")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`2026-11-11T20:30:00+09:00,,,47893,-1,涼しい,shade,strong,${",".repeat(19)}cloudy,`); // no prediction in this one
    expect(lines[1]).toContain("17.3,0.8,0.2,3.1,0,-2.4,,-4,"); // α, 前日の重み, 半減期
    const header = lines[0].split(",");
    const at = (line: string, col: string) => line.split(",")[header.indexOf(col)];
    expect(at(lines[1], "id")).toBe("a");
    expect(header.indexOf("d1_humidity")).toBeGreaterThan(0);
    expect(header.indexOf("d7_from")).toBe(header.indexOf("id") - 1);
    // Columns added later sit after id, so the earlier ones keep their places.
    expect(header.slice(header.indexOf("id") + 1, header.indexOf("id") + 4)).toEqual(["scale_version", "model_version", "learning_state"]);
    expect(at(lines[1], "scale_version")).toBe("1"); // a report from before the words changed
    expect(lines[1].split(",")).toHaveLength(header.length);
    expect(at(lines[2], "id")).toBe("b");
  });
});

// 近づいている台風 (#220, shared/typhoonForecast.ts): JMA's typhoon information read as its pages give
// it, and the station looked up in JMA's own areas. The fixtures are JMA's JSON as published (2026).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTyphoon, stationOnTyphoon, typhoonConcerns } from "../../shared/typhoonForecast";

const KOCHI = { lat: 33 + 33.8 / 60, lon: 133 + 33.1 / 60 };
const read = (f: string) => {
  const d = JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
  return parseTyphoon(d.tc, d.forecast, d.specifications)!;
};

describe("JMA's typhoon information", () => {
  it("reads the number, name, centre, pressure, wind and the areas now", () => {
    const t = read("typhoon-TC2608-20260627T0345Z.json");
    expect(t).toMatchObject({ tc: "TC2608", number: 7, name: "メーカラー", category: "台風", pressure: 992, wind: 20 });
    expect(t.gale!.km).toBeCloseTo(277.8, 1);
    expect(t.storm).toBeNull(); // a tropical storm: no 暴風域
    expect(t.warning).toEqual([]);
    expect(t.issued).toMatch(/^2026-06-27T12:45/);
  });

  it("finds Kochi inside the 強風域 on 27 June (as the best track has it) and not the evening before", () => {
    expect(stationOnTyphoon(read("typhoon-TC2608-20260627T0345Z.json"), KOCHI.lat, KOCHI.lon)).toMatchObject({ gale: true, storm: false, warning: false });
    expect(stationOnTyphoon(read("typhoon-TC2608-20260626T2335Z.json"), KOCHI.lat, KOCHI.lon).gale).toBe(false);
  });

  it("reads the 暴風警戒域 as one area: the circles and the hull between them", () => {
    const t = read("typhoon-TC2615-20260809T0045Z.json");
    expect(t.warning).toHaveLength(2);
    expect(t.ahead.map((a) => a.hours)).toEqual([12, 24, 48, 72]);
    // Between the two circles (28.03,123.3) and (27.95,120.8): inside the hull, though in neither circle's edge.
    expect(stationOnTyphoon(t, 30.4, 122.0).warning).toBe(true);
    expect(stationOnTyphoon(t, 31.2, 122.0).warning).toBe(false);
    expect(stationOnTyphoon(t, KOCHI.lat, KOCHI.lon).warning).toBe(false);
  });

  it("names a typhoon worth a card at the station", () => {
    expect(typhoonConcerns({ gale: false, storm: false, warning: false, km: 1200 })).toBe(false);
    expect(typhoonConcerns({ gale: false, storm: false, warning: false, km: 800 })).toBe(true);
    expect(typhoonConcerns({ gale: false, storm: false, warning: true, km: 1500 })).toBe(true);
  });

  it("reads nothing it does not understand as a typhoon", () => {
    expect(parseTyphoon("TC0000", null, null)).toBeNull();
    expect(parseTyphoon("TC0000", [{ part: "title" }], [])).toBeNull();
    // A number or a centre a typhoon cannot have: the form has changed, not a typhoon.
    const d = JSON.parse(readFileSync(new URL("../fixtures/typhoon-TC2608-20260627T0345Z.json", import.meta.url), "utf8"));
    const odd = structuredClone(d.specifications);
    odd[0].typhoonNumber = "26AB";
    expect(parseTyphoon(d.tc, d.forecast, odd)).toBeNull();
  });
});

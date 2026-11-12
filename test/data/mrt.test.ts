// feel-3 (shared/mrt.ts): 肌感 on UTCI, with the sun's ΔMRT by ASHRAE 55 SolarCal.

import { describe, expect, it } from "vitest";
import { clearSky, feel3, hourRadiation, solarCalDmrt, utciWind } from "../../shared/mrt";

const K = "47893";

describe("SolarCal ΔMRT", () => {
  it("matches pythermalcomfort's solar_gain averaged over facing (altitude 33°, beam 795, diffuse 0.2 × beam, open sky)", () => {
    // pythermalcomfort 4.8.1, solar_gain(standing, f_svv 1, asw 0.7, floor reflectance 0.2), sharp 0–180 (trapezoid): 42.279 K.
    const alt = 33, dni = 795, dif = 0.2 * dni, ghi = dni * Math.sin((alt * Math.PI) / 180) + dif;
    expect(solarCalDmrt(alt, dni, dif, ghi, 1)).toBeCloseTo(42.28, 1);
  });
  it("gives the shade only part of the sky and no beam", () => {
    expect(solarCalDmrt(33, 0, 150, 500, 0.4)).toBeLessThan(solarCalDmrt(33, 0, 150, 500, 1));
    expect(solarCalDmrt(33, 0, 0, 0, 0.4)).toBe(0);
  });
});

describe("the sky from sunshine", () => {
  it("has a hazier summer beam than Meinel's (Linke turbidity), 750–850 W/m² at a high summer sun", () => {
    const summer = clearSky(80, "2026-06-21").dni;
    expect(summer).toBeGreaterThan(750);
    expect(summer).toBeLessThan(850);
    expect(clearSky(0, "2026-06-21")).toEqual({ dni: 0, ghi: 0 });
  });
  it("counts sunshine against the minutes the clear beam passes 120 W/m², and gives no sun term without sunshine", () => {
    const clear = hourRadiation("2026-12-22", 13, K, 1)!;
    const dull = hourRadiation("2026-12-22", 13, K, 0)!;
    expect(clear.share).toBe(1);
    expect(dull.share).toBe(0);
    expect(clear.dmrtSun).toBeGreaterThan(30);
    // Overcast: no beam, so "sun" and shade differ only by how much of the bright sky they see.
    expect(dull.dmrtSun - dull.dmrtShade).toBeLessThan(clear.dmrtSun - clear.dmrtShade);
    expect(dull.dmrtSun - dull.dmrtShade).toBeLessThan(10);
    expect(dull.dmrtSun).toBeGreaterThan(0);
    expect(hourRadiation("2026-12-22", 22, K, 0)!.dmrtSun).toBe(0); // night
    expect(hourRadiation("2026-12-22", 13, K, null)).toBeNull();
  });
});

describe("feel-3: 肌感 on UTCI", () => {
  it("is warmer in the sun than in the shade, more so in winter than Steadman's term said", () => {
    const w = feel3(10, 50, 3, hourRadiation("2026-12-22", 13, K, 1));
    expect(w.sun! - w.shade!).toBeGreaterThan(7);
    const s = feel3(33, 60, 3, hourRadiation("2026-06-21", 13, K, 1));
    expect(s.sun! - s.shade!).toBeGreaterThan(3);
    expect(s.sun! - s.shade!).toBeLessThan(w.sun! - w.shade!);
  });
  it("shows the summer's humid heat (33℃, 60%: well above the air in the shade)", () => {
    expect(feel3(33, 60, 1, null).shade!).toBeGreaterThan(34);
  });
  it("lowers the wind for the surroundings, from the station's height", () => {
    expect(utciWind(3, 10, 0.14)).toBeCloseTo(3, 9);
    expect(utciWind(3, 10, 0.4)).toBeLessThan(2);
    expect(utciWind(3, 6.5, 0.14)).toBeGreaterThan(3);
  });
});

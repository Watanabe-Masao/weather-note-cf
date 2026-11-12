// UTCI (shared/utci.ts) against pythermalcomfort 4.8.1 (test/fixtures/utci-reference.json: values
// computed with its utci(), limit_inputs=False), and the index's own reference points.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { saturationHpa, utci } from "../../shared/utci";

const ref = JSON.parse(readFileSync(new URL("../fixtures/utci-reference.json", import.meta.url), "utf8")) as { cases: { t: number; tr: number; v: number; rh: number; utci: number; utci_rounded: number }[] };

describe("UTCI", () => {
  it("matches pythermalcomfort (unrounded, to 1e-6; and its rounded output)", () => {
    for (const c of ref.cases) {
      expect(utci(c.t, c.tr, c.v, c.rh)).toBeCloseTo(c.utci, 6);
      expect(Math.round(utci(c.t, c.tr, c.v, c.rh) * 10) / 10).toBeCloseTo(c.utci_rounded, 6);
    }
    expect(ref.cases.length).toBeGreaterThan(40);
  });
  it("is about the air temperature in the reference condition (calm, shade, 50% humidity, 20℃)", () => {
    expect(utci(20, 20, 0.5, 50)).toBeGreaterThan(19);
    expect(utci(20, 20, 0.5, 50)).toBeLessThan(21);
  });
  it("rises with radiation and humidity in the heat, falls with wind in the cold", () => {
    expect(utci(33, 60, 1, 60)).toBeGreaterThan(utci(33, 33, 1, 60) + 5);
    expect(utci(33, 33, 1, 80)).toBeGreaterThan(utci(33, 33, 1, 60));
    expect(utci(0, 0, 8, 70)).toBeLessThan(utci(0, 0, 1, 70) - 5);
  });
  it("holds the wind inside the polynomial's range", () => {
    expect(utci(20, 20, 0, 50)).toBe(utci(20, 20, 0.5, 50));
    expect(utci(20, 20, 30, 50)).toBe(utci(20, 20, 17, 50));
  });
  it("uses the saturation vapour pressure of the UTCI code (about 23.4 hPa at 20℃)", () => {
    expect(saturationHpa(20)).toBeCloseTo(23.39, 1);
  });
});

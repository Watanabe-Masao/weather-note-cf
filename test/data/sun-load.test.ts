// #96: the candidate 日なた (feel-2) — the direct sun on a standing person (shared/sunLoad.ts).

import { describe, expect, it } from "vitest";
import { sunshineFraction, sunUpFraction } from "../../shared/brightness";
import { airMass, clearDni, directOnBody, directWarming, projectedArea } from "../../shared/sunLoad";

const K = "47893";

describe("the sun on a standing person", () => {
  it("meets more of the body with the sun low (ASHRAE 55 Table C-2, averaged over facing)", () => {
    expect(projectedArea(0)).toBeCloseTo(0.3, 1);
    expect(projectedArea(90)).toBeCloseTo(0.082, 3);
    for (let a = 0; a < 90; a += 5) expect(projectedArea(a + 5)).toBeLessThanOrEqual(projectedArea(a) + 1e-9);
    expect(projectedArea(-10)).toBe(projectedArea(0));
  });
  it("has a clear beam that weakens through more air, and none with the sun down", () => {
    expect(airMass(90)).toBeCloseTo(1, 2);
    expect(airMass(30)).toBeCloseTo(2, 1);
    expect(clearDni(90)).toBeGreaterThan(950);
    expect(clearDni(90)).toBeLessThan(1100);
    expect(clearDni(10)).toBeLessThan(clearDni(30));
    expect(clearDni(0)).toBe(0);
    expect(clearDni(-5)).toBe(0);
  });
  it("is zero after sunset, under cloud (no sunshine), and in proportion to the sunshine", () => {
    expect(directOnBody("2026-11-15", 20, K, 0)).toBe(0); // 19–20時, the sun down
    expect(directOnBody("2026-11-15", 13, K, 0)).toBe(0); // overcast noon
    const full = directOnBody("2026-11-15", 13, K, 1)!;
    expect(full).toBeGreaterThan(150);
    expect(directOnBody("2026-11-15", 13, K, 0.5)!).toBeCloseTo(full / 2, 6);
    expect(directOnBody("2026-11-15", 13, K, null)).toBeNull();
  });
  it("counts the sunshine an hour could have had (the sun above SUNSHINE_ALT, #132)", () => {
    // Kochi, 13 November: hour 17 (16–17時) ends with the sun below 3°; its sunshine is judged against the part above.
    const could = sunshineFraction("2026-11-13", 17, K);
    expect(could).toBeGreaterThan(0.5);
    expect(could).toBeLessThan(1);
    expect(sunUpFraction("2026-11-13", 17, K)).toBe(1);
    const all = directOnBody("2026-11-13", 17, K, could)!;
    expect(all).toBeGreaterThan(0);
    expect(directOnBody("2026-11-13", 17, K, could / 2)!).toBeCloseTo(all / 2, 6);
    expect(directOnBody("2026-11-13", 17, K, 1)!).toBeCloseTo(all, 6); // never more than all of it
    // The sun up but never above 3° (June, 19–20時): no sunshine could be recorded, so no beam is counted.
    expect(sunshineFraction("2026-06-21", 20, K)).toBe(0);
    expect(directOnBody("2026-06-21", 20, K, 0)).toBe(0);
  });
  it("warms a winter noon more and a summer noon less than k × level-ground radiation does", () => {
    const winter = directWarming(directOnBody("2026-12-22", 13, K, 1)!, 3);
    const summer = directWarming(directOnBody("2026-06-21", 13, K, 1)!, 3);
    expect(winter).toBeGreaterThan(summer);
    expect(directWarming(200, 0)).toBeGreaterThan(directWarming(200, 5)); // wind carries the heat away
    expect(directWarming(0, 3)).toBe(0);
  });
});

// 月の見え方（MA-02）：調査の Python（research/moon-appearance/ma02_visibility.py）と同じ値になるか。
import { describe, expect, it } from "vitest";
import { moonLook } from "../../shared/moonLook";

// [太陽の高さ, 太陽の方位, 月の高さ, 月の方位, 位相角, 輝面比, 距離km] → 色の濃さ, 赤み（Python の値）
const CASES: [number[], number, number][] = [
  [[28.6, 230, 0.3, 70, 57, 0.76, 383000], 0.0, 0.0],
  [[20.4, 230, 12.2, 90, 57, 0.77, 381000], 0.153, 0.0],
  [[5.1, 240, 30.2, 100, 57, 0.77, 380000], 0.5, 0.195],
  [[-0.1, 245, 36, 110, 57, 0.77, 379000], 0.9, 0.584],
  [[-5.9, 248, 41.5, 120, 57, 0.78, 378000], 0.999, 0.075],
  [[-49.3, 300, 58.4, 180, 55, 0.79, 375000], 1.0, 0.023],
  [[30, 180, 30, 270, 90, 0.5, 384400], 0.208, 0.0],
  [[-12, 250, 5, 90, 30, 0.93, 370000], 1.0, 1.0],
];

describe("moonLook (MA-02)", () => {
  for (const [
    [sunAlt, sunAz, moonAlt, moonAz, phaseAngle, fraction, km],
    strength,
    red,
  ] of CASES)
    it(`sun ${sunAlt}° moon ${moonAlt}°`, () => {
      const r = moonLook({
        sunAlt,
        sunAz,
        moonAlt,
        moonAz,
        phaseAngle,
        fraction,
        km,
      });
      expect(r.strength).toBeCloseTo(strength, 1);
      expect(r.red).toBeCloseTo(red, 1);
    });
  it("the 14:00 moon on the horizon is not seen in the day sky (渡辺さんの 11/20 の画面)", () => {
    expect(
      moonLook({
        sunAlt: 28.6,
        sunAz: 230,
        moonAlt: 0.3,
        moonAz: 70,
        phaseAngle: 57,
        fraction: 0.76,
        km: 383000,
      }).strength,
    ).toBe(0);
  });
  it("overcast hides the moon", () => {
    expect(
      moonLook({
        sunAlt: -40,
        sunAz: 0,
        moonAlt: 40,
        moonAz: 180,
        phaseAngle: 0,
        fraction: 1,
        km: 384400,
        overcast: true,
      }).strength,
    ).toBe(0);
  });
});

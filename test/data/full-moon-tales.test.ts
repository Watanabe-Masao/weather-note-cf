// 満月の季節の物語（2026-11-20 渡辺さんの資料「満月の物語」）：毎年使える文だけを持つ（その年だけのことは計算から）。
import { describe, expect, it } from "vitest";
import { BLUE_MOON, FULL_MOON_NAMES } from "../../shared/fullMoonNames";

describe("full moon tales", () => {
  it("コーンムーン以外の12の呼び名とブルームーンに物語があり、年や日付を含まない", () => {
    const all = [...FULL_MOON_NAMES, BLUE_MOON];
    for (const n of all) {
      if (n.name === "コーンムーン") continue;
      expect(n.tale, n.name).toBeTruthy();
      expect(n.tale!.tagline.length, n.name).toBeGreaterThan(4);
      expect(n.tale!.lines.length, n.name).toBeGreaterThanOrEqual(4);
      for (const t of [n.tale!.tagline, ...n.tale!.lines]) expect(t, n.name).not.toMatch(/20\d\d年|\d+月\d+日/);
    }
  });
});

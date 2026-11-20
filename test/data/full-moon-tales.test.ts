// 満月の季節の物語（2026-11-20 渡辺さんの資料「満月の物語」）：毎年使える文だけを持つ（その年だけのことは計算から）。
import { describe, expect, it } from "vitest";
import { BLUE_MOON, FULL_MOON_NAMES } from "../../shared/fullMoonNames";
import { fullMoonAlias, fullMoonName } from "../../shared/moon";

describe("full moon tales", () => {
  it("13の呼び名とブルームーンに物語があり、年や日付を含まない（コーンムーンは 11/20 に足した）", () => {
    const all = [...FULL_MOON_NAMES, BLUE_MOON];
    for (const n of all) {
      expect(n.tale, n.name).toBeTruthy();
      expect(n.tale!.tagline.length, n.name).toBeGreaterThan(4);
      expect(n.tale!.lines.length, n.name).toBeGreaterThanOrEqual(4);
      for (const t of [n.tale!.tagline, ...n.tale!.lines]) expect(t, n.name).not.toMatch(/20\d\d年|\d+月\d+日/);
    }
  });

  it("9月の満月がハーベストムーンの年はコーンムーンが別名、そうでない年の9月はコーンムーンが呼び名", () => {
    // 2026-09-27 はハーベストムーン（秋分にいちばん近い）→ 別名コーンムーン。
    const sep2026 = Date.parse("2026-09-26T16:49:00Z");
    expect(fullMoonName(sep2026).name).toBe("ハーベストムーン");
    expect(fullMoonAlias("ハーベストムーン", sep2026)).toBe("コーンムーン");
    // 2025-09-07 はコーンムーン（ハーベストムーンは 10/7）。別名は無い。
    const sep2025 = Date.parse("2025-09-07T18:09:00Z");
    expect(fullMoonName(sep2025).name).toBe("コーンムーン");
    expect(fullMoonAlias("コーンムーン", sep2025)).toBeNull();
    // 10月のハーベストムーンには別名を付けない。
    expect(fullMoonAlias("ハーベストムーン", Date.parse("2025-10-07T03:48:00Z"))).toBeNull();
  });
});

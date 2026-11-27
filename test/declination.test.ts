import { describe, expect, it } from "vitest";
import { toTrueNorth, westDeclination } from "../shared/declination";

const KOCHI = { lat: 33.5667, lon: 133.5483 };

describe("磁気偏角（国土地理院の近似式 2020.0 年値）", () => {
  it("原典の例：東京 35°41′N・139°42′E は西偏 7°36.5′", () => {
    const d = westDeclination(35 + 41 / 60, 139 + 42 / 60)!;
    expect(d * 60).toBeCloseTo(7 * 60 + 36.5, 0);
  });
  it("高知は西偏 7°33.8′（約 7.56°）", () => {
    expect(westDeclination(KOCHI.lat, KOCHI.lon)! * 60).toBeCloseTo(7 * 60 + 33.8, 0);
  });
  it("日本のまわりの外は直せない", () => {
    expect(westDeclination(51.5, -0.1)).toBeNull();
  });
});

describe("写真の方位を真北に", () => {
  it("真北（T）はそのまま", () => {
    expect(toTrueNorth(270, "T", KOCHI, KOCHI)).toEqual({ deg: 270, estimated: false, declination: null, model: null });
  });
  it("磁北（M）は撮影地点の偏角を引く（磁北の西 270° → 真北の約 262.4°）", () => {
    const t = toTrueNorth(270, "M", KOCHI, KOCHI);
    expect(t.deg!).toBeCloseTo(262.44, 1);
    expect(t.estimated).toBe(false);
    expect(t.model).toBe("gsi2020.0");
  });
  it("磁北で場所が無ければ観測所で補正して推定、0° をまたいでも 0〜360", () => {
    const t = toTrueNorth(3, "M", null, KOCHI);
    expect(t.deg!).toBeCloseTo(355.44, 1);
    expect(t.estimated).toBe(true);
  });
  it("基準が分からなければそのまま推定、海外の磁北は直せない", () => {
    expect(toTrueNorth(200, null, KOCHI, KOCHI)).toMatchObject({ deg: 200, estimated: true });
    expect(toTrueNorth(200, "M", { lat: 51.5, lon: -0.1 }, KOCHI).deg).toBeNull();
  });
});

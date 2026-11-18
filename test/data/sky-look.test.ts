// 端末を向けた方向（shared/skyLook.ts）：偏角、センサーの値から方位と高さ、ならし、窓の中の位置。
import { describe, expect, it } from "vitest";
import { azDiff, lookFrom, magneticDeclination, placeIn, smooth } from "../../shared/skyLook";

describe("磁気偏角（国土地理院 2020.0 の近似式）", () => {
  it("高知は西へ約7.6°、札幌は約9°、那覇は約5°", () => {
    expect(magneticDeclination(33.56, 133.53)).toBeCloseTo(7.6, 0);
    expect(magneticDeclination(43.06, 141.35)).toBeGreaterThan(8.5);
    expect(magneticDeclination(26.21, 127.68)).toBeLessThan(5.5);
  });
});

describe("センサーの値から背面カメラの向き", () => {
  it("縦に立てて水平に構える（beta 90）：高さ 0、方位は iPhone の値から偏角を引いた真北基準", () => {
    const l = lookFrom({ alpha: 0, beta: 90, gamma: 0, webkitCompassHeading: 187.6 }, 7.6)!;
    expect(l.altitude).toBeCloseTo(0, 5);
    expect(l.azimuth).toBeCloseTo(180, 5);
  });
  it("上へ30°傾けて見上げる（beta 120）：高さ 30°", () => {
    expect(lookFrom({ alpha: 0, beta: 120, gamma: 0, webkitCompassHeading: 90 }, 0)!.altitude).toBeCloseTo(30, 5);
  });
  it("画面を上に寝かせる（beta 0）：背面は真下（高さ −90°）", () => {
    expect(lookFrom({ alpha: 0, beta: 0, gamma: 0, webkitCompassHeading: 0 }, 0)!.altitude).toBeCloseTo(-90, 5);
  });
  it("iPhone の値が無く北を基準にした alpha（absolute）：alpha 90（反時計回り）なら背面は西", () => {
    const l = lookFrom({ alpha: 90, beta: 90, gamma: 0, absolute: true }, 0)!;
    expect(l.azimuth).toBeCloseTo(270, 5);
  });
  it("方位が分からない（北の基準が無い）ときは null", () => {
    expect(lookFrom({ alpha: 10, beta: 90, gamma: 0 }, 0)).toBeNull();
    expect(lookFrom({ alpha: null, beta: null, gamma: null }, 0)).toBeNull();
  });
});

describe("ならしと窓の中の位置", () => {
  it("方位は 359°→1° を近い方へならす", () => {
    const s = smooth({ azimuth: 359, altitude: 0 }, { azimuth: 1, altitude: 10 }, 0.5);
    expect(Math.abs(azDiff(s.azimuth, 0))).toBeLessThan(1e-9);
    expect(s.altitude).toBeCloseTo(5, 9);
  });
  it("真ん中の物は窓の真ん中、横に fov/2 ずれると端、外は inside=false", () => {
    expect(placeIn({ azimuth: 180, altitude: 20 }, { azimuth: 180, altitude: 20 }, 60, 300, 200)).toMatchObject({ x: 150, y: 100, inside: true });
    expect(placeIn({ azimuth: 180, altitude: 20 }, { azimuth: 210, altitude: 20 }, 60, 300, 200).x).toBeCloseTo(300, 9);
    expect(placeIn({ azimuth: 10, altitude: 0 }, { azimuth: 350, altitude: 0 }, 60, 300, 200).x).toBeCloseTo(50, 9);
    expect(placeIn({ azimuth: 180, altitude: 0 }, { azimuth: 0, altitude: 0 }, 60, 300, 200).inside).toBe(false);
  });
});

import { focalOf, project } from "../../shared/skyLook";
describe("カメラと同じ見え方（透視）", () => {
  const look = { azimuth: 180, altitude: 20 };
  const f = focalOf(60, 800);
  it("向いている方向は画面の真ん中、縦に画角の半分上は上の端", () => {
    expect(project(look, look, f, 400, 800)).toMatchObject({ x: 200, y: 400, inside: true });
    const top = project(look, { azimuth: 180, altitude: 50 }, f, 400, 800);
    expect(top.y).toBeCloseTo(0, 6);
    expect(top.x).toBeCloseTo(200, 6);
  });
  it("右（西寄り）は右へ、後ろは front=false", () => {
    expect(project(look, { azimuth: 190, altitude: 20 }, f, 400, 800).x).toBeGreaterThan(200);
    expect(project(look, { azimuth: 0, altitude: 20 }, f, 400, 800).front).toBe(false);
  });
});

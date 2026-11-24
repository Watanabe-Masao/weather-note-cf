// 高知県の地点の直し（2026-11-23、FS-02）：清水の位置と室戸岬の番号を気象庁の地点一覧に合わせた。
import { describe, expect, it } from "vitest";
import stations from "../../shared/stations.json";
import { knownStation } from "../../src/state";

const at = (id: string) => stations.find((s) => s.blockNo === id)!;

describe("高知県の地点", () => {
  it("matches JMA's list: 清水 at 足摺岬, 室戸岬 numbered 47899", () => {
    expect(at("47898")).toMatchObject({ name: "清水", lat: [32, 43.3], lon: [133, 0.6] });
    expect(at("47899")).toMatchObject({ name: "室戸岬", precNo: 74 });
    expect(stations.some((s) => s.blockNo === "47896")).toBe(false);
  });

  it("moves a remembered old number to the new one, and an unknown one to 高知", () => {
    expect(knownStation("47896")).toBe("47899");
    expect(knownStation("47898")).toBe("47898");
    expect(knownStation("00000")).toBe("47893");
    expect(knownStation(undefined)).toBe("47893");
  });
});

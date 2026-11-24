// 風向のまとめ（shared/windDirection.ts）：最頻値・円周平均・平均合成ベクトル長・静穏。
import { describe, expect, it } from "vitest";
import type { WeatherRow } from "../shared/types";
import { SECTORS, sectorOf, windOf, windSummary } from "../shared/windDirection";

const row = (direction: unknown, extra: Partial<WeatherRow> = {}): WeatherRow => ({ date: "2026-11-21", n: 1, type: "actual", provider: "JMA", raw: {}, quality: {}, direction, ...extra }) as WeatherRow;

describe("風向", () => {
  it("reads the text of the tables, AMeDAS degrees and calm, and forecast degrees", () => {
    expect(windOf(row("北北西"))).toBe(337.5);
    expect(windOf(row("静穏"))).toBe("calm");
    expect(windOf(row(null, { calm: true }))).toBe("calm");
    expect(windOf(row(225))).toBe(225);
    expect(windOf(row("×"))).toBeNull();
    expect(SECTORS[sectorOf(350)]).toBe("北");
    expect(SECTORS[sectorOf(11.3)]).toBe("北北東");
  });
  it("does not average 350° and 10° to 180°: the circular mean is north, and they agree (R near 1)", () => {
    const s = windSummary([row(350), row(10)]);
    expect(s.mean).toBe(0);
    expect(s.r).toBe(0.98);
  });
  it("north and south as often: no steady direction (R 0), no mean, and the mode is not guessed", () => {
    const s = windSummary([row("北"), row("南"), row("北"), row("南")]);
    expect(s.r).toBe(0);
    expect(s.mean).toBeNull();
    expect(s.mode).toBeNull();
  });
  it("breaks a tie by the stronger wind, and counts calm apart", () => {
    const s = windSummary([row("北", { wind: 1 }), row("南西", { wind: 4 }), row("静穏"), row("静穏")]);
    expect(SECTORS[s.mode!]).toBe("南西");
    expect(s.calm).toBe(2);
    expect(s.n).toBe(2);
  });
});

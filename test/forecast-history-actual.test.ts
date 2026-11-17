// 予報の履歴 (R6) の実績 (src/ui/forecastHistory/actual.ts): the app's own JMA rows as the forecast is compared
// with — only what was observed, and the temperatures over the same hours as the forecast (要件 R4).

import { describe, expect, it } from "vitest";
import type { WeatherRow } from "../shared/types";
import { actualOf, rangedTemps } from "../src/ui/forecastHistory/actual";

const hour = (n: number, temp: number, extra: Partial<WeatherRow> = {}): WeatherRow =>
  ({ date: "2026-11-18", n, type: "actual", provider: "JMA", raw: {}, quality: {}, temp, rain: 0, ...extra }) as WeatherRow;
const day = (max: number, min: number): WeatherRow => ({ date: "2026-11-18", n: 18, type: "actual", provider: "JMA", raw: {}, quality: {}, max, min }) as WeatherRow;

describe("予報の履歴：実績", () => {
  it("keeps only observed hours, and not a forecast's weather lent to one", () => {
    const a = actualOf(day(24.1, 17), [hour(1, 18), hour(2, 17.5, { weather: "晴れ", origin: { weather: "forecast" } }), hour(3, 17, { type: "forecast" })]);
    expect(a!.hours.map((h) => h.h)).toEqual([1, 2]);
    expect(a!.hours[1].wx).toBeNull();
    expect(actualOf({ ...day(20, 10), type: "forecast" }, [])).toEqual(null);
  });
  it("compares 府県天気予報 with 9〜18時 and 0〜9時 (0時 = the day before's 24時), and 週間 with the day", () => {
    const temps = [18, 17.6, 17.4, 17.2, 17.3, 17.5, 17.8, 18.2, 19, 20, 21, 21.8, 22.4, 22.6, 22.2, 21.4, 20.6, 19.8, 19, 18.6, 18.3, 18.1, 17.9, 17.5];
    const a = actualOf(day(24.1, 17), temps.map((t, i) => hour(i + 1, t)));
    const prev = actualOf(null, [hour(24, 18.4)]);
    expect(rangedTemps("VPFD51", a, prev)).toEqual({ max: 22.6, min: 17.2 });
    expect(rangedTemps("VPFW50", a, prev)).toEqual({ max: 24.1, min: 17 });
    // 前の日の24時が無ければ、朝の最低は出さない（そろわない値で比べない）。
    expect(rangedTemps("VPFD51", a, null)).toEqual({ max: 22.6, min: null });
  });
});

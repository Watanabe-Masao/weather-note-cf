// 空気のひとこと（src/airVerdict.ts、11/25）：ふだんより多い時間・見通し 5km 未満だけを拾う。そろわなければ「違いは無い」と言わない。
import { describe, expect, it } from "vitest";
import { airVerdict, hourSpans } from "../src/airVerdict";
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import type { WeatherRow } from "../shared/types";

const usual = { from: "2026-10-26", to: "2026-11-24", items: { pm2_5: { n: 720, q: [3, 10, 14, 18] as [number, number, number, number] }, dust: { n: 720, q: [0, 2, 5, 10] as [number, number, number, number] } } };
const hours = (f: (h: number) => Partial<AirHour>): AirHour[] => Array.from({ length: 24 }, (_, h) => ({ h, pm2_5: 8, pm10: 10, dust: 1, aod: 0.1, ...f(h) }));
const vis = (f: (n: number) => number, type: "actual" | "forecast" = "actual"): WeatherRow[] =>
  Array.from({ length: 24 }, (_, i) => ({ date: "2026-11-25", n: i + 1, type, provider: "JMA", raw: {}, quality: {}, visibility: f(i + 1) }));

describe("空気のひとこと", () => {
  it("spans of hours", () => {
    expect(hourSpans([13, 14, 15, 9])).toBe("9時・13〜15時");
    expect(hourSpans([8, 9], "時台")).toBe("8〜9時台");
  });
  it("dust above 90% of the usual, from CAMS", () => {
    const v = airVerdict({ hours: hours((h) => ({ dust: h >= 13 && h <= 15 ? 8 : 1 })), usual }, null, null);
    expect(v.facts).toEqual([{ key: "dust", text: "黄砂がふだんより多い（13〜15時）", who: "CAMS" }]);
  });
  it("PM2.5 from the measured hours when there are some, else CAMS", () => {
    const m: MeasuredHour[] = [9, 10].map((hour) => ({ hour, pm2_5: 20, ox: null, spm: null, no2: null, so2: null, wd: null, ws: null, fetchedAt: "x" }));
    const v = airVerdict({ hours: hours((h) => ({ pm2_5: h === 3 ? 30 : 8 })), usual }, { hours: m, usual }, null);
    expect(v.facts).toEqual([{ key: "pm", text: "PM2.5 がふだんより多い（8〜9時台）", who: "介良局の実測" }]);
    expect(airVerdict({ hours: hours((h) => ({ pm2_5: h === 3 ? 30 : 8 })), usual }, null, null).facts[0]).toMatchObject({ text: "PM2.5 がふだんより多い（3時）", who: "CAMS" });
  });
  it("visibility under 5 km, observed hours only", () => {
    expect(airVerdict(null, null, vis((n) => (n === 10 || n === 11 ? 3 : 20))).facts).toEqual([{ key: "vis", text: "見通しが 5km 未満（10〜11時）", who: "気象台の観測" }]);
    expect(airVerdict(null, null, vis(() => 3, "forecast")).facts).toEqual([]);
  });
  it("says nothing differs only when the day is there and the usual is known", () => {
    expect(airVerdict({ hours: hours(() => ({})), usual }, null, null).quiet).toBe("ふだんと大きな違いはありません");
    expect(airVerdict({ hours: hours(() => ({})).slice(0, 10), usual }, null, null).quiet).toBe("ふだんと比べる値がそろっていません");
    expect(airVerdict({ hours: hours(() => ({})) }, null, null).quiet).toBe("ふだんと比べる値がそろっていません");
  });
});

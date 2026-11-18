// 月の計算を国立天文台の暦と照らし合わせる（shared/moon.ts）。
// 出典：国立天文台 暦計算室「各地のこよみ」高知（緯度 33.5500°・経度 133.5333°・標高 0m）2026年11月の月の出入り。
// 表の時刻は分の位で丸めてあるので、出入り・南中は2分以内、方位は1°以内、南中の高さは0.5°以内、月齢（正午）は0.1日以内。
import { describe, expect, it } from "vitest";
import { dms, fullMoonName, moonDistance, moonMagnitude, moonPhase, moonQuarters, moonTimes } from "../../shared/moon";

const LAT = 33.55;
const LON = 133.5333;
// 日, 出, 出の方位, 南中, 南中の高さ, 入り, 入りの方位, 月齢（正午）
const NAOJ: [number, string, number | null, string, number | null, string, number | null, number][] = [
  [1, "23:01", 65.3, "5:16", 80.0, "12:35", 297.1, 21.5],
  [2, "", null, "6:12", 75.4, "13:14", 291.2, 22.5],
  [3, "0:09", 71.8, "7:03", 69.8, "13:47", 284.3, 23.5],
  [4, "1:15", 79.1, "7:50", 63.7, "14:16", 277.0, 24.5],
  [5, "2:18", 86.7, "8:35", 57.3, "14:44", 269.4, 25.5],
  [6, "3:20", 94.4, "9:19", 50.9, "15:11", 262.1, 26.5],
  [7, "4:20", 101.8, "10:03", 44.9, "15:39", 255.1, 27.5],
  [8, "5:21", 108.5, "10:48", 39.5, "16:08", 248.8, 28.5],
  [9, "6:23", 114.5, "11:35", 34.8, "16:42", 243.4, 29.5],
  [10, "7:24", 119.2, "12:24", 31.3, "17:20", 239.3, 0.8],
  [11, "8:23", 122.5, "13:15", 29.0, "18:04", 236.7, 1.8],
  [12, "9:19", 124.0, "14:06", 28.0, "18:53", 235.8, 2.8],
  [13, "10:10", 123.8, "14:57", 28.5, "19:47", 236.8, 3.8],
  [14, "10:55", 121.9, "15:47", 30.2, "20:43", 239.3, 4.8],
  [15, "11:33", 118.4, "16:35", 33.2, "21:42", 243.4, 5.8],
  [16, "12:07", 113.8, "17:21", 37.2, "22:40", 248.5, 6.8],
  [17, "12:37", 108.1, "18:05", 42.1, "23:39", 254.7, 7.8],
  [18, "13:05", 101.7, "18:47", 47.6, "", null, 8.8],
  [19, "13:31", 94.7, "19:30", 53.7, "0:37", 261.5, 9.8],
  [20, "13:58", 87.3, "20:14", 60.0, "1:37", 268.9, 10.8],
  [21, "14:26", 79.8, "21:00", 66.4, "2:39", 276.6, 11.8],
  [22, "14:58", 72.5, "21:51", 72.5, "3:44", 284.2, 12.8],
  [23, "15:36", 65.8, "22:47", 77.8, "4:54", 291.4, 13.8],
  [24, "16:21", 60.5, "23:48", 81.8, "6:07", 297.5, 14.8],
  [25, "17:17", 57.2, "", null, "7:22", 301.8, 15.8],
  [26, "18:22", 56.6, "0:54", 83.8, "8:33", 303.5, 16.8],
  [27, "19:34", 58.9, "2:01", 83.6, "9:36", 302.3, 17.8],
  [28, "20:48", 63.5, "3:05", 81.2, "10:29", 298.6, 18.8],
  [29, "22:00", 69.8, "4:05", 76.9, "11:12", 293.0, 19.8],
  [30, "23:08", 77.0, "4:59", 71.5, "11:48", 286.3, 20.8],
];
const min = (s: string) => (s ? Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]) : null);

describe("月の出・南中・月の入り・月齢（国立天文台 高知 2026年11月）", () => {
  for (const [d, rise, riseAz, transit, transitAlt, set, setAz, age] of NAOJ) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    it(date, () => {
      const t = moonTimes(date, LAT, LON);
      const check = (got: { at: number; azimuth: number } | null, want: string, az: number | null) => {
        if (!want) return expect(got).toBeNull();
        expect(got).not.toBeNull();
        expect(Math.abs(got!.at - min(want)!)).toBeLessThanOrEqual(2);
        expect(Math.abs(got!.azimuth - az!)).toBeLessThanOrEqual(1);
      };
      check(t.rise, rise, riseAz);
      check(t.set, set, setAz);
      if (!transit) expect(t.transit).toBeNull();
      else {
        expect(Math.abs(t.transit!.at - min(transit)!)).toBeLessThanOrEqual(2);
        expect(Math.abs(t.transit!.altitude - transitAlt!)).toBeLessThanOrEqual(0.5);
      }
      const noon = Date.parse(`${date}T12:00:00+09:00`);
      expect(Math.abs(moonPhase(noon).age - age)).toBeLessThanOrEqual(0.1);
    });
  }
});

describe("月相と距離", () => {
  it("2026年11月の新月・満月は、国立天文台の月齢（正午）と合う：11/10 正午に月齢 0.8、11/24 正午に 14.8 の付近", () => {
    const q = moonQuarters(Date.parse("2026-11-01T00:00:00+09:00"), 6);
    const nw = q.find((x) => x.kind === 0)!;
    // 月齢 0.8（11/10 正午）から逆算した新月の時刻と 0.1 日（2.4 時間）以内
    expect(Math.abs(nw.at - (Date.parse("2026-11-10T12:00:00+09:00") - 0.8 * 86_400_000))).toBeLessThan(0.1 * 86_400_000);
    const order = q.map((x) => x.kind);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBe((order[i - 1] + 1) % 4);
  });
  it("距離は 35.6万〜40.7万 km、見かけの大きさは 0.49〜0.57°", () => {
    for (let d = 1; d <= 30; d++) {
      const m = moonDistance(Date.parse(`2026-11-${String(d).padStart(2, "0")}T12:00:00+09:00`));
      expect(m.km).toBeGreaterThan(356_000);
      expect(m.km).toBeLessThan(407_000);
      expect(m.diameter).toBeGreaterThan(0.49);
      expect(m.diameter).toBeLessThan(0.57);
    }
  });
});

// 満月の呼び名・大きさの書き方・明るさ（2026-11-19）
describe("満月の呼び名（アメリカの農事暦）", () => {
  const full = (iso: string) => moonQuarters(Date.parse(iso), 4).find((q) => q.kind === 2)!.at;
  it("月ごとの名前、秋分にいちばん近いのがハーベスト、その次がハンターズ", () => {
    expect(fullMoonName(full("2026-01-01T00:00:00+09:00")).name).toBe("ウルフムーン");
    expect(fullMoonName(full("2026-09-20T00:00:00+09:00")).name).toBe("ハーベストムーン"); // 9/27
    expect(fullMoonName(full("2026-10-20T00:00:00+09:00")).name).toBe("ハンターズムーン"); // 10/26
    expect(fullMoonName(full("2026-11-20T00:00:00+09:00")).name).toBe("ビーバームーン"); // 11/24
    expect(fullMoonName(full("2026-12-20T00:00:00+09:00")).name).toBe("コールドムーン");
  });
  it("同じ月の2回目の満月はブルームーン（2026年5月31日）", () => {
    const b = fullMoonName(full("2026-05-20T00:00:00+09:00"));
    expect(b.blue).toBe(true);
    expect(fullMoonName(full("2026-04-25T00:00:00+09:00")).blue).toBe(false);
  });
});
describe("大きさと明るさ", () => {
  it("度・分・秒", () => {
    expect(dms(0.5458)).toBe("0°32′45″");
    expect(dms(0.5)).toBe("0°30′00″");
  });
  it("満月は約 −12.7 等、半月は約 −10 等", () => {
    expect(moonMagnitude(Date.parse("2026-11-24T23:54:00+09:00"))).toBeCloseTo(-12.7, 0);
    expect(moonMagnitude(Date.parse("2026-11-17T20:48:00+09:00"))).toBeGreaterThan(-10.5);
  });
});

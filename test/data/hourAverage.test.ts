import { describe, expect, it } from "vitest";
import type { HourPoint } from "../../src/dayDetail";
import { daysBefore, meanByHour, medianByHour, nextWindow } from "../../src/hourAverage";
import { detailMetric, formatDetail, visibilityDiff } from "../../src/dayDetail";

const day = (f: (h: number) => number | null): HourPoint[] => Array.from({ length: 24 }, (_, i) => ({ hour: i + 1, v: f(i + 1), forecast: false }));

describe("手前の平均", () => {
  it("takes the days before the day, not the day itself, and none from today on", () => {
    expect(daysBefore("2024-11-03", 7, "2026-11-13")).toEqual([
      "2024-11-02", "2024-11-01", "2024-10-31", "2024-10-30", "2024-10-29", "2024-10-28", "2024-10-27",
    ]);
    // A comparison day a week ahead: only the days up to yesterday.
    expect(daysBefore("2026-11-20", 7, "2026-11-13")).toEqual([]);
    expect(daysBefore("2026-11-20", 14, "2026-11-13")).toEqual(["2026-11-12", "2026-11-11", "2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06"]);
    expect(daysBefore("2026-11-13", 7, "2026-11-13")).toHaveLength(7);
  });

  it("averages each hour, and leaves an hour empty when fewer than half the days have it", () => {
    const m = meanByHour([day((h) => h), day((h) => h + 2), day((h) => (h === 5 ? null : h + 4))], 3);
    expect(m[0].v).toBe(3); // (1 + 3 + 5) / 3
    expect(m[4].v).toBe(6); // hour 5: (5 + 7) / 2, two of three days
    const sparse = meanByHour([day((h) => h), day(() => null), day(() => null), day(() => null)], 7);
    expect(sparse.every((p) => p.v == null)).toBe(true);
  });

  it("視程：the median of each hour (before → after), the days counted, missing days left out", () => {
    // 1週のうち 5 日は上限の 20、2 日だけ霞んで 6・8 km（9 時）。欠けた日が 1 日。
    const week = [20, 20, 20, 6, 20, 8, 20].map((v9) => day((h) => (h === 9 ? v9 : 20)));
    week[2] = day((h) => (h === 9 ? null : 20));
    const before = meanByHour(week, 7)[8];
    const after = medianByHour(week, 7)[8];
    expect(+before.v!.toFixed(2)).toBe(15.67); // 平均：霞んだ 2 日に引っぱられる
    expect(after.v).toBe(20); // 中央値：ふつうの見通し（「20 km 以上」）
    expect(after.n).toBe(6); // 値のあった日（欠けた 1 日は数えない）
    expect(medianByHour([day(() => 6), day(() => 10), day(() => 20), day(() => 12)], 4)[0].v).toBe(11);
    // ほかの項目は平均のまま（数も持つ）。
    expect(meanByHour(week, 7)[8].n).toBe(6);
  });

  it("視程：20 reads 20 km or more, and a difference with it is a bound or unknown", () => {
    const m = detailMetric("visibility");
    expect(formatDetail(20, m)).toBe("20.0+");
    expect(formatDetail(12.4, m)).toBe("12.4");
    expect(formatDetail(20, detailMetric("humidity"))).toBe("20");
    expect(visibilityDiff(12, 20)).toBe("−8.0以下");
    expect(visibilityDiff(20, 14)).toBe("+6.0以上");
    expect(visibilityDiff(20, 20)).toBe("");
    expect(visibilityDiff(12, 9.5)).toBe("+2.5");
  });

  it("steps 1週 → 2週 → 1か月 → 1週", () => {
    expect([nextWindow(7), nextWindow(14), nextWindow(30)]).toEqual([14, 30, 7]);
  });
});

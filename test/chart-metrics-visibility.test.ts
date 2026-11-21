// 視程の日の値（src/chartMetrics.ts）：最小・最大と中央値（平均ではない、2026-11-22）。
import { describe, expect, it } from "vitest";
import { hourlyMedian } from "../src/chartMetrics";

const day = (vs: number[]) => vs.map((v, i) => ({ date: "2026-11-15", n: i + 1, type: "actual" as const, provider: "JMA", raw: {}, quality: {}, visibility: v }));

describe("視程の中央値", () => {
  it("is the day's usual view, not pulled down by a few hazy hours", () => {
    // 20 時間は上限の 20、4 時間だけ 6〜10 km：平均は 18.8 だが、中央値は 20。
    const h = day([...Array(20).fill(20), 6, 7, 8, 10]);
    expect(hourlyMedian(h, "visibility")).toBe(20);
    expect(hourlyMedian(day([...Array(12).fill(20), ...Array(12).fill(8)]), "visibility")).toBe(14);
  });
  it("needs most of the day", () => {
    expect(hourlyMedian(day(Array(10).fill(20)), "visibility")).toBeNull();
  });
});

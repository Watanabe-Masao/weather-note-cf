// 空気の質の「ふだん」（shared/airUsual.ts、11/25）：手前30日の分位で5段。同じ値が並んでも「ふだん」、7日分に届かなければ比べない。
import { describe, expect, it } from "vitest";
import { quantile, USUAL_MIN_HOURS, usualItem, usualLevel } from "../shared/airUsual";

describe("ふだん", () => {
  it("quantiles by linear interpolation", () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });
  it("needs 7 days of hours", () => {
    expect(usualItem(Array.from({ length: USUAL_MIN_HOURS - 1 }, (_, i) => i))).toBeNull();
    expect(usualItem(Array.from({ length: USUAL_MIN_HOURS }, (_, i) => i))!.n).toBe(USUAL_MIN_HOURS);
  });
  it("levels: below 10% / up to 75% / 90% / 98% / above; the same values stay ふだん", () => {
    const u = usualItem(Array.from({ length: 1001 }, (_, i) => i / 10))!; // 0〜100
    expect([5, 9.99, 10, 75, 80, 90, 98, 98.1].map((v) => usualLevel(v, u))).toEqual([0, 0, 1, 1, 2, 2, 3, 4]);
    const flat = usualItem(Array(200).fill(0.001))!;
    expect([0.0009, 0.001, 0.002].map((v) => usualLevel(v, flat))).toEqual([0, 1, 4]);
    expect(usualLevel(null, u)).toBe(-1);
    expect(usualLevel(5, null)).toBeNull();
  });
});

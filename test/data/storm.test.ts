import { describe, expect, it } from "vitest";
import { stormLevel, stormReason } from "../../shared/storm";

describe("強風・暴風 by JMA's Kochi city criteria (#175)", () => {
  it("marks the real strong days", () => {
    // Typhoon No.14 (2022-09-19): mean 11.6, gust 23.0 → 強風 by its gust.
    expect(stormLevel(11.6, 23.0)).toBe("strong");
    // The low of 2024-04-09: mean 14.4, gust 24.8 → 強風.
    expect(stormLevel(14.4, 24.8)).toBe("strong");
  });
  it("暴風 at a mean of 20 or a gust of 30", () => {
    expect(stormLevel(20, 25)).toBe("storm");
    expect(stormLevel(15, 30)).toBe("storm");
  });
  it("an ordinary windy day is not marked; missing values do not mark", () => {
    expect(stormLevel(8.4, 14.6)).toBeNull();
    expect(stormLevel(null, null)).toBeNull();
    expect(stormLevel(null, 21)).toBe("strong");
  });
  it("says why", () => {
    expect(stormReason(14.4, 24.8)).toBe("最大風速 14.4 m/s・最大瞬間 24.8 m/s");
  });
});

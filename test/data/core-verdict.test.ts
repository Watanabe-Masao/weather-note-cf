// 「効いた」と言える決まり (principles 7): beating the model without the part is not enough — the
// answers' shares alone must be beaten first.

import { describe, expect, it } from "vitest";
import { type ScoreComparison, verdict } from "../../src/core";

const c = (interval: [number, number] | null): ScoreComparison => ({ n: 40, days: 20, rpsA: 0.2, rpsB: 0.2, hitsA: 0, hitsB: 0, diff: interval ? (interval[0] + interval[1]) / 2 : 0, interval });

describe("verdict", () => {
  it("too few days: no interval, nothing to say", () => expect(verdict(c(null), c([-0.1, -0.05]))).toBe("tooFew"));
  it("not beating the shares alone: nothing learned from the weather, whatever S1 does against base", () => {
    expect(verdict(c([-0.02, -0.01]), c([0.004, 0.03]))).toBe("noWeather");
    expect(verdict(c([-0.02, -0.01]), c([-0.01, 0.01]))).toBe("noWeather");
  });
  it("beating both: it helps", () => expect(verdict(c([-0.02, -0.01]), c([-0.05, -0.02]))).toBe("helps"));
  it("worse than without it", () => expect(verdict(c([0.01, 0.02]), c([-0.05, -0.02]))).toBe("hurts"));
  it("spanning 0", () => expect(verdict(c([-0.01, 0.01]), c([-0.05, -0.02]))).toBe("unclear"));
});

import { describe, expect, it } from "vitest";
import { confidenceOf, ensembleSpreads, spreadOf } from "../../shared/confidence";

const runs = (base: number, spread: number, n = 20) => Array.from({ length: n }, (_, i) => base + spread * ((i / (n - 1)) * 2 - 1));

describe("信頼度 from an ensemble", () => {
  it("is A when the runs agree and none of them rains", () => {
    const s = spreadOf(runs(20, 0.5), runs(10, 0.5), runs(0, 0))!;
    expect(confidenceOf(s)).toBe("A");
  });

  it("drops to B and C as the temperature spreads", () => {
    expect(confidenceOf(spreadOf(runs(20, 4), runs(10, 1), runs(0, 0))!)).toBe("B");
    expect(confidenceOf(spreadOf(runs(20, 9), runs(10, 1), runs(0, 0))!)).toBe("C");
  });

  it("is C when the runs split evenly on rain, B when somewhat split", () => {
    const half = Array.from({ length: 20 }, (_, i) => (i < 10 ? 5 : 0));
    expect(confidenceOf(spreadOf(runs(20, 0.5), runs(10, 0.5), half)!)).toBe("C");
    const quarter = Array.from({ length: 20 }, (_, i) => (i < 5 ? 5 : 0));
    expect(confidenceOf(spreadOf(runs(20, 0.5), runs(10, 0.5), quarter)!)).toBe("B");
  });

  it("says nothing with too few runs, and skips missing values", () => {
    expect(spreadOf([20, 21], [10, 11], [0, 0])).toBeNull();
    expect(spreadOf([20, null, 21, 20, 21, 20], [10, 10, 10, 10, 10, null], [0, 0, 0, 0, 0, 0])?.members).toBe(5);
  });

  it("reads the control run and members per day from the API's daily block", () => {
    const daily: Record<string, unknown> = { time: ["2026-11-20", "2026-11-21"] };
    for (let m = 0; m <= 10; m++) {
      const suffix = m === 0 ? "" : `_member${String(m).padStart(2, "0")}`;
      daily["temperature_2m_max" + suffix] = [20 + m * 0.1, 18 + m];
      daily["temperature_2m_min" + suffix] = [10, 9];
      daily["precipitation_sum" + suffix] = [0, m % 2 ? 4 : 0];
    }
    const s = ensembleSpreads(daily);
    expect(s.get("2026-11-20")!.members).toBe(11);
    expect(confidenceOf(s.get("2026-11-20")!)).toBe("A");
    expect(confidenceOf(s.get("2026-11-21")!)).toBe("C");
  });
});

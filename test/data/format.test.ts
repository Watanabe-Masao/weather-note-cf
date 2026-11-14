import { describe, expect, it } from "vitest";
import { signedDiff } from "../../src/design/format";

describe("差は表示している値どうし (#151)", () => {
  it("rounds each value first, so the numbers on screen add up", () => {
    // 22.14 and 21.26 show as 22.1 and 21.3: on screen +0.8, not the +0.9 of the unrounded values.
    expect(signedDiff(22.14, 21.26, 1)).toBe("+0.8");
    // −2.44 and +2.54 show as −2.4 and +2.5: −4.9, not −5.0.
    expect(signedDiff(-2.44, 2.54, 1)).toBe("−4.9");
    expect(signedDiff(1016.4, 1015.6, 0)).toBe("±0");
  });
});

// The year's two forms (#151 年の書き方): the long one for headers, the short one for narrow places.
import { describe, expect, it } from "vitest";
import { dateLabel, shortDay, yearMark } from "../../src/design/format";

describe("year forms", () => {
  it("short: ’25/11/10 only in another year, with the curly mark", () => {
    expect(shortDay("2025-11-10", "2026-11-10")).toBe("’25/11/10");
    expect(shortDay("2026-11-08", "2026-11-10")).toBe("11/8");
    expect(shortDay("2025-11-10", "2026-11-10", { weekday: true })).toBe("’25/11/10（月）");
    expect(yearMark("2024-03-01")).toBe("’24");
    expect(shortDay("2025-11-10", "2026-11-10")).not.toContain("'");
  });
  it("long: 2025/11/10（月）", () => {
    expect(dateLabel("2025-11-10", { year: true })).toBe("2025/11/10（月）");
  });
});

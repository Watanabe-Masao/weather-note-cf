import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/feelSettings";

const base = { thresholds: [10, 15, 21, 25] as [number, number, number, number], alpha: 0.4, absorb: 0.2, heights: { "47893": 18 } };

describe("feel settings", () => {
  it("keeps valid edits", () => {
    expect(sanitize({ ...base, thresholds: [8, 13, 19, 23] }, base).thresholds).toEqual([8, 13, 19, 23]);
  });

  it("keeps the previous values when an edit is invalid, instead of resetting everything", () => {
    const edited = sanitize({ ...base, thresholds: [10, 1, 21, 25], alpha: 9, heights: { "47893": 0 } }, base);
    expect(edited.thresholds).toEqual([10, 15, 21, 25]);
    expect(edited.alpha).toBe(0.4);
    expect(edited.heights["47893"]).toBe(18);
  });

  it("starts from defaults when nothing valid is stored", () => {
    expect(sanitize("garbage")).toMatchObject({ thresholds: [10, 15, 21, 25], alpha: 0.4, absorb: 0.2, heights: {} });
  });
});

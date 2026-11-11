import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/feelSettings";

const base = { thresholds: [5, 10, 15, 21, 25, 29] as [number, number, number, number, number, number], alpha: 0.4, absorb: 0.2, heights: { "47893": 18 } };

describe("feel settings", () => {
  it("keeps valid edits", () => {
    expect(sanitize({ ...base, thresholds: [3, 8, 13, 19, 23, 28] }, base).thresholds).toEqual([3, 8, 13, 19, 23, 28]);
  });

  it("turns the old four boundaries (five steps) into the inner four of seven, widening the ends by the same step", () => {
    expect(sanitize({ ...base, thresholds: [10, 15, 21, 25] }, base).thresholds).toEqual([5, 10, 15, 21, 25, 29]);
    expect(sanitize({ ...base, thresholds: [8, 13, 19, 23] }, base).thresholds).toEqual([3, 8, 13, 19, 23, 27]);
  });

  it("keeps the display scale, 7 when unset or invalid", () => {
    expect(sanitize({ ...base, scale: 5 }, base).scale).toBe(5);
    expect(sanitize({ ...base, scale: 4 }, base).scale).toBe(7);
    expect(sanitize({ ...base }, base).scale).toBe(7);
  });

  it("keeps the previous values when an edit is invalid, instead of resetting everything", () => {
    const edited = sanitize({ ...base, thresholds: [5, 10, 1, 21, 25, 29], alpha: 9, heights: { "47893": 0 } }, base);
    expect(edited.thresholds).toEqual([5, 10, 15, 21, 25, 29]);
    expect(edited.alpha).toBe(0.4);
    expect(edited.heights["47893"]).toBe(18);
  });

  it("starts from defaults when nothing valid is stored", () => {
    expect(sanitize("garbage")).toMatchObject({ thresholds: [5, 10, 15, 21, 25, 29], alpha: 0.4, absorb: 0.2, heights: {} });
  });
});

import { moveThreshold } from "../../src/ui/Settings";

describe("level boundaries in settings", () => {
  it("snaps to 0.5℃ and stays between its neighbours", () => {
    const t: [number, number, number, number, number, number] = [5, 10, 15, 21, 25, 29];
    expect(moveThreshold(t, 2, 16.2)).toEqual([5, 10, 16, 21, 25, 29]);
    expect(moveThreshold(t, 2, 30)).toEqual([5, 10, 20.5, 21, 25, 29]);
    expect(moveThreshold(t, 3, 0)).toEqual([5, 10, 15, 15.5, 25, 29]);
    expect(moveThreshold(t, 0, -40)).toEqual([-5, 10, 15, 21, 25, 29]);
    expect(moveThreshold(t, 5, 60)).toEqual([5, 10, 15, 21, 25, 40]);
  });
});

import { describe, expect, it } from "vitest";
import { momentUnder } from "../../src/beta/AfterAnswer";
import { ensembleFromReports } from "../../src/beta/comfort";
import type { Report } from "../../src/beta/reports";

describe("答えた直後 (#118)", () => {
  it("says nothing it cannot compute: an answer without the inputs to read it", () => {
    const ens = ensembleFromReports([]);
    const bare = { id: "x", at: "2026-11-13T03:00:00Z", sensation: 0, scaleVersion: 4, updatedAt: 1 } as unknown as Report;
    expect(momentUnder(ens, bare)).toBeNull();
  });
});

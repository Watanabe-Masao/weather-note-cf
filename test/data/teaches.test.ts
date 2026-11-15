// comfort-8: the models learn only from reports whose 肌感 is the current one (#189 review).
import { describe, expect, it } from "vitest";
import { makeReport } from "../../research/data/fixture";
import { teaches } from "../../src/beta/reports";
import { observationsOf } from "../../src/beta/engine/observations";
import { preferenceObservations } from "../../src/beta/preferenceModel";
import { FEEL_TRANSFORM } from "../../shared/feel";

const feel1 = (r: ReturnType<typeof makeReport>) => ({ ...r, snapshot: { ...r.snapshot!, transform: "feel-1" } });

describe("teaches (comfort-8)", () => {
  it("learns from the current words and 肌感 only; keeps the others out", () => {
    const now = makeReport("a", 12, 18, 0);
    expect(now.snapshot?.transform).toBe(FEEL_TRANSFORM);
    expect(teaches(now)).toBe(true);
    expect(teaches(feel1(now))).toBe(false);
    expect(teaches({ ...now, scaleVersion: 3 })).toBe(false);
    expect(teaches({ ...now, deleted: true })).toBe(false);
  });
  it("the feeling and the preference models leave a feel-1 report out", () => {
    const rs = [makeReport("a", 9, 14, -1, { thermalPreference: "warmer" }), makeReport("b", 13, 20, 1, { thermalPreference: "cooler" })];
    expect(observationsOf(rs, 0.8)).toHaveLength(2);
    expect(observationsOf([rs[0], feel1(rs[1])], 0.8)).toHaveLength(1);
    expect(preferenceObservations([rs[0], feel1(rs[1])], "thermal")).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { adoptionOn, compareOn, compareRolling, compareStored, eligibleOf, LOG_FLOOR, logLoss, pairOf, type Prediction } from "../../src/beta/engine/compareAll";
import { sharedPrediction } from "../../src/beta/engine/checks";
import { seeded } from "../../src/beta/engine/diagnostics";
import { rps } from "../../src/beta/engine/evaluation";
import { type Report, SCALE_VERSION } from "../../src/beta/reports";

const P = (m: number) => sharedPrediction(m, 15); // a smooth 7-step distribution around m (shared constants at a = 15)

/** Reports a day apart (two on some days), with stored predictions of M1 (always) and M3 (not on every third). */
function reports(n: number, seed = 2): Report[] {
  const r = seeded(seed);
  const out: Report[] = [];
  for (let i = 0; i < n; i++) {
    const t = Date.parse("2026-09-01T03:00:00Z") + Math.floor(i / 2) * 86_400_000 + (i % 2) * 3_600_000;
    const e = 10 + r() * 16;
    const y = Math.max(-3, Math.min(3, Math.round((e - 19) / 4 + (r() - 0.5))));
    const models = [{ id: "M1", weight: 0.5, probs: P(e - 1), mode: 0, mu: 18, h: 3, n: i }];
    if (i % 3) models.push({ id: "M3", weight: 0.5, probs: P(e + 2), mode: 0, mu: 18, h: 3, n: i });
    out.push({
      id: `r${String(i).padStart(3, "0")}`,
      at: new Date(t).toISOString(),
      sensation: y,
      scaleVersion: SCALE_VERSION,
      exposure: "shade",
      snapshot: { shadeTemp: e, sunTemp: e } as never,
      baseline: { value: 14 + (i % 30) / 3, alpha: 0.8 } as never,
      comfort: { probs: P(e), mode: 0, n: i, models } as never,
      updatedAt: 1,
    } as unknown as Report);
  }
  return out;
}

describe("every candidate on the same answers (#117)", () => {
  it("T5: RPS and log loss as by hand", () => {
    const p = [0, 0, 0.25, 0.5, 0.25, 0, 0];
    expect(logLoss(p, 0)).toBeCloseTo(Math.log(2), 12);
    expect(logLoss(p, 3)).toBeCloseTo(-Math.log(LOG_FLOOR), 12); // floored for the log only
    // RPS: cumulative 0,0,.25,.75,1,1 against an answer of 0 (step 4): (0+0+.0625+.0625+0+0)/6.
    expect(rps(p, 0)).toBeCloseTo(0.125 / 6, 12);
  });

  it("T3: one common set for all, coverage per candidate", () => {
    const c = compareStored(reports(60), ["shared", "mixed", "M1", "M3"]);
    expect(c.eligible).toBe(60);
    expect(c.commonN).toBe(40); // M3 is missing on every third
    for (const k of c.candidates) expect(c.rows.every((row) => k.id in row.scores)).toBe(true);
    expect(c.candidates.find((k) => k.id === "M1")!.coverage).toBe(1);
    expect(c.candidates.find((k) => k.id === "M3")!.coverage).toBeCloseTo(40 / 60, 9);
    // Leaving M3 out: M1 and the shared constants on all 60.
    expect(compareStored(reports(60), ["shared", "M1"]).commonN).toBe(60);
  });

  it("T4, T10: a candidate still at its prior is shown as such and not adopted", () => {
    const c = compareStored(reports(60), ["M1", "M3"]);
    const m1 = c.candidates.find((k) => k.id === "M1")!;
    expect(m1.learn.priorOnly).toBe(0); // the first answer (n 0) has no M3, so it is not common
    expect(m1.learn.few).toBeGreaterThan(0);
    expect(m1.state).toBe("few");
    const verdict = adoptionOn(c, "M1", "M3", false);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("学習が少ない");
    // An older report without the counts: unknown, not taken as learned.
    const old = reports(30).map((r) => ({ ...r, comfort: { ...r.comfort!, models: r.comfort!.models.map(({ n: _n, ...m }) => m) } }));
    expect(compareStored(old, ["M1"]).candidates[0].state).toBe("unknown");
  });

  it("T9: the order of the input does not matter (ties broken by id)", () => {
    const rs = reports(40);
    const a = compareStored(rs);
    const b = compareStored([...rs].reverse());
    expect(b.rows.map((r) => r.id)).toEqual(a.rows.map((r) => r.id));
    expect(b.candidates.map((k) => k.rps)).toEqual(a.candidates.map((k) => k.rps));
  });

  it("T1, T2: rolling origin learns only from answers strictly before, never from the same moment or later", () => {
    const rs = reports(30);
    // Two answers at the very same moment.
    rs[11] = { ...rs[11], at: rs[10].at };
    const seen = new Map<string, string[]>();
    const fit = (past: Report[], r: Report): Prediction => {
      seen.set(r.id, past.map((q) => q.id));
      const m = past.length ? past.reduce((s, q) => s + (q.sensation as number), 0) / past.length : 0;
      return { probs: P(19 + 4 * m), learned: past.length };
    };
    const c1 = compareRolling(rs, [{ id: "mean", label: "平均", fit }], 3);
    expect(seen.get(rs[11].id)).not.toContain(rs[10].id);
    expect(seen.get(rs[10].id)).not.toContain(rs[11].id);
    for (const [id, past] of seen) {
      const at = rs.find((r) => r.id === id)!.at;
      expect(past.every((p) => rs.find((r) => r.id === p)!.at < at)).toBe(true);
    }
    // Changing a later answer does not change an earlier prediction.
    const changed = rs.map((r, i) => (i === 25 ? { ...r, sensation: 3 as const } : r));
    const c2 = compareRolling(changed, [{ id: "mean", label: "平均", fit }], 3);
    const early = (c: typeof c1) => c.rows.filter((r) => r.at < rs[25].at).map((r) => r.scores.mean.rps);
    expect(early(c2)).toEqual(early(c1));
  });

  it("T6: the pair on the common answers uses whole days", () => {
    const c = compareStored(reports(80), ["shared", "M1"]);
    const d = pairOf(c, "shared", "M1")!;
    expect(d.n).toBe(80);
    expect(d.days).toBe(40);
  });

  it("keeps E to the same answer words, not deleted, whole steps", () => {
    const rs = reports(5);
    rs[0] = { ...rs[0], deleted: true } as Report;
    rs[1] = { ...rs[1], scaleVersion: 1 } as Report;
    expect(eligibleOf(rs)).toHaveLength(3);
    expect(compareOn([], []).commonN).toBe(0);
  });
});

describe("a candidate that rarely predicts", () => {
  it("is left out of the common set instead of shrinking it, with its own answers only", () => {
    const rs = reports(60).map((r, i) => (i % 10 ? { ...r, comfort: { ...r.comfort!, models: r.comfort!.models.filter((m) => m.id !== "M3") } } : r));
    const c = compareStored(rs, ["shared", "M1", "M3"], 0.8);
    expect(c.commonN).toBe(60);
    const m3 = c.candidates.find((k) => k.id === "M3")!;
    expect([m3.inCommon, m3.rps, m3.rpsOwn != null]).toEqual([false, null, true]);
    expect(compareStored(rs, ["shared", "M1", "M3"]).commonN).toBeLessThan(10); // all in: only where M3 is
  });
});

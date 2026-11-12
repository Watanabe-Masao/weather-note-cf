import { describe, expect, it } from "vitest";
import { DRIFT_LIMIT, DRIFT_N, modelRecords, referenceProbs, rps, trackRecord } from "../../src/beta/comfort";
import { type Report, SCALE_VERSION } from "../../src/beta/reports";

const sure = (k: number) => Array.from({ length: 7 }, (_, i) => (i === k + 3 ? 0.94 : 0.01));
let t = Date.parse("2026-11-01T00:00:00Z");
const report = (y: number, probs: number[], over: Partial<Report> = {}) =>
  ({
    id: `r${t}`,
    at: new Date((t += 3_600_000)).toISOString(),
    sensation: y,
    scaleVersion: SCALE_VERSION,
    comfort: { probs, mode: probs.indexOf(Math.max(...probs)) - 3, models: [{ id: "M0", weight: 1, probs, mode: 0, mu: 18, h: 3 }] },
    updatedAt: 1,
    ...over,
  }) as unknown as Report;

describe("MATH-08: the track record of predictions made in advance (#34)", () => {
  it("scores with RPS against the person's earlier answers, and says how much better it is", () => {
    const list = Array.from({ length: 30 }, (_, i) => report(i % 3 === 0 ? 1 : 0, sure(i % 3 === 0 ? 1 : 0)));
    const r = trackRecord(list);
    expect(r.n).toBe(30);
    const expectRps = list.reduce((s, x) => s + rps(x.comfort!.probs, x.sensation), 0) / 30;
    expect(r.rps).toBeCloseTo(expectRps, 3);
    const ref = list.reduce((s, x, i) => s + rps(referenceProbs(list.slice(0, i).map((z) => z.sensation)), x.sensation), 0) / 30;
    expect(r.refRps).toBeCloseTo(ref, 3);
    expect(r.skill!).toBeGreaterThan(0.5); // sure and right: far better than the frequencies
    expect(modelRecords(list).M0.rps).toBeCloseTo(r.rps!, 6);
  });

  it("checks calibration on the three sides: what was said 94% of the time happened that often", () => {
    const list = Array.from({ length: 50 }, (_, i) => report(i < 47 ? 0 : -1, sure(0)));
    const top = trackRecord(list).calibration.find((b) => b.lo === 0.9)!;
    expect(top.n).toBe(50);
    expect(top.predicted).toBeCloseTo(0.94, 2);
    expect(top.observed).toBeCloseTo(0.94, 2);
    const total = trackRecord(list).calibration.reduce((s, b) => s + b.n, 0);
    expect(total).toBe(150); // three sides per prediction
  });

  it("orders the scores in time, ten at a time", () => {
    const r = trackRecord(Array.from({ length: 25 }, () => report(0, sure(0))));
    expect(r.series.map((s) => s.n)).toEqual([10, 10, 5]);
    expect(r.series[0].from < r.series[2].to).toBe(true);
  });

  it(`warns when the latest ${DRIFT_N} answers lean one way by more than ${DRIFT_LIMIT} steps`, () => {
    const steady = Array.from({ length: 20 }, () => report(0, sure(0)));
    expect(trackRecord(steady).drifting).toBe(false);
    const colder = [...steady, ...Array.from({ length: DRIFT_N }, () => report(-1, sure(0)))];
    const r = trackRecord(colder);
    expect(r.drifting).toBe(true);
    expect(r.recentBias!).toBeLessThan(-DRIFT_LIMIT);
    expect(trackRecord(steady.slice(0, 5)).recentBias).toBeNull(); // too few to say
  });

  it("judges only answers on the current scale version, and counts the others", () => {
    const old = Array.from({ length: 4 }, () => report(-3, sure(-3), { scaleVersion: 2 }));
    const none = report(0, sure(0), { scaleVersion: undefined });
    const now = Array.from({ length: 3 }, () => report(0, sure(0)));
    const r = trackRecord([...old, none, ...now]);
    expect(r.n).toBe(3);
    expect(r.otherScale).toBe(5);
  });

  it("never uses deleted reports or reports without a prediction", () => {
    const r = trackRecord([report(0, sure(0)), report(0, sure(0), { deleted: true }), { ...report(0, sure(0)), comfort: undefined } as Report]);
    expect(r.n).toBe(1);
  });
});

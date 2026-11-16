// TY-01 (#220, shared/typhoon.ts): reading the best track and setting it against a station.

import { describe, expect, it } from "vitest";
import { destination, distanceBearing, hourly, inside, parseBestTrack, radiusToward, typhoonDays } from "../../shared/typhoon";

/** A line at its columns (1-indexed, inclusive), as the format sets them. */
function at(fields: [number, string][]) {
  const a = Array(80).fill(" ");
  for (const [c, s] of fields) for (let i = 0; i < s.length; i++) a[c - 1 + i] = s[i];
  return a.join("").trimEnd();
}
const header = (id: string, n: number, name: string) => at([[1, "66666"], [7, id], [13, String(n).padStart(3)], [22, id], [31, name]]);
const data = (time: string, grade: number, lat: number, lon: number, p: number, r50?: [string, number, number], r30?: [string, number, number]) =>
  at([
    [1, time],
    [10, "002"],
    [14, String(grade)],
    [16, String(Math.round(lat * 10)).padStart(3, "0")],
    [20, String(Math.round(lon * 10)).padStart(4, "0")],
    [25, String(p).padStart(4)],
    [34, "080"],
    ...(r50 ? ([[42, r50[0]], [43, String(r50[1]).padStart(4, "0")], [48, String(r50[2]).padStart(4, "0")]] as [number, string][]) : []),
    ...(r30 ? ([[53, r30[0]], [54, String(r30[1]).padStart(4, "0")], [59, String(r30[2]).padStart(4, "0")]] as [number, string][]) : []),
  ]);

const KOCHI = { lat: 33 + 33.8 / 60, lon: 133 + 33.1 / 60 };
// A made-up typhoon passing just west of Kochi, south to north, on 2024-08-30 (UTC).
const text = [
  header("2410", 3, "TESTER"),
  data("24082912", 5, 31.0, 133.0, 960, ["9", 60, 60], ["2", 200, 120]),
  data("24083000", 5, 33.5, 133.2, 965, ["9", 50, 50], ["2", 180, 100]),
  data("24083012", 6, 36.0, 134.0, 985, undefined, ["9", 150, 150]),
].join("\n");

describe("the best track", () => {
  it("reads a storm's number, name and its analyses at their columns", () => {
    const [s] = parseBestTrack(text);
    expect(s).toMatchObject({ id: "2410", year: 2024, number: 10, name: "TESTER" });
    expect(s.points).toHaveLength(3);
    expect(s.points[1]).toMatchObject({ grade: 5, lat: 33.5, lon: 133.2, pressure: 965 });
    expect(s.points[1].r50).toEqual({ long: 50 * 1.852, short: 50 * 1.852, dir: null });
    expect(s.points[0].r30).toEqual({ long: 200 * 1.852, short: 120 * 1.852, dir: 90 });
    expect(s.points[2].r50).toBeNull();
  });

  it("fills the hours between analyses", () => {
    const [s] = parseBestTrack(text);
    const h = hourly(s.points);
    expect(h).toHaveLength(25);
    expect(h[6].lat).toBeCloseTo(32.25, 5);
  });

  it("measures distance and bearing on the sphere", () => {
    const { km, bearing } = distanceBearing(33, 133, 34, 133);
    expect(km).toBeCloseTo(111.2, 0);
    expect(bearing).toBeCloseTo(0, 5);
  });

  it("sets the radius toward the station between its shortest and longest", () => {
    const r = { long: 200, short: 100, dir: 90 };
    expect(radiusToward(r, 90, "ellipse")).toBeCloseTo(200);
    expect(radiusToward(r, 270, "ellipse")).toBeCloseTo(100);
    expect(radiusToward(r, 0, "ellipse")).toBeCloseTo(150);
    expect(radiusToward(r, 270, "circle")).toBe(200);
  });

  it("draws JMA's moved circle: the diameter the longest plus the shortest, moved toward the longest", () => {
    const r = { long: 300, short: 100, dir: 90 }; // longest to the east
    const east = destination(33, 133, 90, 290);
    const west = destination(33, 133, 270, 110);
    const north = destination(33, 133, 0, 190);
    expect(inside(r, 33, 133, east.lat, east.lon, "offset")).toBe(true);
    expect(inside(r, 33, 133, west.lat, west.lon, "offset")).toBe(false);
    // To the side: √(300·100) ≈ 173 km reach, less than the ellipse's 200 km.
    expect(inside(r, 33, 133, north.lat, north.lon, "offset")).toBe(false);
    expect(inside(r, 33, 133, north.lat, north.lon, "ellipse")).toBe(true);
    // All round: a plain circle of the radius.
    expect(inside({ long: 200, short: 200, dir: null }, 33, 133, north.lat, north.lon, "offset")).toBe(true);
  });

  it("finds the days (日本時間) inside the 強風域 and 暴風域, and not after it turned extratropical", () => {
    const [s] = parseBestTrack(text);
    const days = typhoonDays(s, KOCHI.lat, KOCHI.lon);
    expect(days.map((d) => d.date)).toEqual(["2024-08-29", "2024-08-30"]);
    const d30 = days.find((d) => d.date === "2024-08-30")!;
    expect(d30.gale && d30.violent).toBe(true);
    expect(d30.nearestKm).toBeLessThan(40);
    expect(d30.storm.number).toBe(10);
  });
});

describe("the compact copy the app reads", () => {
  it("keeps what the days need, and gives the same days back", async () => {
    const { compactTracks, expandTracks, typhoonDaysAt } = await import("../../shared/typhoon");
    const storms = parseBestTrack(text);
    const c = compactTracks(storms, "2026-11-16T00:00:00Z");
    expect(c.v).toBe(1);
    expect(c.storms[0]).toMatchObject({ y: 2024, n: 10, name: "TESTER" });
    const back = expandTracks(JSON.parse(JSON.stringify(c)));
    const a = typhoonDays(storms[0], KOCHI.lat, KOCHI.lon).map((d) => [d.date, d.gale, d.violent]);
    const b = typhoonDays(back[0], KOCHI.lat, KOCHI.lon).map((d) => [d.date, d.gale, d.violent]);
    expect(b).toEqual(a);
    const m = typhoonDaysAt(back, KOCHI.lat, KOCHI.lon, "2024-08-30", "2024-08-31");
    expect([...m.keys()]).toEqual(["2024-08-30"]);
    expect(m.get("2024-08-30")!.storm.number).toBe(10);
  });

  it("leaves out storms that never came near Japan", async () => {
    const { compactTracks } = await import("../../shared/typhoon");
    const far = parseBestTrack([header("2401", 2, "FAR"), data("24010100", 5, 10.0, 170.0, 990), data("24010106", 5, 11.0, 169.0, 990)].join("\n"));
    expect(compactTracks(far, "x").storms).toHaveLength(0);
  });
});

// TY-01 (#220, research/typhoon/track.ts): reading the best track and setting it against a station.

import { describe, expect, it } from "vitest";
import { distanceBearing, hourly, parseBestTrack, radiusToward, typhoonDays } from "../../research/typhoon/track";

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

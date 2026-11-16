// 台風の詳細 (#220): what the typhoon sheet draws and says (shared/typhoonMap.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandTracks } from "../shared/typhoon";
import {
  type Announcement,
  announcementLines,
  coastPath,
  keyHours,
  projection,
  stormHours,
  warningHours,
} from "../shared/typhoonMap";

const KOCHI = { lat: 33.5667, lon: 133.5483 };
const tracks = expandTracks(
  JSON.parse(
    readFileSync(
      new URL("../public/data/typhoon-tracks.json", import.meta.url),
      "utf8",
    ),
  ),
);
const jebi = tracks.find((s) => s.year === 2018 && s.number === 21)!;
const H = 3_600_000;

describe("the map", () => {
  it("is km around the station, north up", () => {
    const p = projection(KOCHI.lat, KOCHI.lon);
    expect(p(KOCHI.lat, KOCHI.lon)).toEqual([0, -0]);
    const [x, y] = p(KOCHI.lat + 1, KOCHI.lon + 1);
    expect(y).toBeCloseTo(-111.2, 1);
    expect(x).toBeCloseTo(92.7, 0);
  });
  it("draws only the coast that reaches into the view", () => {
    const coast = JSON.parse(
      readFileSync(
        new URL("../public/data/coast-japan.json", import.meta.url),
        "utf8",
      ),
    );
    const p = projection(KOCHI.lat, KOCHI.lon);
    const near = coastPath(coast, p, { x: -300, y: -300, w: 600, h: 600 });
    const all = coastPath(coast, p, { x: -5000, y: -5000, w: 10000, h: 10000 });
    expect(near.length).toBeGreaterThan(1000);
    expect(near.length).toBeLessThan(all.length);
  });
});

describe("the station's hours (2018年21号 at 高知, the best track)", () => {
  const hours = stormHours(jebi, KOCHI.lat, KOCHI.lon);
  it("finds it inside the 暴風域 on 9/4 late morning, as the month review does", () => {
    const storm = hours
      .filter((h) => h.level === 2)
      .map((h) => new Date(h.t + 9 * H).toISOString().slice(0, 13));
    expect(storm.length).toBeGreaterThan(0);
    expect(storm.every((s) => s.startsWith("2018-09-04T1"))).toBe(true);
  });
  it("offers the hours worth a look, in order: the day before, into the 強風域, into the 暴風域, out", () => {
    const k = keyHours(hours).map((x) => x.why);
    expect(k).toEqual(
      expect.arrayContaining([
        "前日",
        "強風域に入った",
        "暴風域に入った",
        "域を出た",
      ]),
    );
    const ts = keyHours(hours).map((x) => x.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

const circle = (lat: number, lon: number, km: number) => ({
  lat,
  lon,
  radius: { long: km, short: km, dir: null },
});
const ann = (
  issuedAt: string,
  w: [string, number, number, number][],
  gale: number | null = null,
): Announcement => ({
  issuedAt,
  times: [
    {
      part: "実況",
      validAt: issuedAt,
      hours: 0,
      lat: 28,
      lon: 135,
      storm: null,
      gale: gale ? circle(28, 135, gale) : null,
      warning: null,
      probability: null,
    },
    ...w.map(([validAt, lat, lon, km], i) => ({
      part: `予報　${(i + 1) * 12}時間後`,
      validAt,
      hours: (i + 1) * 12,
      lat,
      lon,
      storm: null,
      gale: null,
      warning: circle(lat, lon, km),
      probability: circle(lat, lon, km / 2),
    })),
  ],
});

describe("the announcements at the station", () => {
  it("reads the hours JMA's 暴風警戒域 held it, the band between two circles included", () => {
    // Two circles that each miss 高知, the band between them over it.
    const a = ann("2026-09-20T09:00:00+09:00", [
      ["2026-09-20T21:00:00+09:00", 33.5, 131.0, 150],
      ["2026-09-21T09:00:00+09:00", 33.5, 136.0, 150],
    ]);
    const h = warningHours(a, KOCHI.lat, KOCHI.lon);
    expect(h.length).toBeGreaterThan(0);
    expect(h[0]).toBeGreaterThan(Date.parse("2026-09-20T21:00:00+09:00"));
    expect(h[h.length - 1]).toBeLessThan(
      Date.parse("2026-09-21T09:00:00+09:00"),
    );
  });
  it("keeps a line only when the word for the station changes (and the latest)", () => {
    const far: [string, number, number, number][] = [
      ["2026-09-21T09:00:00+09:00", 25, 125, 100],
    ];
    const over: [string, number, number, number][] = [
      ["2026-09-21T09:00:00+09:00", 33.5, 133.5, 150],
    ];
    const lines = announcementLines(
      [
        ann("2026-09-20T03:00:00+09:00", far),
        ann("2026-09-20T06:00:00+09:00", far),
        ann("2026-09-20T09:00:00+09:00", over),
        ann("2026-09-20T12:00:00+09:00", over),
        ann("2026-09-20T15:00:00+09:00", over),
      ],
      KOCHI.lat,
      KOCHI.lon,
    );
    expect(lines.map((l) => l.a.issuedAt.slice(11, 13))).toEqual([
      "03",
      "09",
      "15",
    ]);
    expect(lines[0].hours).toEqual([]);
    expect(lines[1].hours).toEqual([Date.parse("2026-09-21T09:00:00+09:00")]);
  });
});

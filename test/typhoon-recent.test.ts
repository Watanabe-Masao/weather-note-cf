// 当時の発表で埋める (#220): the typhoons of the kept telegrams read like the best track
// (shared/typhoonRecent.ts), the days they cover, and the server's side (worker/src/typhoonRecent.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  destination,
  expandTracks,
  inside,
  type Storm,
} from "../shared/typhoon";
import {
  knownOn,
  radiusAroundCentre,
  stormsOfTelegrams,
  typhoonRecord,
  unknownStretches,
} from "../shared/typhoonRecent";
import { parseTyphoonXml } from "../shared/typhoonXml";
import { collectTyphoons } from "../worker/src/typhoonArchive";
import { recentCoverage, recentTracks } from "../worker/src/typhoonRecent";
import { d1 } from "./d1";

const XML = readFileSync(
  new URL("./fixtures/vptw60-synthetic.xml", import.meta.url),
  "utf8",
);

describe("a telegram's area around the centre", () => {
  it("draws back JMA's circle exactly, when its point is off the centre", () => {
    const centre = { lat: 30, lon: 133 };
    const base = { lat: 30.2, lon: 133.1 };
    const r = radiusAroundCentre(
      { ...base, radius: { long: 463, short: 463, dir: null } },
      centre.lat,
      centre.lon,
    )!;
    // Points just inside and just outside JMA's circle, all round.
    for (let b = 0; b < 360; b += 15) {
      const inner = destination(base.lat, base.lon, b, 455);
      const outer = destination(base.lat, base.lon, b, 471);
      expect(
        inside(r, centre.lat, centre.lon, inner.lat, inner.lon, "offset"),
      ).toBe(true);
      expect(
        inside(r, centre.lat, centre.lon, outer.lat, outer.lon, "offset"),
      ).toBe(false);
    }
  });
  it("keeps a circle on the centre all round, and a leaning one as JMA draws it", () => {
    expect(
      radiusAroundCentre(
        { lat: 30, lon: 133, radius: { long: 200, short: 200, dir: null } },
        30,
        133,
      ),
    ).toEqual({ long: 200, short: 200, dir: null });
    const r = radiusAroundCentre(
      { lat: 30, lon: 133, radius: { long: 185, short: 111, dir: 90 } },
      30,
      133,
    )!;
    expect(r.long).toBeCloseTo(185, 0);
    expect(r.short).toBeCloseTo(111, 0);
    expect(r.dir).toBe(90);
  });
});

describe("the storms of the telegrams", () => {
  const t = parseTyphoonXml(XML);
  it("takes the analyses only (not the forecasts), as the best track's points", () => {
    const [s] = stormsOfTelegrams([t]);
    expect(s).toMatchObject({ y: 2026, n: 25, name: "TESTER" });
    expect(s.p).toHaveLength(1);
    const [storm] = expandTracks({ v: 1, source: "", built: "", storms: [s] });
    expect(storm.points[0]).toMatchObject({
      t: Date.parse("2026-09-20T00:00:00Z"),
      grade: 5,
      lat: 30,
      lon: 133,
      pressure: 950,
    });
    expect(storm.points[0].r50!.dir).toBe(90);
  });
  it("lets a later telegram for the same time win (a correction)", () => {
    const later = {
      ...t,
      issuedAt: "2026-09-20T10:00:00+09:00",
      times: [{ ...t.times[0], pressure: 945 }],
    };
    expect(stormsOfTelegrams([later, t])[0].p[0][4]).toBe(945);
  });
});

const best: Storm[] = [
  {
    id: "2617",
    year: 2026,
    number: 17,
    name: "X",
    points: [
      {
        t: Date.parse("2026-08-24T00:00:00Z"),
        grade: 5,
        lat: 30,
        lon: 133,
        pressure: 980,
        wind: null,
        r30: null,
        r50: null,
        landfall: false,
      },
    ],
  },
];

describe("what is known", () => {
  it("is the best track to its last day, and the telegrams' days after; the gap between is not known", () => {
    const r = typhoonRecord(best, {
      v: 1,
      source: "",
      from: "2026-11-09",
      to: "2026-11-15",
      storms: [],
    });
    expect(knownOn(r, "2026-08-24")).toBe(true);
    expect(knownOn(r, "2026-09-20")).toBe(false);
    expect(knownOn(r, "2026-11-10")).toBe(true);
    expect(knownOn(r, "2026-11-16")).toBe(false);
    expect(unknownStretches(r, "2026-08-01", "2026-11-20")).toEqual([
      { from: "2026-08-25", to: "2026-11-08" },
      { from: "2026-11-16", to: "2026-11-20" },
    ]);
    expect(unknownStretches(r, "2026-11-09", "2026-11-15")).toEqual([]);
  });
  it("takes a typhoon from the best track once it has it", () => {
    const s = stormsOfTelegrams([
      parseTyphoonXml(
        XML.replace("<Number>2625</Number>", "<Number>2617</Number>"),
      ),
    ]);
    expect(
      typhoonRecord(best, {
        v: 1,
        source: "",
        from: "2026-08-20",
        to: "2026-11-15",
        storms: s,
      }).storms,
    ).toHaveLength(1);
    // ... and the telegrams take over only from the day after the best track's last.
    expect(
      typhoonRecord(best, {
        v: 1,
        source: "",
        from: "2026-08-20",
        to: "2026-11-15",
        storms: s,
      }).ranges[1].from,
    ).toBe("2026-08-25");
  });
  it("is the best track alone when the telegrams could not be read", () => {
    expect(typhoonRecord(best, null).ranges).toEqual([
      { from: "0000-01-01", to: "2026-08-24", source: "best" },
    ]);
  });
});

describe("the server's side", () => {
  const feed = (u: string) =>
    `<feed><entry><title>台風解析・予報情報（５日予報）</title><updated>x</updated><link href="${u}"/></entry></feed>`;
  const U =
    "https://www.data.jma.go.jp/developer/xml/data/20260920004500_0_VPTW60_010000.xml";
  const get =
    (ok = true) =>
    async (url: string) =>
      ok
        ? {
            ok: true,
            status: 200,
            text: async () => (/feed\//.test(url) ? feed(U) : XML),
          }
        : { ok: false, status: 503, text: async () => "" };

  it("covers from 7 days before the first run that read to the day before the last", async () => {
    const db = d1();
    expect(await recentCoverage(db)).toBeNull();
    await collectTyphoons(db, Date.parse("2026-09-20T01:00:00Z"), get());
    await collectTyphoons(db, Date.parse("2026-09-25T01:00:00Z"), get());
    expect(await recentCoverage(db)).toEqual({
      from: "2026-09-14",
      to: "2026-09-24",
    });
    const r = await recentTracks(db, "2026-09-01");
    expect(r).toMatchObject({ from: "2026-09-14", to: "2026-09-24" });
    expect(r.storms.map((s) => s.n)).toEqual([25]);
    // Asked from later than what is kept: from that day.
    expect((await recentTracks(db, "2026-09-20")).from).toBe("2026-09-20");
  });

  it("starts again after a stop longer than the long feed reaches", async () => {
    const db = d1();
    await collectTyphoons(db, Date.parse("2026-09-01T01:00:00Z"), get());
    await recentCoverage(db); // its tables
    db.raw
      .prepare(
        "INSERT INTO typhoon_alerts (key, kind, opened_at, closed_at, detail) VALUES ('collector@x', 'collector', '2026-09-02T00:00:00.000Z', '2026-09-12T00:00:00.000Z', '')",
      )
      .run();
    await collectTyphoons(db, Date.parse("2026-09-12T00:00:00Z"), get());
    expect((await recentCoverage(db))!.from).toBe("2026-09-06");
  });
});

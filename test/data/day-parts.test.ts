// The parts of a day by the sun's altitude (shared/dayParts.ts), and the solar maths under them:
// right (against 国立天文台's table for Kochi) and consistent (against SunCalc, an independent
// implementation, test-only). Agreement with SunCalc alone would not show accuracy: SunCalc itself
// runs about 1.3 minutes late against 国立天文台 (research/sun/verify-results.md).

import { readFileSync } from "node:fs";
import SunCalc from "suncalc";
import { describe, expect, it } from "vitest";
import { bandAt, dayEdges, dayParts, hoursIn, partAt } from "../../shared/dayParts";
import { altitudeCrossing, solarAltitude, solarTimes, stationLatLon } from "../../shared/sunTimes";

const KOCHI = "47893";
const hm = (s: string) => +s.split(":")[0] * 60 + +s.split(":")[1];
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("parts of the day by the sun's altitude", () => {
  it("gives the times decided on (Kochi, winter and summer solstice; within 2 minutes)", () => {
    const dec = dayParts("2026-12-22", KOCHI).map((p) => p.from);
    ["06:39", "08:49", "12:04", "15:20", "17:30"].forEach((t, i) => near(dec[i], hm(t), 2));
    const jun = dayParts("2026-06-21", KOCHI).map((p) => p.from);
    ["04:27", "08:22", "12:07", "15:54", "19:48"].forEach((t, i) => near(jun[i], hm(t), 2));
  });

  it("keeps 日中 and 昼 about 3.5 hours all year; 朝 and 夕方 grow in summer", () => {
    for (const d of ["2026-12-22", "2026-03-20", "2026-06-21", "2026-09-23"]) {
      const [m, f, n, e] = dayParts(d, KOCHI);
      near(f.to - f.from, 210, 20);
      near(n.to - n.from, 210, 20);
      near(m.to - m.from, e.to - e.from, 10); // symmetric about noon
    }
    const len = (d: string) => dayParts(d, KOCHI)[0].to - dayParts(d, KOCHI)[0].from;
    expect(len("2026-06-21")).toBeGreaterThan(len("2026-12-22") + 90);
  });

  it("splits at half the day's own highest altitude, at dawn and dusk 6° below", () => {
    const e = dayEdges("2026-03-20", KOCHI);
    const { lat, lon } = stationLatLon(KOCHI)!;
    near(solarAltitude("2026-03-20", e.halfUp, lat, lon), e.noonAltitude / 2, 0.05);
    near(solarAltitude("2026-03-20", e.dusk, lat, lon), -6, 0.05);
    near(e.noonAltitude, 56, 1);
    expect(e.dawn < e.rise && e.rise < e.halfUp && e.halfUp < e.noon && e.noon < e.halfDown && e.halfDown < e.set && e.set < e.dusk).toBe(true);
  });

  it("gives every band hours to average, anywhere in Japan, every day", () => {
    for (const st of ["47401", "47893", "47936", "47971"]) // 稚内, 高知, 那覇, 父島
      for (let d = 0; d < 365; d += 7) {
        const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
        for (const p of dayParts(date, st)) expect(hoursIn(p).length, `${st} ${date} ${p.label}`).toBeGreaterThanOrEqual(1);
      }
  });

  it("keeps the edges in order where the sun never rises or never sets (not in Japan; no crash)", () => {
    for (const lat of [66.5, 70, 78])
      for (const date of ["2026-06-21", "2026-12-21"]) {
        const e = dayEdges(date, { lat, lon: 135 });
        const seq = [e.dawn, e.rise, e.halfUp, e.noon, e.halfDown, e.set, e.dusk];
        expect(seq.every((v, i) => Number.isFinite(v) && (i === 0 || v >= seq[i - 1])), `${lat} ${date}`).toBe(true);
      }
  });

  it("tells moments apart: the dark is 夜, a band of values is three hours after dusk", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(partAt(at("2026-06-21T18:30:00+09:00"), KOCHI)).toBe("evening"); // the clock said 夜
    expect(partAt(at("2026-12-22T17:45:00+09:00"), KOCHI)).toBe("night"); // the clock said 夕方
    expect(partAt(at("2026-12-22T03:00:00+09:00"), KOCHI)).toBe("night");
    expect(bandAt(at("2026-12-22T19:00:00+09:00"), KOCHI)?.label).toBe("夜");
    expect(bandAt(at("2026-12-22T22:00:00+09:00"), KOCHI)).toBeNull();
  });
});

const naoj = JSON.parse(readFileSync(new URL("../../research/sun/naoj-kochi-2026.json", import.meta.url), "utf8")) as {
  lat: number;
  lon: number;
  days: { date: string; rise: string; transit: string; altitude: number; set: string }[];
};

describe("the solar maths against 国立天文台 (Kochi, March, June and October 2026)", () => {
  // The table is rounded to the minute and to 0.1°: rounding alone allows 0.5 minutes.
  it("gives sunrise, sunset and noon within 0.75 minutes and the noon altitude within 0.1°", () => {
    for (const d of naoj.days) {
      const t = solarTimes(d.date, naoj.lat, naoj.lon);
      near(t.rise, hm(d.rise), 0.75);
      near(t.set, hm(d.set), 0.75);
      const noon = dayEdges(d.date, { lat: naoj.lat, lon: naoj.lon }).noon;
      near(noon, hm(d.transit), 0.75);
      near(solarAltitude(d.date, noon, naoj.lat, naoj.lon), d.altitude, 0.1);
    }
  });

  it("says day or night like the table every minute around sunrise and sunset (±5 min), but within the rounding", () => {
    const { lat, lon } = naoj;
    let checked = 0;
    for (const d of naoj.days)
      for (const edge of [hm(d.rise), hm(d.set)])
        for (let m = edge - 5; m <= edge + 5; m++) {
          const ours = solarAltitude(d.date, m, lat, lon) < -0.833; // night by this calculation
          const table = m < hm(d.rise) || m >= hm(d.set); // night by the table
          if (Math.abs(m - edge) >= 1) expect(ours, `${d.date} ${m}`).toBe(table);
          checked++;
        }
    expect(checked).toBe(naoj.days.length * 2 * 11);
  });
});

describe("the solar maths against SunCalc", () => {
  // SunCalc runs about 1.3 minutes late against 国立天文台 everywhere (its own offset), so the
  // tolerances hold that offset plus the spread.
  it("agrees on sunrise and sunset (3.5 min), dawn and dusk (3.5 min) and the altitude (0.5°), on ordinary and edge dates", () => {
    const dates = [
      ...Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i * 15)).toISOString().slice(0, 10)),
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
      "2026-12-31",
      "2027-01-01",
    ];
    for (const st of ["47401", "47662", KOCHI, "47936"]) {
      const { lat, lon } = stationLatLon(st)!;
      for (const date of dates) {
        const t = SunCalc.getTimes(new Date(`${date}T12:00:00+09:00`), lat, lon);
        const min = (x: Date) => (x.getTime() - Date.parse(`${date}T00:00:00+09:00`)) / 60_000;
        const ours = solarTimes(date, lat, lon);
        near(ours.rise, min(t.sunrise), 3.5);
        near(ours.set, min(t.sunset), 3.5);
        near(altitudeCrossing(date, -6, true, lat, lon)!, min(t.dawn), 3.5);
        near(altitudeCrossing(date, -6, false, lat, lon)!, min(t.dusk), 3.5);
        for (const m of [420, 720, 1020]) {
          const p = SunCalc.getPosition(new Date(Date.parse(`${date}T00:00:00+09:00`) + m * 60_000), lat, lon);
          near(solarAltitude(date, m, lat, lon), (p.altitude * 180) / Math.PI, 0.5);
        }
      }
    }
  });
});

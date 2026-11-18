// 太陽の方位（shared/sunTimes.ts solarAzimuth）を Astronomy Engine と照らし合わせる（3D天球の土台、2026-11-18）。
import { AstroTime, Body, Equator, Horizon, Observer } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import { solarAltitude, solarAzimuth } from "../../shared/sunTimes";

const LAT = 33.55;
const LON = 133.5333;
describe("太陽の方位と高さ（高知、季節と時刻を散らして）", () => {
  for (const date of ["2026-03-20", "2026-06-21", "2026-09-23", "2026-11-18", "2026-12-22"]) {
    it(date, () => {
      const obs = new Observer(LAT, LON, 0);
      for (let m = 300; m <= 1140; m += 60) {
        const t = new AstroTime(new Date(Date.parse(`${date}T00:00:00+09:00`) + m * 60_000));
        const eq = Equator(Body.Sun, t, obs, true, true);
        const h = Horizon(t, obs, eq.ra, eq.dec);
        if (h.altitude < 2) continue;
        const d = Math.abs(((solarAzimuth(date, m, LAT, LON) - h.azimuth + 540) % 360) - 180);
        expect(d).toBeLessThanOrEqual(0.3);
        expect(Math.abs(solarAltitude(date, m, LAT, LON) - h.altitude)).toBeLessThanOrEqual(0.3);
      }
    });
  }
});

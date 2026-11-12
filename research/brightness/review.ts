// The numbers behind research/brightness/model-review.md.
// Run:  research/data/node_modules/.bin/vite-node research/brightness/review.ts   (prints the tables)

import { CLOUD, clearSkyLux, twilightLux, usnoSunLux } from "../../shared/brightness";
import { solarAltitude, stationLatLon } from "../../shared/sunTimes";

/** The IES formula used before this review (direct + diffuse, clear sky). */
const iesLux = (deg: number) => {
  if (deg <= 0) return twilightLux(deg);
  const s = Math.sin((deg * Math.PI) / 180);
  return Math.max(700, 127_500 * Math.exp(-0.21 / Math.max(s, 0.01)) * s + 800 + 15_500 * Math.sqrt(s));
};

{
  const rows = [60, 30, 10, 5, 3, 2, 1, 0.5, 0, -0.5, -1, -2, -3, -4, -5, -6].map(
    (d) => `| ${d}° | ${Math.round(iesLux(d)).toLocaleString()} | ${Math.round(usnoSunLux(d)).toLocaleString()} | ${d <= 0 ? twilightLux(d).toFixed(1) : "—"} | ${Math.round(clearSkyLux(d)).toLocaleString()} |`,
  );
  // Kochi, 12 November: when it stops being 明るい (1,000 lx) and when it gets 薄暗い→薄明 (100 lx), by clouds.
  const k = stationLatLon("47893")!;
  const cross = (lux: number, f: number, model: (d: number) => number) => {
    for (let m = 16 * 60; m < 19 * 60; m += 0.25) if (model(solarAltitude("2026-11-12", m, k.lat, k.lon)) * f < lux) return m;
    return NaN;
  };
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;
  const old = { 晴: 1, 曇: 0.35, 雨: 0.2 } as Record<string, number>;
  const now = { 晴: CLOUD.clear, 曇: CLOUD.cloudy, 雨: CLOUD.rain } as Record<string, number>;
  const dusk = ["晴", "曇", "雨"].map(
    (w) => `| ${w} | ${hm(cross(1000, old[w], iesLux))} → ${hm(cross(1000, now[w], clearSkyLux))} | ${hm(cross(100, old[w], iesLux))} → ${hm(cross(100, now[w], clearSkyLux))} |`,
  );
  console.log(["| 太陽の高さ | IES（前） | USNO | 薄明の表 | 新しい晴天 |", ...rows, "", "| 天気 | 明るいが終わる（1,000lx） | 薄明になる（100lx） |", ...dusk].join("\n"));
}

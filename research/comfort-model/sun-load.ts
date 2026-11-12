// #96: how the candidate 日なた (feel-2: the direct sun on a standing person, shared/sunLoad.ts)
// differs from the one in use (feel-1: k × global radiation on level ground), Kochi, through the year.
// Run:  research/data/node_modules/.bin/vite-node research/comfort-model/sun-load.ts   (writes sun-load-results.md)

import { writeFileSync } from "node:fs";
import { BODY_ABSORPTIVITY, BODY_EFFECTIVE, GROUND_ALBEDO, clearDni, directOnBody, directWarming, feel2Warming, projectedArea } from "../../shared/sunLoad";
import { DEFAULT_FEEL, sunWarming } from "../../shared/feel";
import { solarAltitude, stationLatLon } from "../../shared/sunTimes";

const K = "47893";
const c = stationLatLon(K)!;
const WIND = 3; // m/s at 10 m
/** Clear-sky global radiation on level ground (Haurwitz), for feel-1 on a clear hour. */
const haurwitz = (alt: number) => {
  const s = Math.sin((alt * Math.PI) / 180);
  return s > 0 ? 1098 * s * Math.exp(-0.057 / s) : 0;
};
const r1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const lines: string[] = ["# 日なたの上乗せ：feel-1（今）と feel-2 案C（候補、#96・D18）", "", "高知、晴れ（その時間の日照すべて）、風 3 m/s（10m）。上乗せ（℃）＝ 日なた温度 − 日かげ温度。", ""];

// 1. By the sun's altitude.
lines.push("## 1. 太陽の高さごと（晴れ）", "", "| 太陽の高さ | 地面の日射（W/㎡） | 体に当たる日差し 案C（W/㎡） | feel-1 | 案A（直射だけ） | 案C（候補） |", "|---|---|---|---|---|---|");
for (const alt of [5, 10, 20, 30, 36, 45, 60, 79]) {
  const ghi = haurwitz(alt);
  const beam = clearDni(alt);
  const body = projectedArea(alt) * beam;
  const c = BODY_EFFECTIVE * body + 0.5 * BODY_EFFECTIVE * GROUND_ALBEDO * beam * Math.sin((alt * Math.PI) / 180);
  lines.push(`| ${alt}° | ${Math.round(ghi)} | ${Math.round(c)} | ${r1(sunWarming(ghi, WIND, DEFAULT_FEEL.absorb))} | ${r1(directWarming(body, WIND))} | ${r1(directWarming(c, WIND))} |`);
}

// 2. Through the year, at hours of the day (clear).
const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const hours = [8, 10, 12, 14, 16, 17]; // JMA hour n = the hour ending at n o'clock
lines.push("", "## 2. 一年を通して（晴れ、各月15日、時刻はその時間の終わり）", "", `| 月 | ${hours.map((h) => `${h}時 feel-1 / 案C`).join(" | ")} |`, `|---|${hours.map(() => "---").join("|")}|`);
for (const mo of months) {
  const date = `2026-${mo}-15`;
  const cells = hours.map((n) => {
    // feel-1: the hour's mean global radiation (5-minute steps), k × it.
    let g = 0;
    for (let m = (n - 1) * 60 + 2.5; m < n * 60; m += 5) g += haurwitz(solarAltitude(date, m, c.lat, c.lon)) / 12;
    return `${r1(sunWarming(g, WIND, DEFAULT_FEEL.absorb))} / ${r1(feel2Warming(date, n, K, 1, WIND)!)}`;
  });
  lines.push(`| ${+mo}月 | ${cells.join(" | ")} |`);
}

// 3. Clouds and night.
const noonC = feel2Warming("2026-11-15", 13, K, 1, WIND)!;
lines.push(
  "",
  "## 3. 曇り・日照の一部・夜（11月15日 12〜13時）",
  "",
  "| その時間 | feel-1（地面の日射から） | 案C |",
  "|---|---|---|",
  `| 晴れ（日照 1時間） | ${r1(sunWarming(haurwitz(37), WIND, DEFAULT_FEEL.absorb))} | ${r1(noonC)} |`,
  `| 晴れ間（日照 0.5時間） | 日射しだい | ${r1(feel2Warming("2026-11-15", 13, K, 0.5, WIND)!)} |`,
  `| 曇り（日照 0、日射は晴れの約3割） | ${r1(sunWarming(haurwitz(37) * 0.3, WIND, DEFAULT_FEEL.absorb))} | ${r1(feel2Warming("2026-11-15", 13, K, 0, WIND)!)} |`,
  `| 夜（日没後） | 0.0 | ${r1(feel2Warming("2026-11-15", 20, K, 0, WIND)!)} |`,
  "",
  `案C：吸収率 ${BODY_ABSORPTIVITY}（ASHRAE 55 の肌と服の標準）、体の表面の割合 ${BODY_EFFECTIVE}、地面の反射率 ${GROUND_ALBEDO}、日差しの係数 β = 1（みんな共通）。feel-1 の k は設定の「日差しの強さ」（標準 ${DEFAULT_FEEL.absorb}、地面の日射に掛ける）。`,
);
const out = new URL("./sun-load-results.md", import.meta.url);
writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.join("\n"));

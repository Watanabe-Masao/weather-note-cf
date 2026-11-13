// Kochi 2025, hour by hour: the measured global radiation against what the app's models say, through
// the app's own functions (the rule: research goes through production code).
//   H-02 (#132): the light's cloud factor — the share of the clear sky's light that gets through with
//     no sunshine (CLOUD.cloudy = 1/3) and under rain (rainFactor). Judged by the yardstick of
//     2026-11-14: does a cloudy noon fall in the level it should (明るい), not "is 1/3 exact".
//   #103: global radiation estimated from sunshine and rain (shared/mrt.ts hourRadiation), the same
//     for records and forecasts, against the measured — and what the difference does to 日なた.
// Run: research/data/node_modules/.bin/vite-node research/radiation/analyze.ts

import { readFileSync, writeFileSync } from "node:fs";
import { brightnessIndex, brightnessLevel, CLOUD, clearSkyLux, cloudFactor, RAIN_MM, rainFactor, sunshineFraction } from "../../shared/brightness";
import { MJ_PER_HOUR_TO_W, sunWarming } from "../../shared/feel";
import { hourRadiation } from "../../shared/mrt";
import { solarAltitude, stationLatLon } from "../../shared/sunTimes";
import type { WeatherRow } from "../../shared/types";

const YEAR = 2025;
const STATION = "47893";
const data = JSON.parse(readFileSync(new URL(`./kochi-${YEAR}.json`, import.meta.url), "utf8")) as { rows: { date: string; n: number; sun: number | null; radiation: number | null; rain: number | null }[] };
const ll = stationLatLon(STATION)!;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface H {
  date: string;
  n: number;
  month: number;
  alt: number;
  share: number;
  rain: number;
  measured: number; // W/m², hour mean
  clear: number; // W/m², clear-sky hour mean (Ineichen & Perez, the app's mrt.ts)
  estimate: number; // W/m², from sunshine and rain (mrt.ts hourRadiation)
  factor: number | null; // the light's cloud factor (brightness.ts)
}

const hours: H[] = [];
for (const r of data.rows) {
  const mj = num(r.radiation);
  const sun = num(r.sun);
  if (mj == null || sun == null) continue;
  const up = sunshineFraction(r.date, r.n, STATION);
  const alt = solarAltitude(r.date, r.n * 60 - 30, ll.lat, ll.lon);
  if (alt < 5 || up < 0.5) continue; // daylight hours only, where the sunshine says something
  const rain = num(r.rain) ?? 0;
  const clear = hourRadiation(r.date, r.n, STATION, 1, false)!.ghi;
  const est = hourRadiation(r.date, r.n, STATION, sun, rain >= RAIN_MM)!;
  if (clear < 20) continue;
  const row = { date: r.date, n: r.n, type: "actual", provider: "JMA", sun, rain, raw: {}, quality: {} } as unknown as WeatherRow;
  hours.push({ date: r.date, n: r.n, month: Number(r.date.slice(5, 7)), alt, share: est.share, rain, measured: mj * MJ_PER_HOUR_TO_W, clear, estimate: est.ghi, factor: cloudFactor(row, up) });
}

const q = (vs: number[], p: number) => {
  const a = [...vs].sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i - Math.floor(i));
};
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const f0 = (v: number) => (Number.isFinite(v) ? v.toFixed(0) : "—");
const season = (m: number) => (m <= 2 || m === 12 ? "冬" : m <= 5 ? "春" : m <= 8 ? "夏" : "秋");
const out: string[] = [];
const p = (s = "") => out.push(s);

p(`# 高知 ${YEAR}：実測の日射とアプリのモデル`);
p();
p(`使った時間：太陽高度5°以上・日照を測れる時間（日の出入りの時間を除く） ${hours.length} 時間。晴天の日射はアプリの mrt.ts（Ineichen & Perez 2002）。`);
p();

// ---- H-02 ---------------------------------------------------------------------------------------
p("## H-02 雲の係数（明るさ）");
p();
p("「実測 ÷ 晴天」が、明るさのモデルの雲の係数（日照の割合から）に当たる。日照0・雨なしの時間でモデルは 1/3（0.33）。");
p();
p("| 条件 | 時間数 | 実測÷晴天 中央値 | 25%〜75% | モデルの係数 |");
p("|---|---|---|---|---|");
const groups: [string, (h: H) => boolean, (h: H) => number][] = [
  ["日照なし・雨なし", (h) => h.share < 0.05 && h.rain < RAIN_MM, () => CLOUD.cloudy],
  ["日照なし・雨 0.5〜2mm", (h) => h.share < 0.05 && h.rain >= RAIN_MM && h.rain < 2, (h) => rainFactor(h.rain)],
  ["日照なし・雨 2mm〜", (h) => h.share < 0.05 && h.rain >= 2, (h) => rainFactor(h.rain)],
  ["日照が半分前後", (h) => h.share >= 0.4 && h.share <= 0.6 && h.rain < RAIN_MM, (h) => h.factor ?? NaN],
  ["日照いっぱい", (h) => h.share >= 0.95 && h.rain < RAIN_MM, () => CLOUD.clear],
];
for (const [label, test, model] of groups) {
  const g = hours.filter(test);
  const r = g.map((h) => h.measured / h.clear);
  p(`| ${label} | ${g.length} | ${f2(q(r, 0.5))} | ${f2(q(r, 0.25))}〜${f2(q(r, 0.75))} | ${f2(q(g.map(model), 0.5))} |`);
}
p();
p("季節別（日照なし・雨なし）：");
p();
p("| 季節 | 時間数 | 実測÷晴天 中央値 | 25%〜75% |");
p("|---|---|---|---|");
for (const s of ["冬", "春", "夏", "秋"]) {
  const g = hours.filter((h) => h.share < 0.05 && h.rain < RAIN_MM && season(h.month) === s);
  const r = g.map((h) => h.measured / h.clear);
  p(`| ${s} | ${g.length} | ${f2(q(r, 0.5))} | ${f2(q(r, 0.25))}〜${f2(q(r, 0.75))} |`);
}
p();

// The yardstick: does a cloudy noon land in 明るい (1,000–10,000 lx)? The model's lux against the
// measured-radiation lux (overcast luminous efficacy about 120 lm/W, a common round value).
const EFFICACY = 120;
p("### 典型の場面：曇りの昼は「明るい」の段に入るか");
p();
p(`曇りの昼（日照なし・雨なし、11〜13時）で、モデルの照度（晴天の照度×1/3）と、実測の日射から出した照度（×${EFFICACY} lm/W、曇り空のおおよその発光効率）の段を比べる。`);
p();
p("| 季節 | 時間数 | モデルの段が「明るい」 | 実測からの段が「明るい」 | 段が一致 | モデルの指数 中央値 | 実測からの指数 中央値 |");
p("|---|---|---|---|---|---|---|");
for (const s of ["冬", "春", "夏", "秋", "通年"]) {
  const g = hours.filter((h) => h.share < 0.05 && h.rain < RAIN_MM && h.n >= 12 && h.n <= 13 && (s === "通年" || season(h.month) === s));
  const model = g.map((h) => brightnessIndex(clearSkyLux(h.alt) * CLOUD.cloudy));
  const meas = g.map((h) => brightnessIndex(h.measured * EFFICACY));
  const lv = (i: number) => brightnessLevel(i).label;
  const pct = (xs: boolean[]) => (xs.length ? `${Math.round((100 * xs.filter(Boolean).length) / xs.length)}%` : "—");
  p(`| ${s} | ${g.length} | ${pct(model.map((i) => lv(i) === "明るい"))} | ${pct(meas.map((i) => lv(i) === "明るい"))} | ${pct(model.map((i, k) => lv(i) === lv(meas[k])))} | ${f2(q(model, 0.5))} | ${f2(q(meas, 0.5))} |`);
}
p();

// ---- #103 ---------------------------------------------------------------------------------------
p("## #103 日照と降水からの日射の推定（日なた温度）");
p();
p("推定はアプリの mrt.ts `hourRadiation`（晴天の日射 ×（日照なしの残り 0.3、雨は 0.15 ＋ 日照の割合））。");
p();
p("| 日照の割合 | 時間数 | 実測 中央値 W/m² | 推定 中央値 | 推定−実測 中央値 | 絶対誤差 中央値 |");
p("|---|---|---|---|---|---|");
const bins: [string, (s: number) => boolean][] = [
  ["0", (s) => s < 0.05],
  ["0.05〜0.5", (s) => s >= 0.05 && s < 0.5],
  ["0.5〜0.95", (s) => s >= 0.5 && s < 0.95],
  ["0.95〜1", (s) => s >= 0.95],
];
for (const [label, test] of bins) {
  const g = hours.filter((h) => test(h.share));
  p(`| ${label} | ${g.length} | ${f0(q(g.map((h) => h.measured), 0.5))} | ${f0(q(g.map((h) => h.estimate), 0.5))} | ${f0(q(g.map((h) => h.estimate - h.measured), 0.5))} | ${f0(q(g.map((h) => Math.abs(h.estimate - h.measured)), 0.5))} |`);
}
const all = hours;
const bias = all.reduce((s, h) => s + (h.estimate - h.measured), 0) / all.length;
const mae = all.reduce((s, h) => s + Math.abs(h.estimate - h.measured), 0) / all.length;
const meanMeasured = all.reduce((s, h) => s + h.measured, 0) / all.length;
p();
p(`全体：平均の偏り ${f0(bias)} W/m²、平均絶対誤差 ${f0(mae)} W/m²（実測の平均 ${f0(meanMeasured)} W/m² の ${Math.round((100 * mae) / meanMeasured)}%）。`);
p();
// What it does to 日なた: the sun term with absorptivity 0.7 and a 10 m wind of 3 m/s (Kochi's usual).
const warm = (w: number) => sunWarming(w, 3, 0.7);
const dw = all.map((h) => warm(h.estimate) - warm(h.measured));
p(`日なたの上乗せ（吸収率 0.7・10m の風 3m/s）への影響：推定−実測 の中央値 ${f2(q(dw, 0.5))}℃、絶対値の中央値 ${f2(q(dw.map(Math.abs), 0.5))}℃、90% 点 ${f2(q(dw.map(Math.abs), 0.9))}℃。`);
p();

writeFileSync(new URL("./results.md", import.meta.url), out.join("\n") + "\n");
console.log(out.join("\n"));

// H-02 (#132): how much of the clear sky's light gets through, by the hour's sunshine and rain —
// the app's guess (shared/brightness.ts sunshineFactor: no sunshine 1/3, rain 1/7 and darker with
// more rain) against what the JMA records at the station measured (global radiation ÷ the clear
// sky's for that hour). Also the day's total radiation as the app would estimate it from sunshine
// (shared/mrt.ts hourRadiation, #103) against the measured total.
//
// Run by hand, or by the "research-h02" workflow (manual only): it reads the station's hourly
// tables from JMA the way the app does, one day a second. The records stay out of the repository:
// the workflow keeps the CSV and the report as its artifact.
//
//   npx --yes tsx@4.19.2 research/brightness/h02.ts --station 47893 --from 2025-11-01 --to 2026-10-31 --out out
//
// Validation only: nothing here changes an input of the app (データの原則).

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import stations from "../../shared/stations.json";
import type { Station, WeatherRow } from "../../shared/types";
import { fetchHourlyDay } from "../../worker/src/jma-tables";
import { RAIN_MM, sunshineFactor, sunshineFraction } from "../../shared/brightness";
import { hourRadiation } from "../../shared/mrt";
import { radiationOf } from "../../shared/feel";
import { solarAltitude, stationLatLon } from "../../shared/sunTimes";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const blockNo = arg("station", "47893");
const from = arg("from", "2025-11-01");
const to = arg("to", "2026-10-31");
const out = arg("out", "research/brightness/out");
const station = (stations as Station[]).find((s) => s.blockNo === blockNo);
if (!station) throw new Error(`no station ${blockNo}`);
mkdirSync(join(out, "days"), { recursive: true });

const days: string[] = [];
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function rowsOf(day: string): Promise<WeatherRow[] | null> {
  const f = join(out, "days", `${blockNo}-${day}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  for (let k = 0; k < 3; k++) {
    try {
      const { rows } = await fetchHourlyDay(station!, day);
      writeFileSync(f, JSON.stringify(rows));
      await sleep(1000);
      return rows;
    } catch (e) {
      console.error(day, String(e));
      await sleep(5000);
    }
  }
  return null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ll = stationLatLon(blockNo)!;

interface Hour { date: string; n: number; alt: number; up: number; sun: number; rain: number; measured: number; clear: number; ratio: number; model: number }
const hours: Hour[] = [];
const dayTotals: { date: string; measured: number; estimated: number; sun: number }[] = [];

for (const day of days) {
  const rows = await rowsOf(day);
  if (!rows) continue;
  let m = 0, e = 0, s = 0, ok = true;
  for (const r of rows) {
    const w = radiationOf(r);
    const sun = num(r.sun);
    const rain = num(r.rain) ?? 0;
    const est = hourRadiation(day, r.n, blockNo, sun, rain);
    if (w == null || sun == null || !est) { if (r.n >= 7 && r.n <= 18) ok = false; continue; }
    m += w * 0.0036;
    e += est.ghi * 0.0036;
    s += sun;
    const clear = hourRadiation(day, r.n, blockNo, 1, 0)!.ghi; // every minute that could, sunny
    const up = sunshineFraction(day, r.n, blockNo);
    const alt = solarAltitude(day, (r.n - 0.5) * 60, ll.lat, ll.lon);
    if (clear < 80 || up < 0.25) continue; // a low sun: the ratio says little
    const share = Math.min(1, sun / up);
    hours.push({ date: day, n: r.n, alt, up, sun, rain, measured: w, clear, ratio: w / clear, model: sunshineFactor(share, rain >= RAIN_MM, rain) });
  }
  if (ok) dayTotals.push({ date: day, measured: m, estimated: e, sun: s });
}

// ---- report ------------------------------------------------------------------------------------
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i - Math.floor(i));
};
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const line = (label: string, hs: Hour[]) =>
  `| ${label} | ${hs.length} | ${f2(q(hs.map((h) => h.ratio), 0.25))} | **${f2(q(hs.map((h) => h.ratio), 0.5))}** | ${f2(q(hs.map((h) => h.ratio), 0.75))} | ${f2(q(hs.map((h) => h.model), 0.5))} |`;
const shareOf = (h: Hour) => Math.min(1, h.sun / h.up);
const dry = hours.filter((h) => h.rain < RAIN_MM);
const wet = hours.filter((h) => h.rain >= RAIN_MM);
const head = "| 区分 | 時間 | 25% | 中央 | 75% | アプリの値（中央） |\n|---|---|---|---|---|---|";
const altBins: [string, (h: Hour) => boolean][] = [
  ["太陽 15° 未満", (h) => h.alt < 15],
  ["15〜30°", (h) => h.alt >= 15 && h.alt < 30],
  ["30〜45°", (h) => h.alt >= 30 && h.alt < 45],
  ["45° 以上", (h) => h.alt >= 45],
];
const seasons: [string, number[]][] = [["冬（12〜2月）", [12, 1, 2]], ["春（3〜5月）", [3, 4, 5]], ["夏（6〜8月）", [6, 7, 8]], ["秋（9〜11月）", [9, 10, 11]]];
const month = (h: Hour) => +h.date.slice(5, 7);
const none = dry.filter((h) => h.sun === 0);

const pct = dayTotals.map((d) => (d.estimated - d.measured) / Math.max(1, d.measured));
const report = [
  `# H-02 雲で弱める割合（${station.name} ${blockNo}、${from}〜${to}）`,
  "",
  `毎時の値：実測の全天日射量 ÷ その時間の快晴の日射量（\`clearSky\` の平均）。太陽の低い時間（快晴の日射 80 W/m² 未満、日照を測れる時間が 1/4 未満）は除く。読めた日 ${dayTotals.length} / ${days.length}、時間 ${hours.length}。`,
  "",
  "## 日照の割合で（雨なし）",
  head,
  line("日照 0", none),
  line("0 〜 0.3", dry.filter((h) => shareOf(h) > 0 && shareOf(h) < 0.3)),
  line("0.3 〜 0.7", dry.filter((h) => shareOf(h) >= 0.3 && shareOf(h) < 0.7)),
  line("0.7 〜 1 未満", dry.filter((h) => shareOf(h) >= 0.7 && shareOf(h) < 1)),
  line("日照 1（快晴）", dry.filter((h) => shareOf(h) >= 1)),
  "",
  "## 日照 0・雨なしを、太陽の高さで",
  head,
  ...altBins.map(([l, f]) => line(l, none.filter(f))),
  "",
  "## 日照 0・雨なしを、季節で",
  head,
  ...seasons.map(([l, ms]) => line(l, none.filter((h) => ms.includes(month(h))))),
  "",
  "## 雨（日照 0）を、降水量で",
  head,
  line("0.5〜1 mm", wet.filter((h) => h.sun === 0 && h.rain < 1)),
  line("1〜3 mm", wet.filter((h) => h.sun === 0 && h.rain >= 1 && h.rain < 3)),
  line("3〜10 mm", wet.filter((h) => h.sun === 0 && h.rain >= 3 && h.rain < 10)),
  line("10 mm 以上", wet.filter((h) => h.sun === 0 && h.rain >= 10)),
  "",
  "## 日の合計（#103：日照から出した日射 − 実測）",
  `日数 ${dayTotals.length}。差の割合：25% ${f2(q(pct, 0.25))}・中央 **${f2(q(pct, 0.5))}**・75% ${f2(q(pct, 0.75))}。`,
  `日照 2 時間未満の日：中央 ${f2(q(dayTotals.filter((d) => d.sun < 2).map((d) => (d.estimated - d.measured) / Math.max(1, d.measured)), 0.5))}、日照 8 時間以上の日：中央 ${f2(q(dayTotals.filter((d) => d.sun >= 8).map((d) => (d.estimated - d.measured) / Math.max(1, d.measured)), 0.5))}。`,
  "",
].join("\n");

writeFileSync(join(out, "h02-report.md"), report);
writeFileSync(
  join(out, "h02-hours.csv"),
  ["date,n,alt,up,sun,rain,measured_w,clear_w,ratio,model", ...hours.map((h) => [h.date, h.n, h.alt.toFixed(1), h.up.toFixed(2), h.sun, h.rain, h.measured.toFixed(0), h.clear.toFixed(0), h.ratio.toFixed(3), h.model.toFixed(3)].join(","))].join("\n"),
);
writeFileSync(join(out, "h02-days.csv"), ["date,measured_mj,estimated_mj,sun_h", ...dayTotals.map((d) => [d.date, d.measured.toFixed(2), d.estimated.toFixed(2), d.sun.toFixed(1)].join(","))].join("\n"));
console.log(report);

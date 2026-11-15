// H-03 (#208, 日射量を材料にするかの議論): the forecast's radiation against what JMA measured. Three
// estimates of each hour's global radiation, each against the measured one:
//  A. the forecast's own radiation (Open-Meteo shortwave_radiation, the same field the app reads)
//  B. radiation from the forecast's sunshine and rain (shared/mrt.ts hourRadiation, the app's way)
//  C. radiation from the recorded sunshine and rain (the same way, from the records: how good the
//     sunshine method is at its best)
// A against B answers "is the forecast's radiation a better material than its sunshine?". C shows
// the method's own error, apart from the forecast's.
//  D (H-03b). A or B by the forecast's own sky (its sunshine share), E. the mean of A and B,
//  F (H-03c). A and B weighed by the forecast's cloud cover — read
//     against B, the app's way today, by error and by bias (the app compares a forecast day with a
//     recorded one, so a bias between them matters more than the size of the error).
//
// The forecasts are Open-Meteo's historical forecasts (the first hours of each run, stitched): a
// short lead, not the 2–7 days ahead the app shows. The comparison is of the materials, not of a
// week-ahead forecast.
//
// Run by hand, or by the "research-h03" workflow (manual only). The records stay out of the
// repository. Validation only: nothing here changes an input of the app (データの原則).
//
//   npx --yes tsx@4.19.2 research/brightness/h03.ts --station 47893 --from 2025-11-01 --to 2026-10-31 --out out

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import stations from "../../shared/stations.json";
import type { Station, WeatherRow } from "../../shared/types";
import { fetchHourlyDay } from "../../worker/src/jma-tables";
import { normalizeForecast } from "../../worker/src/open-meteo";
import { hourRadiation } from "../../shared/mrt";
import { radiationOf } from "../../shared/feel";
import { sunshineFraction } from "../../shared/brightness";
import { daylight, lowSun, meanWithInterval, rainState, sunOf } from "./h02-lib";

/**
 * H-03b (#208): the forecast's sky picks the estimate — where the forecast says the sun shines most of
 * the hour (its sunshine share at least `sunnyShare`), the radiation from its sunshine (B, right in the
 * clear); else its own radiation (A, right under cloud). The share is set beforehand at the middle and
 * not tuned on any year, so every year is a test. Read against B (the app's way today).
 */
const H03B = { sunnyShare: 0.5 } as const;

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
mkdirSync(join(out, "forecast"), { recursive: true });

const DAY_MS = 86_400_000;
const days: string[] = [];
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const W_TO_MJ_HOUR = 0.0036;

// ---- the records (JMA, as h02.ts: cached per day) -------------------------------------------------
const failed: string[] = [];
async function recordsOf(day: string): Promise<WeatherRow[] | null> {
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
  failed.push(day);
  return null;
}

// ---- the forecasts (Open-Meteo historical forecasts, one month a request) -------------------------
const coords = { latitude: String(station.lat[0] + station.lat[1] / 60), longitude: String(station.lon[0] + station.lon[1] / 60) };
const forecastFailed: string[] = [];
async function forecastMonth(start: string, end: string): Promise<WeatherRow[]> {
  const f = join(out, "forecast", `${blockNo}-${start}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  // One day more at the end: JMA's hour 24 is the next day's 00:00.
  const endPlus = new Date(Date.parse(`${end}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const url =
    "https://historical-forecast-api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({ ...coords, timezone: "Asia/Tokyo", start_date: start, end_date: endPlus, hourly: "shortwave_radiation,sunshine_duration,precipitation,cloud_cover" });
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const { hourlyRows } = normalizeForecast(data);
      // The forecast's cloud cover (%, F): not a field the app reads, kept beside each row (same order).
      const cloud: unknown[] = data?.hourly?.cloud_cover ?? [];
      hourlyRows.forEach((row, i) => (row.cloud = num(cloud[i])));
      writeFileSync(f, JSON.stringify(hourlyRows));
      await sleep(1000);
      return hourlyRows;
    } catch (e) {
      console.error("forecast", start, String(e));
      await sleep(5000);
    }
  }
  forecastFailed.push(start);
  return [];
}
const forecast = new Map<string, WeatherRow>();
for (let i = 0; i < days.length; ) {
  const month = days[i].slice(0, 7);
  const inMonth = days.filter((d) => d.startsWith(month));
  for (const r of await forecastMonth(inMonth[0], inMonth[inMonth.length - 1])) forecast.set(`${r.date}/${r.n}`, r);
  i += inMonth.length;
}

// ---- hour by hour --------------------------------------------------------------------------------
type Sky = "clear" | "broken" | "dark" | "rain";
interface Hour {
  date: string;
  n: number;
  low: boolean;
  sky: Sky;
  measured: number;
  a: number | null;
  b: number | null;
  c: number | null;
  /** H-03b: A or B by the forecast's own sky (its sunshine share against H03B.sunnyShare). */
  d: number | null;
  /** The mean of A and B. */
  e: number | null;
  /** H-03c: A and B weighed by the forecast's cloud cover — B under a clear forecast sky, A under a cloudy one. */
  f: number | null;
}
const hours: Hour[] = [];
let forecastMissing = 0;
for (const day of days) {
  const rows = await recordsOf(day);
  if (!rows) continue;
  for (const r of rows) {
    if (!daylight(day, r.n, blockNo)) continue;
    const measured = radiationOf(r);
    const sun = sunOf(r, day, blockNo);
    const rain = num(r.rain);
    if (measured == null || sun == null || rain == null) continue; // the record's own gap (counted in h02)
    const fc = forecast.get(`${day}/${r.n}`);
    const fcSolar = num(fc?.solar);
    const fcSun = num(fc?.sun);
    const fcRain = num(fc?.rain);
    if (fcSolar == null || fcSun == null || fcRain == null) forecastMissing++;
    const up = sunshineFraction(day, r.n, blockNo);
    const share = up > 0 ? sun / up : 0;
    const a = fcSolar;
    const b = fcSun == null || fcRain == null ? null : (hourRadiation(day, r.n, blockNo, fcSun, fcRain)?.ghi ?? null);
    // The forecast's own sky: what is known when the forecast is used (the real sky is not).
    const fcShare = fcSun == null ? null : up > 0 ? Math.min(1, fcSun / up) : 0;
    hours.push({
      date: day,
      n: r.n,
      low: lowSun(day, r.n, blockNo),
      sky: rainState(rain) === "wet" ? "rain" : share >= 0.7 ? "clear" : share > 0 ? "broken" : "dark",
      measured,
      a,
      b,
      c: hourRadiation(day, r.n, blockNo, sun, rain)?.ghi ?? null,
      d: a == null || b == null || fcShare == null ? null : fcShare >= H03B.sunnyShare ? b : a,
      e: a == null || b == null ? null : (a + b) / 2,
      f: a == null || b == null || num(fc?.cloud) == null ? null : (1 - num(fc!.cloud)! / 100) * b + (num(fc!.cloud)! / 100) * a,
    });
  }
}

// ---- report ----------------------------------------------------------------------------------------
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((x, y) => x - y);
  const i = (s.length - 1) * p;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const w0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : "—");
const sw0 = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(0)}` : "—");
const sp = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%` : "—");
const pa = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—");
const pc = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");

// Only hours where all three can be compared: the same hours for every estimate.
const both = hours.filter((h) => h.a != null && h.b != null && h.c != null && h.d != null && h.e != null && h.f != null);
const steady = both.filter((h) => !h.low);
const hourLine = (label: string, hs: Hour[]) => {
  const e = (k: "a" | "b" | "c") => hs.map((h) => h[k]! - h.measured);
  return `| ${label} | ${hs.length} | ${w0(mean(hs.map((h) => h.measured)))} | ${w0(mean(e("a").map(Math.abs)))} | ${w0(mean(e("b").map(Math.abs)))} | ${w0(mean(e("c").map(Math.abs)))} | ${sw0(mean(e("a")))} | ${sw0(mean(e("b")))} | ${sw0(mean(e("c")))} |`;
};
const hourHead =
  "| 区分 | 時間 | 実測の平均 | A 予報の日射：誤差 | B 予報の日照から：誤差 | C 記録の日照から：誤差 | A 偏り | B 偏り | C 偏り |\n|---|---|---|---|---|---|---|---|---|";
const skies: [string, Sky][] = [
  ["実際は晴れ（日照 0.7 以上）", "clear"],
  ["実際は晴れ間（日照 0〜0.7）", "broken"],
  ["実際は日照 0・雨なし", "dark"],
  ["実際は雨", "rain"],
];
const seasons: [string, number[]][] = [["冬（12〜2月）", [12, 1, 2]], ["春（3〜5月）", [3, 4, 5]], ["夏（6〜8月）", [6, 7, 8]], ["秋（9〜11月）", [9, 10, 11]]];
const inSeason = (date: string, ms: number[]) => ms.includes(+date.slice(5, 7));

// Day totals: the days whose every daylight hour has all three and the measured value.
const byDay = new Map<string, Hour[]>();
for (const h of hours) byDay.set(h.date, [...(byDay.get(h.date) ?? []), h]);
const dayRows = [...byDay.entries()]
  .filter(([d, hs]) => {
    const needed = Array.from({ length: 24 }, (_, i) => i + 1).filter((n) => daylight(d, n, blockNo)).length;
    return hs.length === needed && hs.every((h) => h.a != null && h.b != null && h.c != null && h.d != null && h.e != null && h.f != null);
  })
  .map(([date, hs]) => {
    const sum = (k: "measured" | "a" | "b" | "c" | "d" | "e" | "f") => hs.reduce((s, h) => s + (h[k] as number), 0) * W_TO_MJ_HOUR;
    const m = sum("measured");
    const rel = (k: "a" | "b" | "c" | "d" | "e" | "f") => (sum(k) - m) / Math.max(1, m);
    return { date, m, a: rel("a"), b: rel("b"), c: rel("c"), d: rel("d"), e: rel("e"), f: rel("f") };
  });
const dayLine = (label: string, ds: typeof dayRows) => {
  const diff = meanWithInterval(ds.map((d) => Math.abs(d.a) - Math.abs(d.b)));
  const iv = diff.interval ? ` [${sp(diff.interval[0])}, ${sp(diff.interval[1])}]` : "（日数不足）";
  return `| ${label} | ${ds.length} | ${pa(q(ds.map((d) => Math.abs(d.a)), 0.5))} | ${pa(q(ds.map((d) => Math.abs(d.b)), 0.5))} | ${pa(q(ds.map((d) => Math.abs(d.c)), 0.5))} | ${sp(diff.mean)}${iv} | ${pc(ds.filter((d) => Math.abs(d.a) < Math.abs(d.b)).length / ds.length)} |`;
};
const dayHead = "| 区分 | 日数 | A の誤差（中央） | B の誤差（中央） | C の誤差（中央） | A − B の差の平均 [95%] | A がよい日 |\n|---|---|---|---|---|---|---|";
const clearHours = (d: { date: string }) => (byDay.get(d.date) ?? []).filter((h) => h.sky === "clear").length;

const report = [
  `# H-03 予報の日射量と実測（${station.name} ${blockNo}、${from}〜${to}）`,
  "",
  "毎時の全天日射量（W/m²）を3通りに推定し、気象庁の実測と比べる。A：予報の日射量（アプリが読む `shortwave_radiation`）、B：予報の日照と降水から日照の式で出した日射、C：記録の日照と降水から同じ式で出した日射（式そのものの誤差）。誤差は |推定 − 実測| の平均、偏りは（推定 − 実測）の平均。",
  "",
  "予報は Open-Meteo の過去の予報（各回の最初の数時間をつないだもの）。アプリが見せる2〜7日先の予報ではないので、ここで比べるのは「材料としての質」。",
  "",
  "## そろい具合",
  `- 記録：${days.length} 日のうち、取れなかった ${failed.length} 日${failed.length ? `（${failed.slice(0, 10).join("、")}）` : ""}。`,
  `- 予報：取れなかった月 ${forecastFailed.length}${forecastFailed.length ? `（${forecastFailed.join("、")}）` : ""}。記録はあるのに予報の値が欠けた昼の時間 ${forecastMissing}。`,
  `- 3つとも比べられた昼の時間 ${both.length}（太陽の高い時間 ${steady.length}）、日の合計を比べられた日 ${dayRows.length}。`,
  "",
  "## 毎時（太陽の高い時間）",
  hourHead,
  hourLine("すべて", steady),
  ...skies.map(([l, k]) => hourLine(l, steady.filter((h) => h.sky === k))),
  "",
  "## 毎時を季節で（太陽の高い時間）",
  hourHead,
  ...seasons.map(([l, ms]) => hourLine(l, steady.filter((h) => inSeason(h.date, ms)))),
  "",
  "## 日の合計（|推定 − 実測| ÷ 実測）",
  "A − B が負なら、予報の日射量のほうが実測に近い。幅は日を単位にしたブートストラップの 95%。",
  dayHead,
  dayLine("すべて", dayRows),
  dayLine("晴れの時間が 6 時間以上の日", dayRows.filter((d) => clearHours(d) >= 6)),
  dayLine("晴れの時間が 2 時間未満の日", dayRows.filter((d) => clearHours(d) < 2)),
  ...seasons.map(([l, ms]) => dayLine(l, dayRows.filter((d) => inSeason(d.date, ms)))),
  "",
  "## H-03b：予報の空で A と B を使い分ける（#208）",
  `予報の日照の割合が ${H03B.sunnyShare} 以上の時間は B、それ以外は A（D）。A と B の平均（E）も並べる。しきい値は前もって真ん中に決め、どの年でも調整していないので、どの年の結果も確かめになる。比べる相手は今のアプリのやり方 B。`,
  "",
  "**先に決めた判断の条件**：日の合計の誤差の差（候補 − B）の 95% の幅が 0 より下で、晴れの多い日を悪くせず（幅の上が +1% 以下）、晴れ・雲どちらの偏りも B より 0 に近いこと。",
  "",
  "**H-03c（F）**：A と B を予報の雲量で重み付け（雲量 0% → B、100% → A、その間は比例）。重みは雲量そのもので調整しない。E より採る条件（2026-11-15 に先に決めた）：上の条件を満たし、**毎時**の偏りの大きさが、実際の空のどの区分（晴れ・晴れ間・日照 0・雨）でも E 以下。",
  "",
  "### 毎時（太陽の高い時間）：誤差（偏り）W/m²",
  "| 実際の空 | 時間 | A | B | D 使い分け | E 平均 | F 雲量で重み |",
  "|---|---|---|---|---|---|---|",
  ...[["すべて", steady] as [string, Hour[]], ...skies.map(([l, k]) => [l, steady.filter((h) => h.sky === k)] as [string, Hour[]])].map(([l, hs]) => {
    const cell = (k: "a" | "b" | "d" | "e" | "f") => {
      const e = hs.map((h) => h[k]! - h.measured);
      return `${w0(mean(e.map(Math.abs)))}（${sw0(mean(e))}）`;
    };
    return `| ${l} | ${hs.length} | ${cell("a")} | ${cell("b")} | ${cell("d")} | ${cell("e")} | ${cell("f")} |`;
  }),
  "",
  "### 日の合計：候補 − B（|誤差| の差の平均 [95%]）と、偏り（推定 − 実測 の平均）",
  "| 区分 | 日数 | D − B | E − B | F − B | A − B | 偏り B | 偏り D | 偏り E | 偏り F | 偏り A |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...([
    ["すべて", dayRows],
    ["晴れの時間が 6 時間以上の日", dayRows.filter((d) => clearHours(d) >= 6)],
    ["晴れの時間が 2 時間未満の日", dayRows.filter((d) => clearHours(d) < 2)],
    ...seasons.map(([l, ms]) => [l, dayRows.filter((d) => inSeason(d.date, ms))]),
  ] as [string, typeof dayRows][]).map(([l, ds]) => {
    const vs = (k: "a" | "d" | "e" | "f") => {
      const r = meanWithInterval(ds.map((d) => Math.abs(d[k]) - Math.abs(d.b)));
      return `${sp(r.mean)}${r.interval ? ` [${sp(r.interval[0])}, ${sp(r.interval[1])}]` : ""}`;
    };
    const bias = (k: "a" | "b" | "d" | "e" | "f") => sp(mean(ds.map((d) => d[k])));
    return `| ${l} | ${ds.length} | ${vs("d")} | ${vs("e")} | ${vs("f")} | ${vs("a")} | ${bias("b")} | ${bias("d")} | ${bias("e")} | ${bias("f")} | ${bias("a")} |`;
  }),
  "",
  "## 参考：太陽の低い時間",
  hourHead,
  hourLine("すべて", both.filter((h) => h.low)),
  "",
].join("\n");

writeFileSync(join(out, "h03-report.md"), report);
writeFileSync(
  join(out, "h03-hours.csv"),
  ["date,n,low_sun,sky,measured_w,a_forecast_w,b_forecast_sun_w,c_record_sun_w", ...hours.map((h) => [h.date, h.n, h.low ? 1 : 0, h.sky, h.measured.toFixed(0), h.a?.toFixed(0) ?? "", h.b?.toFixed(0) ?? "", h.c?.toFixed(0) ?? ""].join(","))].join("\n"),
);
console.log(report);

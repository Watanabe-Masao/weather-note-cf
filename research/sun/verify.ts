// Checks the solar maths behind the parts of the day (shared/sunTimes.ts, shared/dayParts.ts).
//
// Two references, for two different questions:
//   1. NAOJ (国立天文台 暦計算室, Kochi, March/June/October 2026: naoj-kochi-2026.json) — is it right?
//      An independent astronomical calculation; agreement between two approximations would not show it.
//   2. SunCalc 1.9.0 (test-only dependency) — does an independent implementation of the same
//      quantities agree, for every station and every day, including the boundaries we use (dawn and
//      dusk at −6°, half the noon altitude) that NAOJ does not publish?
// And what matters for the app: how often a moment would land in a different part, overall and in
// the ±5 minutes around each boundary, sampled every minute.
//
// Run:  research/data/node_modules/.bin/vite-node research/sun/verify.ts   (writes verify-results.md here)

import { readFileSync, writeFileSync } from "node:fs";
import SunCalc from "suncalc";
import { dayEdges, dayParts } from "../../shared/dayParts";
import stationList from "../../shared/stations.json";
import { altitudeCrossing, solarAltitude, solarNoon, solarTimes } from "../../shared/sunTimes";
import type { Station } from "../../shared/types";

const stations = (stationList as Station[]).map((s) => ({ name: s.name, block: s.blockNo, lat: s.lat[0] + s.lat[1] / 60, lon: s.lon[0] + s.lon[1] / 60 }));
const naoj = JSON.parse(readFileSync(new URL("./naoj-kochi-2026.json", import.meta.url), "utf8")) as {
  source: string;
  lat: number;
  lon: number;
  days: { date: string; rise: string; transit: string; altitude: number; set: string }[];
};

const hm = (s: string) => +s.split(":")[0] * 60 + +s.split(":")[1];
const datesOf = (year: number) => Array.from({ length: year % 4 === 0 ? 366 : 365 }, (_, i) => new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10));
const jstMin = (d: Date, date: string) => (d.getTime() - Date.parse(`${date}T00:00:00+09:00`)) / 60_000;

function stats(errors: number[]) {
  const a = errors.map(Math.abs).sort((x, y) => x - y);
  const n = a.length;
  return {
    n,
    mae: a.reduce((s, v) => s + v, 0) / n,
    rmse: Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / n),
    p95: a[Math.min(n - 1, Math.ceil(0.95 * n) - 1)],
    max: a[n - 1],
    bias: errors.reduce((s, v) => s + v, 0) / n,
  };
}
const row = (name: string, unit: string, e: number[], d = 2) => {
  const s = stats(e);
  return `| ${name} | ${s.n} | ${s.bias.toFixed(d)} | ${s.mae.toFixed(d)} | ${s.rmse.toFixed(d)} | ${s.p95.toFixed(d)} | ${s.max.toFixed(d)} | ${unit} |`;
};
const HEAD = "| 項目 | 件数 | 平均の差（偏り） | MAE | RMSE | 95%点 | 最大 | 単位 |\n| --- | --- | --- | --- | --- | --- | --- | --- |";

/** SunCalc's crossing of an altitude (degrees), by bisection on its own positions. */
function sunCalcCrossing(date: string, deg: number, rising: boolean, lat: number, lon: number): number | null {
  const noon = jstMin(SunCalc.getTimes(new Date(`${date}T12:00:00+09:00`), lat, lon).solarNoon, date);
  let a = rising ? noon - 720 : noon;
  let b = rising ? noon : noon + 720;
  const f = (m: number) => (SunCalc.getPosition(new Date(Date.parse(`${date}T00:00:00+09:00`) + m * 60_000), lat, lon).altitude * 180) / Math.PI - deg;
  if (Math.sign(f(a)) === Math.sign(f(b))) return null;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (Math.sign(f(m)) === Math.sign(f(a))) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  console.log(s);
};

// ---- 1. against NAOJ ----------------------------------------------------------------------------
log("# 太陽の計算の検証（時間区分の土台）\n");
log("生成：`research/sun/verify.ts`。差は「こちらの計算 − 基準」。\n");
log("## 1. 国立天文台（正しさ）\n");
log(`基準：${naoj.source}。地点は表の座標（北緯 ${naoj.lat}°・東経 ${naoj.lon}°）。表は分単位に丸めてあるため、時刻の差には丸めの ±0.5 分が含まれます（丸めだけなら MAE 約 0.25 分）。\n`);
{
  const ours = { rise: [] as number[], set: [] as number[], transit: [] as number[], alt: [] as number[] };
  const sc = { rise: [] as number[], set: [] as number[], transit: [] as number[], alt: [] as number[] };
  for (const d of naoj.days) {
    const t = solarTimes(d.date, naoj.lat, naoj.lon);
    const noon = solarNoon(d.date, naoj.lon);
    ours.rise.push(t.rise - hm(d.rise));
    ours.set.push(t.set - hm(d.set));
    ours.transit.push(noon - hm(d.transit));
    ours.alt.push(solarAltitude(d.date, noon, naoj.lat, naoj.lon) - d.altitude);
    const s = SunCalc.getTimes(new Date(`${d.date}T12:00:00+09:00`), naoj.lat, naoj.lon);
    sc.rise.push(jstMin(s.sunrise, d.date) - hm(d.rise));
    sc.set.push(jstMin(s.sunset, d.date) - hm(d.set));
    sc.transit.push(jstMin(s.solarNoon, d.date) - hm(d.transit));
    sc.alt.push((SunCalc.getPosition(s.solarNoon, naoj.lat, naoj.lon).altitude * 180) / Math.PI - d.altitude);
  }
  log(HEAD);
  log(row("日の出（この計算）", "分", ours.rise));
  log(row("日の入り（この計算）", "分", ours.set));
  log(row("南中時刻（この計算）", "分", ours.transit));
  log(row("南中高度（この計算）", "°", ours.alt));
  log(row("日の出（SunCalc）", "分", sc.rise));
  log(row("日の入り（SunCalc）", "分", sc.set));
  log(row("南中時刻（SunCalc）", "分", sc.transit));
  log(row("南中高度（SunCalc）", "°", sc.alt));
  log("");
}

// ---- 2. against SunCalc, every station and day --------------------------------------------------
log("## 2. SunCalc 1.9.0（別の実装との一致。全観測所・2026年の毎日）\n");
log("国立天文台が公表していない境目（薄明 −6°、南中高度の半分）も比べます。SunCalc 側の境目は、SunCalc の太陽高度から同じ二分法で求めました。\n");
const keys = ["dawn", "rise", "halfUp", "noon", "halfDown", "set", "dusk"] as const;
const LABEL: Record<(typeof keys)[number], string> = { dawn: "明け方（−6°）", rise: "日の出", halfUp: "朝／日中（半分の高さ）", noon: "南中", halfDown: "昼／夕方（半分の高さ）", set: "日の入り", dusk: "夕暮れ（−6°）" };
const diffs: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, []]));
function theirEdges(date: string, lat: number, lon: number) {
  const t = SunCalc.getTimes(new Date(`${date}T12:00:00+09:00`), lat, lon);
  const noon = jstMin(t.solarNoon, date);
  const top = (SunCalc.getPosition(t.solarNoon, lat, lon).altitude * 180) / Math.PI;
  return {
    dawn: jstMin(t.dawn, date),
    rise: jstMin(t.sunrise, date),
    halfUp: sunCalcCrossing(date, top / 2, true, lat, lon)!,
    noon,
    halfDown: sunCalcCrossing(date, top / 2, false, lat, lon)!,
    set: jstMin(t.sunset, date),
    dusk: jstMin(t.dusk, date),
  };
}
const year = datesOf(2026);
for (const s of stations)
  for (const date of year) {
    const ours = dayEdges(date, { lat: s.lat, lon: s.lon });
    const theirs = theirEdges(date, s.lat, s.lon);
    for (const k of keys) diffs[k].push(ours[k] - theirs[k]);
  }
log(`${stations.length}観測所 × ${year.length}日。\n`);
log(HEAD);
for (const k of keys) log(row(LABEL[k], "分", diffs[k]));
log("");

// ---- 3. what it means for the parts ---------------------------------------------------------------
log("## 3. 時間区分の判定が食い違う割合\n");
log("各観測所・各日の毎分（0:00〜23:59）を、こちらの境目と SunCalc の境目でそれぞれ区分に分け、違う区分になった分の割合です。境目の近く（各境目の前後5分を1分刻み、11点 × 5つの境目）も別に数えました。\n");
{
  const partOf = (m: number, e: { dawn: number; halfUp: number; noon: number; halfDown: number; dusk: number }) =>
    m < e.dawn ? 4 : m < e.halfUp ? 0 : m < e.noon ? 1 : m < e.halfDown ? 2 : m < e.dusk ? 3 : 4;
  let all = 0;
  let allDiff = 0;
  let near = 0;
  let nearDiff = 0;
  const perEdge: Record<string, [number, number]> = {};
  for (const s of stations)
    for (const date of year) {
      const a = dayEdges(date, { lat: s.lat, lon: s.lon });
      const b = theirEdges(date, s.lat, s.lon);
      for (let m = 0; m < 1440; m++) {
        all++;
        if (partOf(m, a) !== partOf(m, b)) allDiff++;
      }
      for (const k of ["dawn", "halfUp", "noon", "halfDown", "dusk"] as const) {
        const c = Math.round(a[k]);
        const p = (perEdge[k] ??= [0, 0]);
        for (let m = c - 5; m <= c + 5; m++) {
          near++;
          p[0]++;
          if (partOf(m, a) !== partOf(m, b)) {
            nearDiff++;
            p[1]++;
          }
        }
      }
    }
  const pct = (x: number, n: number) => `${((100 * x) / n).toFixed(3)}%`;
  log("| 範囲 | 判定した分 | 食い違い | 割合 |\n| --- | --- | --- | --- |");
  log(`| 1日中 | ${all} | ${allDiff} | ${pct(allDiff, all)} |`);
  log(`| 境目の前後5分 | ${near} | ${nearDiff} | ${pct(nearDiff, near)} |`);
  for (const [k, [n, d]] of Object.entries(perEdge)) log(`| 　${LABEL[k as (typeof keys)[number]]} | ${n} | ${d} | ${pct(d, n)} |`);
  log("");
}

// ---- 4. dates and places at the edges ----------------------------------------------------------------
log("## 4. 日付と場所の端\n");
{
  const lines: string[] = [];
  const kochi = stations.find((s) => s.block === "47893")!;
  for (const date of ["2028-02-28", "2028-02-29", "2028-03-01", "2026-12-31", "2027-01-01"]) {
    const a = dayEdges(date, { lat: kochi.lat, lon: kochi.lon });
    const b = theirEdges(date, kochi.lat, kochi.lon);
    const worst = Math.max(...keys.map((k) => Math.abs(a[k] - b[k])));
    lines.push(`| 高知 ${date} | 境目の差は最大 ${worst.toFixed(2)} 分（SunCalc と） |`);
  }
  for (const [lat, name] of [
    [66.5, "北緯66.5°（北極圏の境）"],
    [70, "北緯70°"],
    [78, "北緯78°"],
  ] as const)
    for (const date of ["2026-06-21", "2026-12-21"]) {
      const e = dayEdges(date, { lat, lon: 135 });
      const seq = [e.dawn, e.rise, e.halfUp, e.noon, e.halfDown, e.set, e.dusk];
      const ordered = seq.every((v, i) => Number.isFinite(v) && (i === 0 || v >= seq[i - 1]));
      const crossings = [altitudeCrossing(date, -6, true, lat, 135), altitudeCrossing(date, -0.833, true, lat, 135)].map((v) => (v == null ? "なし" : "あり"));
      lines.push(`| ${name} ${date} | 南中高度 ${e.noonAltitude.toFixed(1)}°、薄明の境 ${crossings[0]}・日の出 ${crossings[1]}。境目は${ordered ? "順に並ぶ（欠けた境目は南中からの固定の時間で補う）" : "**順に並ばない**"} |`);
      void dayParts(date, { lat, lon: 135 });
    }
  log("| 場合 | 結果 |\n| --- | --- |");
  lines.forEach(log);
  log("\n日付の扱い：時刻はすべて日本時間の 0:00 からの分で持ち、日付の境（大晦日・元日）と閏日でも差は他の日と同じです。白夜・極夜は日本では起きませんが、起きても区分が逆に並ばないことだけを確かめています。");
}

writeFileSync(new URL("./verify-results.md", import.meta.url), out.join("\n") + "\n");

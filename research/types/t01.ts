// T-01 (#222): 天気の型 on the real records. Each month is grouped with its 前年同曜日 days (52 weeks
// back) the way the month review's sample does (day-types.ts), and checked against criteria set
// before any result was seen (#222):
//  C1 分かれ方   months not「境目があいまい」(silhouette ≥ 0.2) ≥ 75%
//  C2 印の重なり months with two types of the same mark (sky + warm/cool) ≤ 10%
//  C3 型の中身   rain types: ≥ 70% of their days had rain ≥ 1 mm; sunny types: ≥ 80% had ≥ 3 h sunshine
//  C4 安定       one day left out and the month grouped again: the other days keep their type ≥ 90% (mean)
// The number of types the silhouette picks, and each month's types, are reported without a criterion.
//
// Run by hand, or by the "research-types" workflow (manual only). The records stay out of the
// repository. Validation only: nothing here changes an input of the app (データの原則).
//
//   npx --yes tsx@4.19.2 research/types/t01.ts --station 47893 --from 2024-11 --to 2026-10 --out out

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import stations from "../../shared/stations.json";
import type { Station, WeatherRow } from "../../shared/types";
import { fetchDailyMonth } from "../../worker/src/jma-tables";
import { clusterDays, type Clustering } from "./day-types";
import { baseName, markOf, monthsBetween, shiftMonth } from "./t01-lib";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const blockNo = arg("station", "47893");
const from = arg("from", "2024-11");
const to = arg("to", "2026-10");
const out = arg("out", "research/types/out");
const station = (stations as Station[]).find((s) => s.blockNo === blockNo);
if (!station) throw new Error(`no station ${blockNo}`);
mkdirSync(join(out, "months"), { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY_MS = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const PREV_SAME_WEEKDAY = 364;

// ---- the records (JMA's daily table, one month a request, cached) --------------------------------
const failed: string[] = [];
async function monthRows(month: string): Promise<WeatherRow[]> {
  const f = join(out, "months", `${blockNo}-${month}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  for (let k = 0; k < 3; k++) {
    try {
      const { rows } = await fetchDailyMonth(station!, month, "9999-12-31");
      writeFileSync(f, JSON.stringify(rows));
      await sleep(1000);
      return rows;
    } catch (e) {
      console.error(month, String(e));
      await sleep(5000);
    }
  }
  failed.push(month);
  return [];
}
const byDate = new Map<string, WeatherRow>();
// From 13 months before the first: the 前年同曜日 of the first month's days.
for (const m of monthsBetween(shiftMonth(from, -13), to)) for (const r of await monthRows(m)) byDate.set(r.date, r);

// ---- month by month ------------------------------------------------------------------------------
interface MonthResult {
  month: string;
  c: Clustering | null;
  dupMark: boolean;
  stability: number | null;
  missing: number;
}
const results: MonthResult[] = [];
const rainDays = { n: 0, wet: 0 };
const sunDays = { n: 0, bright: 0 };
for (const month of monthsBetween(from, to)) {
  const days: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) days.push(d);
  const rowsA = days.map((d) => byDate.get(d) ?? null);
  const rowsB = days.map((d) => byDate.get(addDays(d, -PREV_SAME_WEEKDAY)) ?? null);
  const c = clusterDays(rowsA, rowsB);
  if (!c) {
    results.push({ month, c: null, dupMark: false, stability: null, missing: rowsA.filter((r) => !r).length });
    continue;
  }
  const marks = c.types.map(markOf);
  const dupMark = new Set(marks).size < marks.length;
  // C3: every day of a rain type and of a sunny type, both years.
  for (const t of c.types) {
    const rows = [...t.a.map((i) => rowsA[i]), ...t.b.map((i) => rowsB[i])];
    if (t.sky === "rain") for (const r of rows) (rainDays.n++, (rainDays.wet += Number(r?.rain) >= 1 ? 1 : 0));
    if (t.sky === "sun") for (const r of rows) (sunDays.n++, (sunDays.bright += Number(r?.sun) >= 3 ? 1 : 0));
  }
  // C4: leave each placed day of the month out in turn, group again with the same number of types,
  // and count the other days (both years) that keep their type's name.
  const typeOf = (cl: Clustering) => {
    const m = new Map<string, string>();
    for (const t of cl.types) {
      for (const i of t.a) m.set(`a${i}`, baseName(t.name));
      for (const i of t.b) m.set(`b${i}`, baseName(t.name));
    }
    return m;
  };
  const whole = typeOf(c);
  const k = c.types.length;
  const keeps: number[] = [];
  for (let i = 0; i < rowsA.length; i++) {
    if (!whole.has(`a${i}`)) continue;
    const less = rowsA.map((r, j) => (j === i ? null : r));
    const again = clusterDays(less, rowsB, [k, k]);
    if (!again) continue;
    const now = typeOf(again);
    let same = 0;
    let all = 0;
    for (const [key, name] of whole) {
      if (key === `a${i}`) continue;
      all++;
      if (now.get(key) === name) same++;
    }
    keeps.push(same / all);
  }
  const stability = keeps.length ? keeps.reduce((s, v) => s + v, 0) / keeps.length : null;
  results.push({ month, c, dupMark, stability, missing: c.missingA });
}

// ---- the report ----------------------------------------------------------------------------------
const grouped = results.filter((r) => r.c);
const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(0)}%` : "—");
const c1 = grouped.filter((r) => r.c!.silhouette >= 0.2).length;
const c2 = grouped.filter((r) => r.dupMark).length;
const c3r = rainDays.n ? rainDays.wet / rainDays.n : null;
const c3s = sunDays.n ? sunDays.bright / sunDays.n : null;
const stab = grouped.map((r) => r.stability).filter((v): v is number => v != null);
const c4 = stab.length ? stab.reduce((s, v) => s + v, 0) / stab.length : null;
const verdict = (ok: boolean | null) => (ok == null ? "（数えられない）" : ok ? "満たす" : "**満たさない**");
const kCount = new Map<number, number>();
for (const r of grouped) kCount.set(r.c!.types.length, (kCount.get(r.c!.types.length) ?? 0) + 1);

const lines: string[] = [];
lines.push(`# T-01 天気の型（${blockNo}、${from}〜${to}、${results.length}か月）`, "");
lines.push("| 基準 | 結果 | 判定 |", "|---|---|---|");
lines.push(`| C1 あいまいでない月 ≥ 75% | ${c1}/${grouped.length}（${pct(c1, grouped.length)}） | ${verdict(grouped.length ? c1 / grouped.length >= 0.75 : null)} |`);
lines.push(`| C2 同じ印の型がある月 ≤ 10% | ${c2}/${grouped.length}（${pct(c2, grouped.length)}） | ${verdict(grouped.length ? c2 / grouped.length <= 0.1 : null)} |`);
lines.push(`| C3a 雨の型の日のうち雨 1mm 以上 ≥ 70% | ${rainDays.wet}/${rainDays.n}（${pct(rainDays.wet, rainDays.n)}） | ${verdict(c3r == null ? null : c3r >= 0.7)} |`);
lines.push(`| C3b 晴れの型の日のうち日照 3h 以上 ≥ 80% | ${sunDays.bright}/${sunDays.n}（${pct(sunDays.bright, sunDays.n)}） | ${verdict(c3s == null ? null : c3s >= 0.8)} |`);
lines.push(`| C4 1日抜いても型が変わらない ≥ 90% | ${c4 == null ? "—" : `${(c4 * 100).toFixed(1)}%`} | ${verdict(c4 == null ? null : c4 >= 0.9)} |`);
lines.push("", `自動で選ばれた型の数：${[...kCount].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}つ ${n}か月`).join("、")}`);
if (results.length > grouped.length) lines.push(`分けられなかった月：${results.filter((r) => !r.c).map((r) => r.month).join("、")}`);
if (failed.length) lines.push(`取れなかった月：${failed.join("、")}`);
lines.push("", "## 月ごと", "", "| 月 | 数 | シルエット | 型（この月／前年同曜日の日数） | 同じ印 | 1日抜いて同じ |", "|---|---|---|---|---|---|");
for (const r of results) {
  if (!r.c) {
    lines.push(`| ${r.month} | — | — | 分けられない（欠け ${r.missing}日） | — | — |`);
    continue;
  }
  const types = r.c.types.map((t) => `${t.name} ${t.a.length}/${t.b.length}`).join("、");
  lines.push(`| ${r.month} | ${r.c.types.length} | ${r.c.silhouette.toFixed(2)} | ${types} | ${r.dupMark ? "あり" : ""} | ${r.stability == null ? "—" : `${(r.stability * 100).toFixed(0)}%`} |`);
}
const report = lines.join("\n") + "\n";
writeFileSync(join(out, "t01-report.md"), report);
console.log(report);

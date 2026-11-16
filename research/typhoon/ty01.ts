// TY-01 (#220): the days a typhoon's 強風域 / 暴風域 covered the station, from JMA's best track, set
// against the records' 強風・暴風 days (shared/storm.ts). Criteria set before any result (#220):
//  C1 当たり     of the days inside a 暴風域, the records show 強風 or 暴風 on ≥ 50%
//  C2 新しいこと of the records' 強風・暴風 days, ≥ 10% are tied to a typhoon (inside its 強風域)
//  C3 決め方     the 強風域 days by "ellipse" and by "circle" (track.ts) differ on ≤ 20% of them
// Also written: every typhoon day (date, 台風◯号, inside or near, nearest distance, pressure, the
// record's wind and rain), as a JSON for the month review's sample.
//
// Run by the "research-typhoon" workflow (manual only): it downloads bst_all.zip and unpacks it.
//   npx --yes tsx@4.19.2 research/typhoon/ty01.ts --bst bst_all.txt --from 2015 --to 2025 --out research/typhoon/out
// 出典：気象庁 RSMC Tokyo ベストトラック、気象庁 過去の気象データ。判定（強風域に入った日）は Weather Note による。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import stations from "../../shared/stations.json";
import { stormOfRow } from "../../shared/storm";
import type { Station, WeatherRow } from "../../shared/types";
import { fetchDailyMonth } from "../../worker/src/jma-tables";
import { parseBestTrack, typhoonDays, type TyphoonDay } from "./track";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const blockNo = arg("station", "47893");
const bst = arg("bst", "bst_all.txt");
const from = Number(arg("from", "2015"));
const to = Number(arg("to", "2025"));
const out = arg("out", "research/typhoon/out");
const station = (stations as Station[]).find((s) => s.blockNo === blockNo);
if (!station) throw new Error(`no station ${blockNo}`);
const lat = station.lat[0] + station.lat[1] / 60;
const lon = station.lon[0] + station.lon[1] / 60;
mkdirSync(join(out, "months"), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the records ---------------------------------------------------------------------------------
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
for (let y = from; y <= to; y++) for (let m = 1; m <= 12; m++) for (const r of await monthRows(`${y}-${String(m).padStart(2, "0")}`)) byDate.set(r.date, r);

// ---- the track -----------------------------------------------------------------------------------
const storms = parseBestTrack(readFileSync(bst, "latin1")).filter((s) => s.year >= from && s.year <= to);
const ell: TyphoonDay[] = storms.flatMap((s) => typhoonDays(s, lat, lon, "ellipse"));
const cir: TyphoonDay[] = storms.flatMap((s) => typhoonDays(s, lat, lon, "circle"));
const key = (d: TyphoonDay) => `${d.date}/${d.storm.id}`;

// ---- the criteria --------------------------------------------------------------------------------
const level = (date: string) => stormOfRow(byDate.get(date) as Record<string, unknown> | undefined);
const violent = ell.filter((d) => d.violent);
const c1 = violent.filter((d) => level(d.date) != null).length;
const stormDays = [...byDate.values()].filter((r) => stormOfRow(r as unknown as Record<string, unknown>));
const galeDates = new Set(ell.filter((d) => d.gale).map((d) => d.date));
const c2 = stormDays.filter((r) => galeDates.has(r.date)).length;
const galeE = new Set(ell.filter((d) => d.gale).map(key));
const galeC = new Set(cir.filter((d) => d.gale).map(key));
const union = new Set([...galeE, ...galeC]);
const differ = [...union].filter((k) => galeE.has(k) !== galeC.has(k)).length;
// Inside a 強風域 but no 強風 in the records: how often the city's wind stayed under the marks.
const galeQuiet = ell.filter((d) => d.gale && level(d.date) == null).length;

const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(0)}%` : "—");
const verdict = (ok: boolean | null) => (ok == null ? "（数えられない）" : ok ? "満たす" : "**満たさない**");
const lines: string[] = [];
lines.push(`# TY-01 台風の日（${blockNo}、${from}〜${to}年、台風 ${storms.length}個）`, "");
lines.push("| 基準 | 結果 | 判定 |", "|---|---|---|");
lines.push(`| C1 暴風域に入った日のうち記録が強風・暴風 ≥ 50% | ${c1}/${violent.length}（${pct(c1, violent.length)}） | ${verdict(violent.length ? c1 / violent.length >= 0.5 : null)} |`);
lines.push(`| C2 記録の強風・暴風の日のうち台風の強風域 ≥ 10% | ${c2}/${stormDays.length}（${pct(c2, stormDays.length)}） | ${verdict(stormDays.length ? c2 / stormDays.length >= 0.1 : null)} |`);
lines.push(`| C3 楕円と円で強風域の日が食い違う ≤ 20% | ${differ}/${union.size}（${pct(differ, union.size)}） | ${verdict(union.size ? differ / union.size <= 0.2 : null)} |`);
lines.push("", `強風域に入ったが記録に強風の印がない日：${galeQuiet}/${galeE.size}（${pct(galeQuiet, galeE.size)}）`);
if (failed.length) lines.push(`取れなかった月：${failed.join("、")}`);
lines.push("", "## 台風の日（強風域に入った日、または中心が 500km 以内）", "", "| 日 | 台風 | 域 | 最接近 | 気圧 | 記録 | 最大風速／瞬間 | 雨 |", "|---|---|---|---|---|---|---|---|");
const fmt = (v: unknown, d = 1) => (typeof v === "number" ? v.toFixed(d) : "—");
for (const d of ell) {
  const r = byDate.get(d.date) as Record<string, unknown> | undefined;
  const lv = level(d.date);
  lines.push(
    `| ${d.date} | ${d.storm.year}年 ${d.storm.number}号 ${d.storm.name} | ${d.violent ? "暴風域" : d.gale ? "強風域" : "外"} | ${d.nearestKm.toFixed(0)}km | ${d.pressure == null ? "—" : d.pressure.toFixed(0)} | ${lv === "storm" ? "暴風" : lv === "strong" ? "強風" : ""} | ${fmt(r?.windMax)}／${fmt(r?.gust)} | ${fmt(r?.rain, 0)} |`,
  );
}
const report = lines.join("\n") + "\n";
writeFileSync(join(out, "ty01-report.md"), report);
writeFileSync(join(out, `typhoon-days-${blockNo}.json`), JSON.stringify(ell));
console.log(report);

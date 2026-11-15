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
// Validation only: nothing here changes an input of the app (データの原則). What counts (missing
// values, the hours a day needs, the unstable low sun, the kinds of 日照 0) is in h02-lib.ts.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import stations from "../../shared/stations.json";
import type { Station, WeatherRow } from "../../shared/types";
import { fetchHourlyDay } from "../../worker/src/jma-tables";
import { RAIN_MM, sunshineFactor, sunshineFraction } from "../../shared/brightness";
import { hourRadiation } from "../../shared/mrt";
import { radiationOf } from "../../shared/feel";
import { solarAltitude, stationLatLon } from "../../shared/sunTimes";
import { clearSkyW, dayCheck, daylight, h02bFactor, H02B, meanWithInterval, overlapsFit, daySky, type DaySky, LOW_SUN, lowSun, type Missing, neighbours, rainState, type RainState, sunOf } from "./h02-lib";

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
/** Days JMA did not give after three tries (counted in the report, never read as empty days). */
const failed: string[] = [];
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
  failed.push(day);
  return null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ll = stationLatLon(blockNo)!;
const W_TO_MJ_HOUR = 0.0036;

interface Hour {
  date: string;
  n: number;
  alt: number;
  up: number;
  sun: number;
  rain: number | null;
  wet: RainState;
  low: boolean;
  day: DaySky | null;
  around: "dark" | "sunny" | "unknown";
  measured: number;
  clear: number;
  ratio: number;
  /** The app's share of the clear sky (sunshineFactor); null when the rain is not recorded (it needs it). */
  model: number | null;
}
const hours: Hour[] = [];
const dayTotals: { date: string; measured: number; estimated: number; sun: number; estimatedB: number }[] = [];
/** The app's share for a 日照 0・雨なし hour (CLOUD.cloudy), which H-02b replaces. */
const APP_DARK = sunshineFactor(0, false, 0);
/** Per month: days asked, read, complete, and the needed hours missing each value. */
const months = new Map<string, { days: number; read: number; complete: number; needed: number; missing: Record<Missing, number> }>();

for (const day of days) {
  const mo = months.get(day.slice(0, 7)) ?? { days: 0, read: 0, complete: 0, needed: 0, missing: { radiation: 0, sun: 0, rain: 0 } };
  months.set(day.slice(0, 7), mo);
  mo.days++;
  const rows = await rowsOf(day);
  if (!rows) continue;
  mo.read++;
  const check = dayCheck(day, blockNo, rows);
  mo.needed += check.needed.length;
  for (const m of check.missing) for (const w of m.what) mo.missing[w]++;
  if (check.complete) mo.complete++;
  // The day's sunshine, only when every daylight hour has it (a gap would read as a dull day).
  const daySun = check.missing.some((m) => m.what.includes("sun")) ? null : rows.reduce((t, r) => t + (sunOf(r, day, blockNo) ?? 0), 0);
  let m = 0, e = 0, eB = 0;
  for (const r of rows) {
    const w = radiationOf(r);
    const sun = sunOf(r, day, blockNo);
    const rain = num(r.rain);
    const clear = clearSkyW(day, r.n, blockNo);
    if (w == null || sun == null || !daylight(day, r.n, blockNo)) continue;
    if (check.complete) {
      const est = (hourRadiation(day, r.n, blockNo, sun, rain!)?.ghi ?? 0) * W_TO_MJ_HOUR;
      m += w * W_TO_MJ_HOUR;
      e += est;
      // H-02b: with no sunshine the hour's light is the clear sky's × the share, so swapping the
      // share scales it (exactly: no beam to keep).
      const b = sun === 0 && rainState(rain) === "dry" ? h02bFactor(neighbours(rows, r.n)) : null;
      eB += b == null ? est : (est * b) / APP_DARK;
    }
    const up = sunshineFraction(day, r.n, blockNo);
    const share = up > 0 ? Math.min(1, sun / up) : 0;
    hours.push({
      date: day,
      n: r.n,
      alt: solarAltitude(day, (r.n - 0.5) * 60, ll.lat, ll.lon),
      up,
      sun,
      rain,
      wet: rainState(rain),
      low: lowSun(day, r.n, blockNo),
      day: daySun == null ? null : daySky(daySun),
      around: sun === 0 ? neighbours(rows, r.n) : "unknown",
      measured: w,
      clear,
      ratio: w / clear,
      model: rain == null ? null : sunshineFactor(share, rain >= RAIN_MM, rain),
    });
  }
  if (check.complete) dayTotals.push({ date: day, measured: m, estimated: e, sun: daySun ?? 0, estimatedB: eB });
}

// ---- report ------------------------------------------------------------------------------------
// Each table splits the hours (never one mean over the year, where too high and too low cancel) and
// shows the error's direction and size: the app's value − the measured ratio, and how often the
// app's is the higher.
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i - Math.floor(i));
};
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const signed = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}` : "—");
const pc = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
const line = (label: string, hs: Hour[]) => {
  const r = hs.map((h) => h.ratio);
  const withModel = hs.filter((h) => h.model != null);
  const d = withModel.map((h) => h.model! - h.ratio);
  return `| ${label} | ${hs.length} | ${f2(q(r, 0.1))} | ${f2(q(r, 0.25))} | **${f2(q(r, 0.5))}** | ${f2(q(r, 0.75))} | ${f2(q(r, 0.9))} | ${f2(q(withModel.map((h) => h.model!), 0.5))} | ${signed(q(d, 0.5))} | ${pc(d.filter((x) => x > 0).length / d.length)} |`;
};
const head = "| 区分 | 時間 | 10% | 25% | 中央 | 75% | 90% | アプリ（中央） | 差の中央（アプリ−実測） | アプリが多い時間 |\n|---|---|---|---|---|---|---|---|---|---|";
const shareOf = (h: Hour) => (h.up > 0 ? Math.min(1, h.sun / h.up) : 0);
const steady = hours.filter((h) => !h.low);
const dry = steady.filter((h) => h.wet === "dry");
const wet = steady.filter((h) => h.wet === "wet");
const none = dry.filter((h) => h.sun === 0);
const altBins: [string, (h: Hour) => boolean][] = [
  ["15° 未満", (h) => h.alt < 15],
  ["15〜30°", (h) => h.alt >= 15 && h.alt < 30],
  ["30〜45°", (h) => h.alt >= 30 && h.alt < 45],
  ["45° 以上", (h) => h.alt >= 45],
];
const seasons: [string, number[]][] = [["冬（12〜2月）", [12, 1, 2]], ["春（3〜5月）", [3, 4, 5]], ["夏（6〜8月）", [6, 7, 8]], ["秋（9〜11月）", [9, 10, 11]]];
const inSeason = (date: string, ms: number[]) => ms.includes(+date.slice(5, 7));
const dayErr = (ds: typeof dayTotals) => ds.map((d) => (d.estimated - d.measured) / Math.max(1, d.measured));
const dayLine = (label: string, ds: typeof dayTotals) => {
  const p = dayErr(ds);
  return `| ${label} | ${ds.length} | ${signed(q(p, 0.25))} | **${signed(q(p, 0.5))}** | ${signed(q(p, 0.75))} | ${pc(p.filter((x) => x > 0).length / p.length)} |`;
};
const dayHead = "| 区分 | 日数 | 25% | 中央 | 75% | 日照の式が多い日 |\n|---|---|---|---|---|---|";
const totalMissing = (w: Missing) => [...months.values()].reduce((t, m) => t + m.missing[w], 0);
const unknownRain = steady.filter((h) => h.wet === "unknown").length;

const report = [
  `# H-02 雲で弱める割合（${station.name} ${blockNo}、${from}〜${to}）`,
  "",
  "毎時の値：実測の全天日射量 ÷ その時間の快晴の日射量。アプリの値（`sunshineFactor`）と、その差（アプリ − 実測）の向きと大きさを並べる。1年をまとめて平均せず、日照・雨・太陽の高さ・季節・その日の空で分ける。",
  "",
  "## データのそろい具合（結果を読む前に）",
  `- 日：${days.length} 日のうち、読めた ${days.length - failed.length} 日、取れなかった ${failed.length} 日${failed.length ? `（${failed.slice(0, 10).join("、")}${failed.length > 10 ? " ほか" : ""}）` : ""}。日の合計を比べられた（昼の時間がすべてそろった）日 ${dayTotals.length} 日。`,
  `- 昼の時間（快晴なら記録に出る日射がある時間：0.01 MJ/㎡ 以上。季節で長さが変わる）の欠け：日射 ${totalMissing("radiation")}、日照 ${totalMissing("sun")}、降水 ${totalMissing("rain")} 時間。`,
  `- 降水が記録されていない時間（${unknownRain} 時間）は「雨なし」にも「雨」にも入れない（欠けを 0 にしない）。`,
  "",
  "| 月 | 日数 | 読めた | そろった日 | 昼の時間 | 日射の欠け | 日照の欠け | 降水の欠け |",
  "|---|---|---|---|---|---|---|---|",
  ...[...months.entries()].map(([k, m]) => `| ${k} | ${m.days} | ${m.read} | ${m.complete} | ${m.needed} | ${m.missing.radiation} | ${m.missing.sun} | ${m.missing.rain} |`),
  "",
  `以下の表は、太陽の高い時間（快晴の日射 ${LOW_SUN.clearW} W/m² 以上、日照を測れる時間が ${LOW_SUN.up * 100}% 以上）。太陽の低い時間は割る数が小さく値が揺れるので、最後に別の表にする。`,
  "",
  "## 日照の割合で（雨なし）",
  head,
  line("日照 0", none),
  line("0 〜 0.3", dry.filter((h) => shareOf(h) > 0 && shareOf(h) < 0.3)),
  line("0.3 〜 0.7", dry.filter((h) => shareOf(h) >= 0.3 && shareOf(h) < 0.7)),
  line("0.7 〜 1 未満", dry.filter((h) => shareOf(h) >= 0.7 && shareOf(h) < 1)),
  line("日照 1（快晴）", dry.filter((h) => shareOf(h) >= 1)),
  "",
  "## 日照 0・雨なしは1つの空ではない：その日の空と前後の時間で",
  "日照 0 でも散乱光は届く。厚い雲の日（その日の日照 1 時間未満）と、晴れ間の多い日の一時的な雲とでは通す光が違うはず。",
  head,
  line("その日の日照 1 時間未満", none.filter((h) => h.day === "dull")),
  line("その日の日照 1〜5 時間", none.filter((h) => h.day === "mixed")),
  line("その日の日照 5 時間以上", none.filter((h) => h.day === "bright")),
  line("前後の時間も日照 0", none.filter((h) => h.around === "dark")),
  line("前後のどちらかに日照", none.filter((h) => h.around === "sunny")),
  "",
  "## 日照 0・雨なしを、太陽の高さで",
  head,
  ...altBins.map(([l, f]) => line(l, none.filter(f))),
  "",
  "## 日照 0・雨なしを、季節で",
  head,
  ...seasons.map(([l, ms]) => line(l, none.filter((h) => inSeason(h.date, ms)))),
  "",
  "## 雨（日照 0）を、降水量で",
  head,
  line("0.5〜1 mm", wet.filter((h) => h.sun === 0 && h.rain! < 1)),
  line("1〜3 mm", wet.filter((h) => h.sun === 0 && h.rain! >= 1 && h.rain! < 3)),
  line("3〜10 mm", wet.filter((h) => h.sun === 0 && h.rain! >= 3 && h.rain! < 10)),
  line("10 mm 以上", wet.filter((h) => h.sun === 0 && h.rain! >= 10)),
  "",
  "## 日の合計（#103：日照から出した日射 − 実測、の割合）",
  "昼の時間がすべてそろった日だけ。",
  dayHead,
  dayLine("すべて", dayTotals),
  dayLine("日照 2 時間未満の日", dayTotals.filter((d) => d.sun < 2)),
  dayLine("日照 2〜8 時間の日", dayTotals.filter((d) => d.sun >= 2 && d.sun < 8)),
  dayLine("日照 8 時間以上の日", dayTotals.filter((d) => d.sun >= 8)),
  ...seasons.map(([l, ms]) => dayLine(l, dayTotals.filter((d) => inSeason(d.date, ms)))),
  "",
  "## H-02b：日照 0 の割合を前後の時間の日照で分ける案（#208）",
  overlapsFit(from, to)
    ? `**注意：この期間は H-02b の数を決めた年（${H02B.fittedOn.from}〜${H02B.fittedOn.to}）と重なる。ここの成績は当てはめの成績で、確かめにはならない。**`
    : `確かめ：H-02b の数（前後も日照 0：${H02B.dark}、前後のどちらかに日照：${H02B.between}）は ${H02B.fittedOn.from}〜${H02B.fittedOn.to} で決めた。この期間はその外。`,
  "",
  "### 毎時（日照 0・雨なし、太陽の高い時間）：誤差の大きさ（実測 ÷ 快晴との差の絶対値の平均）と偏り",
  "| 前後の時間 | 時間 | 今（1/3）の誤差 | H-02b の誤差 | 今の偏り | H-02b の偏り |",
  "|---|---|---|---|---|---|",
  ...(["dark", "sunny", "unknown"] as const).map((k) => {
    const hs = none.filter((h) => h.around === k);
    const a = hs.map((h) => APP_DARK - h.ratio);
    const b = hs.map((h) => (h02bFactor(k) ?? APP_DARK) - h.ratio);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
    const label = k === "dark" ? "前後も日照 0" : k === "sunny" ? "前後のどちらかに日照" : "分からない（H-02b も 1/3）";
    return `| ${label} | ${hs.length} | ${f2(mean(a.map(Math.abs)))} | ${f2(mean(b.map(Math.abs)))} | ${signed(mean(a))} | ${signed(mean(b))} |`;
  }),
  "",
  "### 日の合計：誤差の大きさ（|推定 − 実測| ÷ 実測）",
  "差は「H-02b − 今」で、負なら H-02b がよい。幅は日を単位にしたブートストラップの 95%。",
  "| 区分 | 日数 | 今の誤差（中央） | H-02b の誤差（中央） | 差の平均 [95%] | H-02b がよい日 |",
  "|---|---|---|---|---|---|",
  ...([
    ["すべて", dayTotals],
    ["日照 2 時間未満の日", dayTotals.filter((d) => d.sun < 2)],
    ["日照 2〜8 時間の日", dayTotals.filter((d) => d.sun >= 2 && d.sun < 8)],
    ["日照 8 時間以上の日", dayTotals.filter((d) => d.sun >= 8)],
  ] as [string, typeof dayTotals][]).map(([l, ds]) => {
    const ea = ds.map((d) => Math.abs(d.estimated - d.measured) / Math.max(1, d.measured));
    const eb = ds.map((d) => Math.abs(d.estimatedB - d.measured) / Math.max(1, d.measured));
    const diff = meanWithInterval(eb.map((x, i) => x - ea[i]));
    const iv = diff.interval ? ` [${signed(diff.interval[0])}, ${signed(diff.interval[1])}]` : "（日数不足）";
    return `| ${l} | ${ds.length} | ${f2(q(ea, 0.5))} | ${f2(q(eb, 0.5))} | ${signed(diff.mean)}${iv} | ${pc(eb.filter((x, i) => x < ea[i]).length / ds.length)} |`;
  }),
  "",
  "## 参考：太陽の低い時間（割る数が小さく、値が揺れる）",
  head,
  line("日照 0・雨なし", hours.filter((h) => h.low && h.wet === "dry" && h.sun === 0)),
  line("日照あり・雨なし", hours.filter((h) => h.low && h.wet === "dry" && h.sun > 0)),
  line("雨", hours.filter((h) => h.low && h.wet === "wet")),
  "",
].join("\n");

writeFileSync(join(out, "h02-report.md"), report);
writeFileSync(
  join(out, "h02-hours.csv"),
  [
    "date,n,alt,up,sun,rain,rain_state,low_sun,day_sky,neighbours,measured_w,clear_w,ratio,model",
    ...hours.map((h) =>
      [h.date, h.n, h.alt.toFixed(1), h.up.toFixed(2), h.sun, h.rain ?? "", h.wet, h.low ? 1 : 0, h.day ?? "", h.around, h.measured.toFixed(0), h.clear.toFixed(0), h.ratio.toFixed(3), h.model?.toFixed(3) ?? ""].join(","),
    ),
  ].join("\n"),
);
writeFileSync(join(out, "h02-days.csv"), ["date,measured_mj,estimated_mj,estimated_h02b_mj,sun_h", ...dayTotals.map((d) => [d.date, d.measured.toFixed(2), d.estimated.toFixed(2), d.estimatedB.toFixed(2), d.sun.toFixed(1)].join(","))].join("\n"));
console.log(report);

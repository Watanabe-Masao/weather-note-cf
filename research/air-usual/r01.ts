// 空気の「ふだん」の比べ方（2026-11-25 外部レビュー・渡辺さん「両方お願いします」）。
//
// 高知（CAMS 全球、Open-Meteo）の PM2.5・黄砂の1時間値を 2023-01 から読み、評価する日より前のデータだけで「ふだん」を作って、
// 「多い」と出る日の割合を比べる。画面は変えない（決めるための材料）。
//
//   ふだん：A＝直近30日（今の画面）／S＝同じ季節の過去の年（評価する日の前後30日、前の年まで）
//   出し方：R1＝1時間でも 90% を超える／R2＝3時間以上続けて超える／R3＝1日の値（PM2.5 は日平均、黄砂は日最大）が、
//          同じ期間の1日の値の 90% を超える
//   見るもの：出る日の割合（7日ずつのかたまりで並べ替えた 95% の幅）、続いている高い日の途中で消えた日、A と S のずれ
//
// 使い方：npx tsx research/air-usual/r01.ts --from 2024-01-01 --to 2026-11-24 --out research/air-usual/out
// 読むのは Open-Meteo（CC BY 4.0、Copernicus CAMS）。結果は Actions の成果物とまとめだけ（コミットしない）。

import { mkdirSync, writeFileSync } from "node:fs";
import { quantile } from "../../shared/airUsual";
import { STATION_PLACES } from "../../shared/stationPlaces";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const FROM = arg("from", "2024-01-01");
const TO = arg("to", "2026-11-24");
const OUT = arg("out", "research/air-usual/out");
const FIRST = "2023-01-01";
const place = STATION_PLACES["47893"].radar;

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Item = "pm2_5" | "dust";
const ITEMS: Item[] = ["pm2_5", "dust"];
const NAME: Record<Item, string> = { pm2_5: "PM2.5", dust: "黄砂" };

/** 日 → 24時間の値（無ければ null）。 */
const byDay: Record<Item, Map<string, (number | null)[]>> = { pm2_5: new Map(), dust: new Map() };

/** --synthetic：ネットを使わず、作った値で動きだけ確かめる（CI・手元用）。 */
function synthetic() {
  let s = 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let d = FIRST; d <= TO; d = addDays(d, 1)) {
    const spring = /-0[345]-/.test(d) ? 3 : 1;
    byDay.pm2_5.set(d, Array.from({ length: 24 }, (_, h) => 6 + 4 * Math.sin(h / 4) + 8 * rnd() * spring));
    byDay.dust.set(d, Array.from({ length: 24 }, () => (rnd() < 0.05 * spring ? 20 + 40 * rnd() : rnd() * 2)));
  }
}

async function load() {
  if (process.argv.includes("--synthetic")) return synthetic();
  let from = FIRST;
  while (from <= TO) {
    const to = addDays(from, 90) < TO ? addDays(from, 90) : TO;
    const url =
      "https://air-quality-api.open-meteo.com/v1/air-quality?" +
      `latitude=${place.lat}&longitude=${place.lon}&hourly=pm2_5,dust&start_date=${from}&end_date=${to}&timezone=Asia%2FTokyo&domains=cams_global`;
    let body: { hourly?: { time: string[]; pm2_5: (number | null)[]; dust: (number | null)[] } } | null = null;
    for (let t = 0; t < 4 && !body; t++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (r.ok) body = await r.json();
        else console.error(`HTTP ${r.status} ${from}..${to}`);
      } catch (e) {
        console.error(`${from}..${to}: ${e}`);
      }
      if (!body) await sleep(5_000 * (t + 1));
    }
    if (!body?.hourly) throw new Error(`取れなかった：${from}..${to}`);
    const h = body.hourly;
    h.time.forEach((t, i) => {
      const day = t.slice(0, 10);
      const hour = +t.slice(11, 13);
      for (const k of ITEMS) {
        if (!byDay[k].has(day)) byDay[k].set(day, Array(24).fill(null));
        byDay[k].get(day)![hour] = h[k][i] ?? null;
      }
    });
    console.error(`読んだ ${from}..${to}`);
    from = addDays(to, 1);
    await sleep(1_000);
  }
}

const vals = (k: Item, day: string) => (byDay[k].get(day) ?? []).filter((v): v is number => v != null);
const dayStat = (k: Item, day: string): number | null => {
  const v = vals(k, day);
  if (v.length < 20) return null;
  return k === "pm2_5" ? v.reduce((a, b) => a + b, 0) / v.length : Math.max(...v);
};

/** ふだんを作る日。A：直近30日、S：前の年の同じ季節（前後30日）。 */
function window(base: "A" | "S", day: string): string[] {
  if (base === "A") return Array.from({ length: 30 }, (_, i) => addDays(day, -30 + i));
  const out: string[] = [];
  const y = +day.slice(0, 4);
  for (let py = +FIRST.slice(0, 4); py < y; py++) {
    const c = `${py}${day.slice(4)}`.replace(/-02-29$/, "-02-28");
    for (let i = -30; i <= 30; i++) {
      const d = addDays(c, i);
      if (d >= FIRST && d < day) out.push(d);
    }
  }
  return out;
}

interface Judge {
  /** 評価できたか（ふだんがあるか）。 */
  ok: boolean;
  r1: boolean;
  r2: boolean;
  r3: boolean;
}

function judge(k: Item, base: "A" | "S", day: string): Judge {
  const w = window(base, day);
  const hourly = w.flatMap((d) => vals(k, d)).sort((a, b) => a - b);
  const daily = w.map((d) => dayStat(k, d)).filter((v): v is number => v != null).sort((a, b) => a - b);
  const today = byDay[k].get(day);
  const st = dayStat(k, day);
  if (hourly.length < 7 * 24 || daily.length < 7 || !today || st == null) return { ok: false, r1: false, r2: false, r3: false };
  const q = quantile(hourly, 0.9);
  const qd = quantile(daily, 0.9);
  const over = today.map((v) => v != null && v > q);
  let run = 0;
  let best = 0;
  for (const o of over) {
    run = o ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { ok: true, r1: best >= 1, r2: best >= 3, r3: st > qd };
}

const RULES = ["r1", "r2", "r3"] as const;
const RULE_NAME = { r1: "R1 1時間でも", r2: "R2 3時間続けて", r3: "R3 1日の値" };

/** 7日ずつのかたまりで並べ替えた割合の 95% の幅。 */
function blockCi(flags: boolean[], seed = 7): [number, number] {
  const B = 7;
  const blocks: boolean[][] = [];
  for (let i = 0; i < flags.length; i += B) blocks.push(flags.slice(i, i + B));
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rates: number[] = [];
  for (let r = 0; r < 1000; r++) {
    let n = 0;
    let y = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[Math.floor(rnd() * blocks.length)];
      n += b.length;
      y += b.filter(Boolean).length;
    }
    rates.push(y / n);
  }
  rates.sort((a, b) => a - b);
  return [rates[25], rates[974]];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  await load();
  const days: string[] = [];
  for (let d = FROM; d <= TO; d = addDays(d, 1)) days.push(d);
  const lines: string[] = [];
  lines.push(`# 空気の「ふだん」の比べ方（高知・CAMS 全球、${FROM}〜${TO}）`, "");
  lines.push("評価する日より前のデータだけで「ふだん」を作り、「多い」と出る日の割合を比べた。かっこは 7日ずつのかたまりで並べ替えた 95% の幅。", "");
  lines.push("- A：直近30日の1時間値（今の画面）／S：前の年の同じ季節（評価する日の前後30日）", "- R1：1時間でも 90% を超える／R2：3時間以上続けて超える／R3：1日の値（PM2.5 は日平均、黄砂は日最大）が、同じ期間の1日の値の 90% を超える", "");

  const res: Record<string, Record<string, Judge[]>> = {};
  for (const base of ["A", "S"] as const) {
    res[base] = {};
    for (const k of ITEMS) res[base][k] = days.map((d) => judge(k, base, d));
  }

  lines.push("## 出る日の割合", "", "| 項目 | ふだん | 評価できた日 | R1 | R2 | R3 |", "| --- | --- | --- | --- | --- | --- |");
  for (const k of [...ITEMS, "either"] as const) {
    for (const base of ["A", "S"] as const) {
      const js = days.map((_, i) => (k === "either" ? ITEMS.map((it) => res[base][it][i]) : [res[base][k][i]]));
      const okIdx = js.map((j) => j.every((x) => x.ok));
      const n = okIdx.filter(Boolean).length;
      const cells = RULES.map((r) => {
        const f = js.filter((_, i) => okIdx[i]).map((j) => j.some((x) => x[r]));
        if (!f.length) return "—";
        const [lo, hi] = blockCi(f);
        return `${pct(f.filter(Boolean).length / f.length)}（${pct(lo)}〜${pct(hi)}）`;
      });
      lines.push(`| ${k === "either" ? "どちらか" : NAME[k]} | ${base} | ${n} | ${cells.join(" | ")} |`);
    }
  }

  lines.push("", "## 続いている高い日の途中で消えた日", "", "前の日に出ていて、その日の1日の値が前の日以上なのに出なかった日の数（目安が上がって消えた疑い）。", "");
  lines.push("| 項目 | ふだん | R1 | R2 | R3 |", "| --- | --- | --- | --- | --- |");
  for (const k of ITEMS)
    for (const base of ["A", "S"] as const) {
      const cells = RULES.map((r) => {
        let drop = 0;
        let cont = 0;
        for (let i = 1; i < days.length; i++) {
          const a = res[base][k][i - 1];
          const b = res[base][k][i];
          const sa = dayStat(k, days[i - 1]);
          const sb = dayStat(k, days[i]);
          if (!a.ok || !b.ok || !a[r] || sa == null || sb == null || sb < sa) continue;
          cont++;
          if (!b[r]) drop++;
        }
        return `${drop}／${cont}`;
      });
      lines.push(`| ${NAME[k]} | ${base} | ${cells.join(" | ")} |`);
    }

  lines.push("", "## A と S のずれ（両方評価できた日）", "", "| 項目 | 出し方 | 両方 | A だけ | S だけ | どちらも出ない |", "| --- | --- | --- | --- | --- | --- |");
  for (const k of ITEMS)
    for (const r of RULES) {
      let both = 0, a = 0, s = 0, none = 0;
      days.forEach((_, i) => {
        const x = res.A[k][i];
        const y = res.S[k][i];
        if (!x.ok || !y.ok) return;
        if (x[r] && y[r]) both++;
        else if (x[r]) a++;
        else if (y[r]) s++;
        else none++;
      });
      lines.push(`| ${NAME[k]} | ${RULE_NAME[r]} | ${both} | ${a} | ${s} | ${none} |`);
    }

  lines.push("", "## 月ごと（どちらか、R2）", "", "| 月 | A | S |", "| --- | --- | --- |");
  const months = [...new Set(days.map((d) => d.slice(5, 7)))].sort();
  for (const m of months) {
    const cell = (base: "A" | "S") => {
      const idx = days.map((d, i) => (d.slice(5, 7) === m && ITEMS.every((k) => res[base][k][i].ok) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return "—";
      return `${pct(idx.filter((i) => ITEMS.some((k) => res[base][k][i].r2)).length / idx.length)}（${idx.length}日）`;
    };
    lines.push(`| ${+m}月 | ${cell("A")} | ${cell("S")} |`);
  }
  lines.push("", "出典：Open-Meteo Air Quality API（CC BY 4.0）、Copernicus Atmosphere Monitoring Service（CAMS 全球）。Weather Note の集計。");

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/r01-report.md`, lines.join("\n") + "\n");
  const csv = ["date,item,base,ok,r1,r2,r3,stat"];
  for (const base of ["A", "S"] as const)
    for (const k of ITEMS) days.forEach((d, i) => { const j = res[base][k][i]; csv.push([d, k, base, +j.ok, +j.r1, +j.r2, +j.r3, dayStat(k, d)?.toFixed(2) ?? ""].join(",")); });
  writeFileSync(`${OUT}/r01-days.csv`, csv.join("\n") + "\n");
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

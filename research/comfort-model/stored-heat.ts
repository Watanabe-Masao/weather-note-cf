// #86 → comfort-6: the day's stored sun at night. comfort-5 reads "the day's radiation so far"
// unfaded all night, and after midnight that is the new day's (about 0): at 0:59 a sunny day's
// full warmth, at 1:00 none. comfort-6 takes the latest daytime's total (the day before's before
// sunrise) and lets it fade with the hours since sunset, e^(−t/τ).
//
// The true fading time is not known, so we test each candidate τ against people whose true τ is
// 2, 4 or 8 hours, or who keep the warmth all night (no fading), and pick the τ that loses least
// when it is wrong. A virtual person in Kochi (synthetic.ts: μ 20 ℃ at baseline 15 ℃, h 3, g 4,
// blur 0.7) reports from 6時 to 24時, and one report in five between 0時 and 6時. What they feel
// follows the place temperature plus, in daylight under a clear sky, +1.5 ℃; after sunset,
// +0.8 ℃ per 5 MJ/m² of the latest daytime's radiation above 10, fading with their τ. Each answer
// also carries the person's own offset of that moment (sd 1 ℃). M5 fitted each way; predictions for
// 300 new moments scored (RPS), at night and in the hours after midnight separately.
//
// Run:  research/data/node_modules/.bin/vite-node research/comfort-model/stored-heat.ts   (writes stored-heat-results.md)
// Deterministic (seeded).

import { writeFileSync } from "node:fs";
import { dayEdges } from "../../shared/dayParts";
import { type Drivers, fitModel, MODELS, type Observation, placeTemp, probabilities, rps, stateOf, type Theta } from "../../src/beta/comfort";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (u: () => number) => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());

const M1 = MODELS.find((m) => m.id === "M1")!;
const M5 = MODELS.find((m) => m.id === "M5")!;
const THETA: Theta = [20, 0.33, Math.log(3), Math.log(4), Math.log(0.7), 0, 0];
const KOCHI = "47893";
const SD = 1;
const BETA = 0.8;

interface Moment {
  x: Drivers;
  sunNight: boolean;
  /** Minutes after midnight; the latest daytime's total; hours since that sunset; what comfort-5 read. */
  min: number;
  stored: number;
  since: number;
  legacyRadDay: number;
}

const dayTotal = (u: () => number, doy: number, sunny: boolean) => Math.max(1, (sunny ? 14 : 6) + 8 * Math.cos((2 * Math.PI * (doy - 172)) / 365) + 2 * gauss(u));

function momentOf(u: () => number): Moment {
  const doy = 2 + Math.floor(363 * u());
  const date = new Date(Date.UTC(2026, 0, doy)).toISOString().slice(0, 10);
  const before = new Date(Date.UTC(2026, 0, doy - 1)).toISOString().slice(0, 10);
  const e = dayEdges(date, KOCHI);
  const setBefore = dayEdges(before, KOCHI).set;
  const min = u() < 0.2 ? Math.floor(u() * 360) : 360 + Math.floor(u() * 1080);
  const a = 17 + 8 * Math.cos((2 * Math.PI * (doy - 210)) / 365);
  const sunny = u() < 0.55;
  const today = dayTotal(u, doy, sunny);
  const yesterday = dayTotal(u, doy - 1, u() < 0.55);
  const sunNight = min < e.rise || min >= e.set;
  const done = Math.max(0, Math.min(1, (min - e.rise) / (e.set - e.rise)));
  const afterMidnight = min < e.rise;
  // comfort-5 read the day's running total: before sunrise it is today's (0), except in the 0時台,
  // read as 24時 of the day before (its full total).
  const legacyRadDay = afterMidnight ? (min < 60 ? yesterday : 0) : today * done;
  const swing = 4 * Math.sin(((min / 60 - 9) / 12) * Math.PI);
  const x: Drivers = {
    e: a + (u() - 0.45) * 12 + swing,
    a,
    dT1: gauss(u) * 2,
    h7: 55 + 25 * u(),
    h1: 50 + 35 * u(),
    hNow: 45 + 40 * u(),
    v7: 1 + 3 * u(),
    sun1: 9 * u(),
    sun7: 3 + 5 * u(),
    rain1: 0,
    rain7: 5 * u(),
    sky: sunny,
    trend: (u() - 0.5) * 4,
    doy,
    radDay: legacyRadDay,
    night: sunNight,
    wind6h: 5 * u(),
    minPrev: -10 + 8 * u(),
    windPrev: 5 * u(),
    windFelt: "weak",
  };
  return {
    x,
    sunNight,
    min,
    stored: afterMidnight ? yesterday : today,
    since: afterMidnight ? (min + 1440 - setBefore) / 60 : Math.max(0, (min - e.set) / 60),
    legacyRadDay,
  };
}

type Reading = { label: string; tau: number | null; legacy?: boolean };

function read(m: Moment, r: Reading): Drivers {
  if (r.legacy) return { ...m.x, legacyRad: true };
  return { ...m.x, storedRad: m.stored, sinceSunset: m.since, radTauH: r.tau ?? Infinity };
}

function felt(m: Moment, tauTrue: number | null) {
  let e = m.x.e;
  if (!m.sunNight && m.x.sky) e += 1.5;
  if (m.sunNight) e += BETA * ((m.stored - 10) / 5) * (tauTrue == null ? 1 : Math.exp(-m.since / tauTrue));
  return e;
}

function draw(u: () => number, p: number[]) {
  let r = u();
  for (let k = 0; k < 7; k++) {
    r -= p[k];
    if (r <= 0) return k - 3;
  }
  return 3;
}
const truthProbs = (m: Moment, tau: number | null, delta: number) => {
  const x = { ...m.x, e: felt(m, tau) + delta };
  return probabilities(stateOf(M1, THETA, x), placeTemp(M1, THETA, x));
};

const READINGS: Reading[] = [
  { label: "comfort-5（その日の累計、薄れない）", tau: null, legacy: true },
  { label: "前の昼の合計・薄れない（τ = ∞）", tau: null },
  { label: "τ = 2時間", tau: 2 },
  { label: "τ = 4時間", tau: 4 },
  { label: "τ = 8時間", tau: 8 },
];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function run(n: number, tauTrue: number | null, R: number) {
  const s = READINGS.map(() => ({ all: [] as number[], night: [] as number[], late: [] as number[] }));
  for (let r = 0; r < R; r++) {
    const u = rng(6100 + 113 * r + n + (tauTrue ?? 99) * 7);
    const ms = Array.from({ length: n }, () => momentOf(u));
    const ys = ms.map((m) => draw(u, truthProbs(m, tauTrue, gauss(u) * SD)));
    const test = rng(900 + r);
    const fresh = Array.from({ length: 300 }, () => momentOf(test));
    const truths = fresh.map((m) => {
      const acc = Array(7).fill(0);
      for (let k = 0; k < 15; k++) truthProbs(m, tauTrue, gauss(test) * SD).forEach((p, i) => (acc[i] += p / 15));
      return acc;
    });
    READINGS.forEach((rd, j) => {
      const fit = fitModel(M5, ms.map((m, i): Observation => ({ ...read(m, rd), y: ys[i] })));
      const all: number[] = [];
      const night: number[] = [];
      const late: number[] = [];
      fresh.forEach((m, i) => {
        const x = read(m, rd);
        const pred = probabilities(stateOf(M5, fit.theta, x), placeTemp(M5, fit.theta, x));
        const v = truths[i].reduce((acc: number, pk: number, k: number) => acc + pk * rps(pred, k - 3), 0);
        all.push(v);
        if (m.sunNight) night.push(v);
        if (m.sunNight && m.min < 360) late.push(v);
      });
      s[j].all.push(mean(all));
      s[j].night.push(mean(night));
      s[j].late.push(mean(late));
    });
  }
  return READINGS.map((rd, j) => ({ label: rd.label, all: mean(s[j].all), night: mean(s[j].night), late: mean(s[j].late) }));
}

const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  console.log(s);
};
const R = Number(process.env.R ?? 40);
const N = 150;
log("# 夜の余熱：薄れ方と0時をまたぐ扱い（#86、comfort-6 の候補）\n");
log(`高知、約${N}件（6〜24時、5件に1件は0〜6時）、各${R}人。M5 を読み方ごとに学ばせ、新しい場面300件への予測の RPS（小さいほど良い）。「夜」は日の入り〜日の出、「0時〜日の出」はそのうち日付が変わってから。\n`);
const worst: Record<string, number> = {};
for (const [title, tau] of [
  ["本当の薄れ方 τ = 2時間", 2],
  ["本当の薄れ方 τ = 4時間", 4],
  ["本当の薄れ方 τ = 8時間", 8],
  ["本当は薄れない（一晩中同じ）", null],
] as const) {
  log(`### ${title}\n`);
  log("| 読み方 | 全体 | 夜 | 0時〜日の出 |\n| --- | --- | --- | --- |");
  const rows = run(N, tau, R);
  const best = Math.min(...rows.map((r) => r.all));
  for (const r of rows) {
    log(`| ${r.label} | ${r.all.toFixed(4)} | ${r.night.toFixed(4)} | ${r.late.toFixed(4)} |`);
    worst[r.label] = Math.max(worst[r.label] ?? 0, r.all - best);
  }
  log("");
}
log("### 外れたときの損（全体の RPS の、その場合の一番良い読み方との差の最大）\n");
log("| 読み方 | 最大の損 |\n| --- | --- |");
for (const [k, v] of Object.entries(worst)) log(`| ${k} | ${v.toFixed(4)} |`);
writeFileSync(new URL("./stored-heat-results.md", import.meta.url), out.join("\n") + "\n");

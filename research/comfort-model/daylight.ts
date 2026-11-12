// #86: night by the clock (18時–5時) against night from sunset to sunrise, and the sky driver at
// night. comfort-4 reads 17時 in December as day and 18時 in June as night, and counts a clear
// sky at night like a sunny moment. comfort-5 takes night from the sun and counts the sky in
// daylight only.
//
// A virtual person in Kochi (the person of synthetic.ts: μ 20 ℃ at baseline 15 ℃, h 3, g 4,
// blur 0.7) reports at any time from 6時 to 23時 through the year. What they feel follows the
// place temperature plus:
//   - in daylight under a clear sky: +1.5 ℃ (the sun on them);
//   - after sunset: the day's stored sun, +0.4 ℃ per 5 MJ/m² above 10 (the radNight driver);
//   - after sunset under a clear sky: case A nothing more; case B −0.7 ℃ (the sky draws heat).
// Case C has none of these (a person day and night do not matter to), to see what comfort-5 costs.
// The truth takes night from the sun: that is the premise being tested, not a result.
// Each answer also carries the person's own offset of that moment (sd 1 ℃). We fit M5 (the model
// that has the sky and the night drivers) both ways and score predictions for new moments, read
// each way, overall and around sunset (1.5 hours either side), where the clock and the sun differ.
//
// Run:  npx vite-node research/comfort-model/daylight.ts   (writes daylight-results.md here)
// Deterministic (seeded).

import { writeFileSync } from "node:fs";
import { solarTimes, stationLatLon } from "../../shared/sunTimes";
import { type Drivers, fitModel, isNight, MODELS, type Observation, placeTemp, probabilities, rps, stateOf, type Theta } from "../../src/beta/comfort";

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
const KOCHI = stationLatLon("47893")!;
const SD = 1;

interface Moment {
  x: Drivers;
  /** Minutes after midnight, the sun's times, and the truth. */
  min: number;
  rise: number;
  set: number;
  sunNight: boolean;
}

function momentOf(u: () => number): Moment {
  const doy = 1 + Math.floor(365 * u());
  const date = new Date(Date.UTC(2026, 0, doy)).toISOString().slice(0, 10);
  const { rise, set } = solarTimes(date, KOCHI.lat, KOCHI.lon);
  const min = 6 * 60 + Math.floor(u() * 17.5 * 60);
  const a = 17 + 8 * Math.cos((2 * Math.PI * (doy - 210)) / 365);
  const sunny = u() < 0.55;
  const sunNight = min < rise || min >= set;
  const dayTotal = (sunny ? 14 : 6) + 8 * Math.cos((2 * Math.PI * (doy - 172)) / 365) + 2 * gauss(u);
  const done = Math.max(0, Math.min(1, (min - rise) / (set - rise)));
  const hourOfDay = min / 60;
  const swing = 4 * Math.sin(((hourOfDay - 9) / 12) * Math.PI);
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
    radDay: Math.max(0, dayTotal * done),
    night: null,
    wind6h: 5 * u(),
    minPrev: -10 + 8 * u(),
    windPrev: 5 * u(),
    windFelt: "weak",
  };
  return { x, min, rise, set, sunNight };
}

/** The truth's place temperature: what the person actually feels at. */
interface Truth {
  daySun: number;
  stored: number;
  clearNight: number;
}
function felt(m: Moment, t: Truth) {
  const { x } = m;
  let e = x.e;
  if (!m.sunNight && x.sky) e += t.daySun;
  if (m.sunNight) e += (t.stored * ((x.radDay ?? 10) - 10)) / 5 + (x.sky ? t.clearNight : 0);
  return e;
}

/** The moment as each version reads it. */
function read(m: Moment, v: "comfort-4" | "comfort-5"): Drivers {
  if (v === "comfort-4") return { ...m.x, night: isNight(Math.floor(m.min / 60)), skyAtNight: true };
  return { ...m.x, night: m.sunNight };
}

function draw(u: () => number, p: number[]) {
  let r = u();
  for (let k = 0; k < 7; k++) {
    r -= p[k];
    if (r <= 0) return k - 3;
  }
  return 3;
}

const truthProbs = (m: Moment, t: Truth, delta: number) => {
  const x = { ...m.x, e: felt(m, t) + delta };
  return probabilities(stateOf(M1, THETA, x), placeTemp(M1, THETA, x));
};

const nearSunset = (m: Moment) => Math.abs(m.min - m.set) <= 90;

function run(n: number, truth: Truth, seed: number, R: number) {
  const score = { "comfort-4": { all: [] as number[], dusk: [] as number[], night: [] as number[] }, "comfort-5": { all: [] as number[], dusk: [] as number[], night: [] as number[] } };
  for (let r = 0; r < R; r++) {
    const u = rng(5000 + 97 * r + n + seed);
    const ms = Array.from({ length: n }, () => momentOf(u));
    const ys = ms.map((m) => draw(u, truthProbs(m, truth, gauss(u) * SD)));
    const test = rng(800 + r);
    const fresh = Array.from({ length: 300 }, () => momentOf(test));
    const truths = fresh.map((m) => {
      // The expected answer distribution over the person's offset (averaged over 15 draws).
      const acc = Array(7).fill(0);
      for (let k = 0; k < 15; k++) truthProbs(m, truth, gauss(test) * SD).forEach((p, i) => (acc[i] += p / 15));
      return acc;
    });
    for (const v of ["comfort-4", "comfort-5"] as const) {
      const obs: Observation[] = ms.map((m, i) => ({ ...read(m, v), y: ys[i] }));
      const fit = fitModel(M5, obs);
      const all: number[] = [];
      const dusk: number[] = [];
      const night: number[] = [];
      fresh.forEach((m, i) => {
        const x = read(m, v);
        const pred = probabilities(stateOf(M5, fit.theta, x), placeTemp(M5, fit.theta, x));
        const s = truths[i].reduce((acc: number, pk: number, k: number) => acc + pk * rps(pred, k - 3), 0);
        all.push(s);
        if (nearSunset(m)) dusk.push(s);
        if (m.sunNight) night.push(s);
      });
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      score[v].all.push(mean(all));
      score[v].dusk.push(mean(dusk));
      score[v].night.push(mean(night));
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const row = (v: "comfort-4" | "comfort-5") => `| ${v} | ${mean(score[v].all).toFixed(4)} | ${mean(score[v].dusk).toFixed(4)} | ${mean(score[v].night).toFixed(4)} |`;
  const better = score["comfort-5"].all.filter((s, i) => s < score["comfort-4"].all[i]).length;
  return [row("comfort-4"), row("comfort-5"), `\ncomfort-5 の方が良かった人：${better}/${R}人（全体の RPS）\n`].join("\n");
}

const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  console.log(s);
};
const R = Number(process.env.R ?? 60);
log("# 夜の決め方と、夜の晴れ（#86、comfort-5 の候補）\n");
log("高知の日の出・日の入りで、1年を通して6〜23時に記録する人。M5（晴れと夜の項目を持つモデル）を2通りに学ばせ、新しい場面300件への予測の RPS（小さいほど良い）を比べた。各" + R + "人。日の入りの前後は、日の入りの前後1.5時間（時計と太陽で昼夜が食い違いやすい時間）。\n");
for (const [title, truth, seed] of [
  ["A. 日中の晴れ +1.5℃、夜の余熱あり、夜の晴れは何もしない", { daySun: 1.5, stored: 0.4, clearNight: 0 }, 0],
  ["B. A に加えて、夜の晴れは 0.7℃ 寒く感じさせる（空への放射。comfort-5 は表せない）", { daySun: 1.5, stored: 0.4, clearNight: -0.7 }, 700],
  ["C. 昼も夜も関係ない人（晴れも余熱も効かない。comfort-5 が損をしないかの確認）", { daySun: 0, stored: 0, clearNight: 0 }, 1400],
] as const) {
  for (const n of [60, 150]) {
    log(`### ${title}・${n}件\n`);
    log("| 決まり | 全体 | 日の入りの前後 | 夜（日の入り〜日の出） |\n| --- | --- | --- | --- |");
    log(run(n, truth, seed, R));
  }
}
writeFileSync(new URL("./daylight-results.md", import.meta.url), out.join("\n") + "\n");

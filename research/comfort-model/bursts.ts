// #62 A: reports made in a row. Does counting them as independent make the model overconfident,
// and which gap should join reports into one run?
//
// A virtual person (the one of synthetic.ts: μ 20 ℃ at baseline 15 ℃, h 3, g 4, blur 0.7) whose
// answers also carry a slowly moving offset of their own — clothes, activity, how they are that
// day — a random walk back to 0 with a time scale of TAU_H hours and a spread of DELTA_SD ℃. Reports
// in a row share it, and share the weather. People report in sessions: 1–2 a day, 1–6 reports in a
// session, 5–40 minutes apart. We fit with each candidate gap and look at the 95% interval of μ
// (does it hold the truth about 95% of the time?) and at predictions for new, independent moments.
//
// Run:  npx vite-node research/comfort-model/bursts.ts   (writes bursts-results.md here)
// Deterministic (seeded).

import { writeFileSync } from "node:fs";
import { burstWeights, type Drivers, fitModel, interval, MODELS, type Observation, placeTemp, probabilities, rps, stateOf, type Theta } from "../../src/beta/comfort";

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
const THETA: Theta = [20, 0.33, Math.log(3), Math.log(4), Math.log(0.7), 0, 0];
const MU15 = 20;

const TAU_H = 3;
let DELTA_SD = 1.5;

/** The weather of one session (kept, with small moves, for its reports). */
function sessionWeather(u: () => number): Drivers {
  const doy = 1 + Math.floor(365 * u());
  const a = 17 + 8 * Math.cos((2 * Math.PI * (doy - 210)) / 365);
  return {
    e: a + (u() - 0.45) * 16,
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
    sky: u() < 0.55,
    trend: (u() - 0.5) * 4,
    doy,
    radDay: 18 * u(),
    night: false,
    wind6h: 5 * u(),
    minPrev: -10 + 8 * u(),
    windPrev: 5 * u(),
    windFelt: "weak",
  };
}

function draw(u: () => number, p: number[]) {
  let r = u();
  for (let k = 0; k < 7; k++) {
    r -= p[k];
    if (r <= 0) return k - 3;
  }
  return 3;
}

/** The answer distribution at x with the person's own offset δ (in ℃ of the place temperature). */
const probsAt = (x: Drivers, delta: number) => probabilities(stateOf(M1, THETA, x), placeTemp(M1, THETA, x) + delta);

interface Sim {
  obs: Observation[];
  times: number[];
}

/** About n reports in sessions (bursty) or one at a time (spread). */
function simulate(n: number, seed: number, bursty: boolean): Sim {
  const u = rng(seed);
  const obs: Observation[] = [];
  const times: number[] = [];
  let t = 0; // hours
  let delta = gauss(u) * DELTA_SD;
  const step = (dtH: number) => {
    const keep = Math.exp(-dtH / TAU_H);
    delta = delta * keep + Math.sqrt(1 - keep * keep) * DELTA_SD * gauss(u);
  };
  while (obs.length < n) {
    // The next session: a few hours to a day later.
    const gap = bursty ? 4 + 20 * u() : 6 + 30 * u();
    t += gap;
    step(gap);
    const x = sessionWeather(u);
    const k = bursty ? 1 + Math.floor(u() * 6) : 1;
    for (let j = 0; j < k && obs.length < n; j++) {
      if (j) {
        const dt = (5 + 35 * u()) / 60;
        t += dt;
        step(dt);
        x.e += gauss(u) * 0.3;
      }
      obs.push({ ...x, y: draw(u, probsAt(x, delta)) });
      times.push(t * 3_600_000);
    }
  }
  return { obs, times };
}

/** Expected RPS on fresh independent moments (δ drawn anew each time). */
function heldOut(fitTheta: Theta, seed: number) {
  const u = rng(seed);
  let s = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const x = sessionWeather(u);
    const pred = probabilities(stateOf(M1, fitTheta, x), placeTemp(M1, fitTheta, x));
    const delta = gauss(u) * DELTA_SD;
    const truth = probsAt(x, delta);
    s += truth.reduce((acc, pk, k) => acc + pk * rps(pred, k - 3), 0);
  }
  return s / N;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const f = (v: number, d = 2) => v.toFixed(d);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  console.log(s);
};

type Rule = { gap: number; rho: number } | null;
const label = (g: Rule) => (g == null ? "重みなし（今まで）" : `${g.gap}時間・ρ ${g.rho}`);

function run(n: number, bursty: boolean, rule: Rule, R = 100) {
  let cover = 0;
  const width: number[] = [];
  const err: number[] = [];
  const held: number[] = [];
  for (let r = 0; r < R; r++) {
    const sim = simulate(n, 7000 + 131 * r + n + (bursty ? 0 : 50_000), bursty);
    const w = rule == null ? null : burstWeights(sim.times, rule.gap, rule.rho);
    const obs = w ? sim.obs.map((o, i) => ({ ...o, w: w[i] })) : sim.obs;
    const fit = fitModel(M1, obs);
    const x15 = { ...sessionWeather(rng(1)), a: 15 };
    const [lo, hi] = interval(fit, (t) => stateOf(M1, t, x15).mu);
    if (lo <= MU15 && MU15 <= hi) cover++;
    width.push(hi - lo);
    err.push(Math.abs(stateOf(M1, fit.theta, x15).mu - MU15));
    held.push(heldOut(fit.theta, 99 + r));
  }
  return `| ${label(rule)} | ${pct(cover / R)} | ${f(mean(width), 1)} | ${f(mean(err))} | ${f(mean(held), 4)} |`;
}
const head = ["| 決まり | μ の被覆率 | μ の区間の幅（℃） | μ の誤差（℃） | 予測の RPS |", "| --- | --- | --- | --- | --- |"];

log("## 1. まとまりとみなす間隔（ρ = 1：まとまりを1件分に）\n");
log("続けて記録する人（1日1〜2回、1回に1〜6件、5〜40分おき）、約90件。\n");
log(head.join("\n"));
for (const gap of [0.5, 1, 2, 3, 6]) log(run(90, true, { gap, rho: 1 }));
log(run(90, true, null));
log("\nρ = 1 は区間が広すぎ（被覆率が95%を大きく超える）。まとまりの中の答えは、完全に同じではないため。\n");

log("## 2. まとまりの中の似かた ρ（間隔 2時間）\n");
log("まとまりの k 件を k / (1 + (k − 1)ρ) 件分として数えます（ρ = 0 は重みなし、ρ = 1 はまとまりを1件分）。その人自身のずれの広がりを変えて、どの ρ がどの場合にも正直かを見ました。\n");
for (const sd of [0.75, 1.5, 3]) {
  DELTA_SD = sd;
  for (const n of [30, 90]) {
    log(`### ずれの広がり ${sd}℃・約${n}件\n`);
    log(head.join("\n"));
    log(run(n, true, null));
    for (const rho of [0.25, 0.5, 0.75, 1]) log(run(n, true, { gap: 2, rho }));
    log("");
  }
}
DELTA_SD = 1.5;

log("## 3. 1件ずつ記録する人には影響しないこと（6〜36時間おき、約90件）\n");
log(head.join("\n"));
log(run(90, false, null));
log(run(90, false, { gap: 2, rho: 0.5 }));
log("");

writeFileSync(new URL("./bursts-results.md", import.meta.url), out.join("\n") + "\n");

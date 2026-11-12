// #35: checking the comfort model on people whose answers we made ourselves.
//
// A virtual person with a known ちょうどよい温度 (20 ℃ when the baseline is 15 ℃, moving 0.33 ℃
// per ℃ of baseline), half-range 3 ℃, outer step 4 ℃ and blur s answers under Kochi-like weather.
// We then ask: does the model recover what we put in (and are its 95% intervals right about 95%
// of the time)? Does it say "cannot tell" when it cannot (one-sided answers, a narrow range of
// temperatures, two inputs that move together, missing inputs, few answers, a person who changes)?
// And where should the provisional thresholds of the learning states be?
//
// Run:  npx vite-node research/comfort-model/synthetic.ts   (writes synthetic-results.md here)
// Deterministic (seeded), so the same code gives the same tables.

import { writeFileSync } from "node:fs";
import {
  confoundedPairs,
  drawsOf,
  type Drivers,
  fitEnsemble,
  fitModel,
  interval,
  LEARNING_RULES,
  learningFrom,
  MODELS,
  muIntervalOf,
  negLogJoint,
  type Observation,
  placeTemp,
  predictComfort,
  priorFor,
  probabilities,
  referenceProbs,
  rps,
  stateOf,
  type Theta,
} from "../../src/beta/comfort";

// ---- the virtual person and the weather ----------------------------------------------------------

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

const M = (id: string) => MODELS.find((m) => m.id === id)!;
const M1 = M("M1");
const M2 = M("M2");

interface Person {
  /** μ at baseline 15 ℃, slope per ℃ of baseline, half-range, outer step, blur. */
  mu15: number;
  slope: number;
  h: number;
  g: number;
  s: number;
}
const PERSON: Person = { mu15: 20, slope: 0.33, h: 3, g: 4, s: 0.7 };
const thetaM1 = (p: Person): Theta => [p.mu15, p.slope, Math.log(p.h), Math.log(p.g), Math.log(p.s), 0, 0];
const trueMu = (p: Person, a: number) => p.mu15 + p.slope * (a - 15);

/** One moment of Kochi-like weather (all inputs present unless asked otherwise). */
function moment(u: () => number, over: Partial<Drivers> = {}): Drivers {
  const doy = 1 + Math.floor(365 * u());
  const a = 17 + 8 * Math.cos((2 * Math.PI * (doy - 210)) / 365); // baseline: ~9 ℃ in winter, ~25 ℃ in summer
  const e = a + (u() - 0.45) * 16; // the place: up to ~7 ℃ below and ~9 ℃ above the baseline
  return {
    e,
    a,
    dT1: gauss(u) * 2,
    h7: 55 + 25 * u(),
    h1: 50 + 35 * u(),
    hNow: 45 + 40 * u(),
    v7: 1 + 3 * u(),
    sun1: 9 * u(),
    sun7: 3 + 5 * u(),
    rain1: u() < 0.3 ? 15 * u() : 0,
    rain7: 5 * u(),
    sky: u() < 0.55,
    trend: (u() - 0.5) * 4,
    doy,
    radDay: 18 * u(),
    night: u() < 0.3,
    wind6h: 5 * u(),
    minPrev: -10 + 8 * u(),
    windPrev: 5 * u(),
    windFelt: "weak",
    ...over,
  };
}

/** An answer drawn from the true model. */
function answer(u: () => number, theta: Theta, x: Drivers): number {
  const p = probabilities(stateOf(M1, theta, x), placeTemp(M1, theta, x));
  let r = u();
  for (let k = 0; k < 7; k++) {
    r -= p[k];
    if (r <= 0) return k - 3;
  }
  return 3;
}

interface Data {
  obs: Observation[];
  days: number;
}

/** n answers over days (1–3 a day), from moments made by `make`. */
function dataset(n: number, seed: number, p: Person = PERSON, make: (u: () => number, i: number) => Drivers = (u) => moment(u)): Data {
  const u = rng(seed);
  const obs: Observation[] = [];
  let days = 0;
  while (obs.length < n) {
    days += 1;
    const today = 1 + Math.floor(u() * 3);
    for (let k = 0; k < today && obs.length < n; k++) {
      const x = make(u, obs.length);
      obs.push({ ...x, y: answer(u, thetaM1(p), x) });
    }
  }
  return { obs, days };
}

/** Expected RPS of a prediction against the true answer distribution. */
const expectedRps = (pred: number[], truth: number[]) => truth.reduce((s, pk, k) => s + pk * rps(pred, k - 3), 0);
const truthProbs = (x: Drivers, p: Person = PERSON) => probabilities(stateOf(M1, thetaM1(p), x), placeTemp(M1, thetaM1(p), x));

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  console.log(s);
};

// ---- A. recovery and coverage (the true model alone) ----------------------------------------------

log("## A. 回復と区間の被覆率（真のモデル M1 だけを推定）\n");
log("仮想の人：ちょうどよい温度 20℃（基準15℃のとき、基準1℃につき0.33℃動く）、範囲の半分 3℃、外の1段 4℃、ぼやけ 0.7℃。各件数で100回、別々の答えを作って推定しました。95%区間が真の値を含む割合（被覆率）は、95%に近いほど区間が正直です。\n");
{
  const rows: (string | number)[][] = [];
  for (const n of [10, 20, 40, 80, 160, 320]) {
    const cover = { mu: 0, h: 0, s: 0, slope: 0 };
    const width: number[] = [];
    const err: number[] = [];
    const R = 100;
    for (let r = 0; r < R; r++) {
      const { obs } = dataset(n, 1000 + 97 * r + n);
      const fit = fitModel(M1, obs);
      const x15 = moment(rng(1), { a: 15 });
      const [lo, hi] = interval(fit, (t) => stateOf(M1, t, x15).mu);
      if (lo <= PERSON.mu15 && PERSON.mu15 <= hi) cover.mu++;
      width.push(hi - lo);
      err.push(Math.abs(stateOf(M1, fit.theta, x15).mu - PERSON.mu15));
      const [hl, hh] = interval(fit, (t) => t[2]);
      if (hl <= Math.log(PERSON.h) && Math.log(PERSON.h) <= hh) cover.h++;
      const [sl, sh] = interval(fit, (t) => t[4]);
      if (sl <= Math.log(PERSON.s) && Math.log(PERSON.s) <= sh) cover.s++;
      const [bl, bh] = interval(fit, (t) => t[1]);
      if (bl <= PERSON.slope && PERSON.slope <= bh) cover.slope++;
    }
    rows.push([n, pct(cover.mu / R), f(mean(width), 1), f(mean(err), 2), pct(cover.slope / R), pct(cover.h / R), pct(cover.s / R)]);
  }
  log(table(["件数", "μ の被覆率", "μ の区間の幅（℃）", "μ の誤差（℃）", "慣れの傾きの被覆率", "h の被覆率", "s の被覆率"], rows));
}

// ---- A2. is the Laplace approximation honest with few answers? --------------------------------------

log("\n### A2. 少ない件数でのラプラス近似の妥当性（重点サンプリングとの比較）\n");
log("ラプラス近似の区間を、もっと正確な事後分布（ラプラス近似の分布を2倍に広げた提案分布からの重点サンプリング、4000点）の区間と比べました。幅の比が1に近ければ、近似は正直です。\n");
{
  const rows: (string | number)[][] = [];
  for (const n of [5, 10, 20, 40]) {
    const ratios: number[] = [];
    const ess: number[] = [];
    for (let r = 0; r < 20; r++) {
      const { obs } = dataset(n, 5000 + 31 * r + n);
      const fit = fitModel(M1, obs);
      const x15 = moment(rng(1), { a: 15 });
      const [lo, hi] = interval(fit, (t) => stateOf(M1, t, x15).mu);
      // Proposal: the Laplace normal widened ×2 (drawsOf with doubled covariance).
      const wide = { ...fit, cov: fit.cov ? fit.cov.map((row) => row.map((v) => v * 4)) : null };
      const draws = drawsOf(wide, 4000, 77 + r);
      const prior = priorFor(M1);
      const L = (t: Theta) => -negLogJoint(M1, t, obs, prior);
      // log q(θ) up to a constant, via the widened covariance (Mahalanobis with its inverse).
      const cov = wide.cov ?? prior.sd.map((sd, i) => prior.sd.map((_, j) => (i === j ? 4 * sd * sd : 0)));
      const inv = invert(cov);
      const logq = (t: Theta) => {
        const d = t.map((v, i) => v - fit.theta[i]);
        let q = 0;
        for (let i = 0; i < d.length; i++) for (let j = 0; j < d.length; j++) q += d[i] * inv[i][j] * d[j];
        return -q / 2;
      };
      const lw = draws.map((t) => L(t) - logq(t));
      const top = Math.max(...lw);
      const w = lw.map((v) => Math.exp(v - top));
      const sw = w.reduce((a, b) => a + b, 0);
      ess.push(sw ** 2 / w.reduce((a, b) => a + b * b, 0));
      const mus = draws.map((t, i) => [stateOf(M1, t, x15).mu, w[i] / sw] as [number, number]).sort((a, b) => a[0] - b[0]);
      const q = (p: number) => {
        let acc = 0;
        for (const [v, ww] of mus) {
          acc += ww;
          if (acc >= p) return v;
        }
        return mus[mus.length - 1][0];
      };
      ratios.push((hi - lo) / (q(0.975) - q(0.025)));
    }
    rows.push([n, f(mean(ratios), 2), f(Math.min(...ratios), 2), f(Math.max(...ratios), 2), Math.round(mean(ess))]);
  }
  log(table(["件数", "幅の比（ラプラス／重点）平均", "最小", "最大", "有効サンプル数"], rows));
}

function invert(a: number[][]): number[][] {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let k = 0; k < 2 * n; k++) m[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fct = m[r][c];
      for (let k = 0; k < 2 * n; k++) m[r][k] -= fct * m[c][k];
    }
  }
  return m.map((row) => row.slice(n));
}

// ---- B. where the learning states should switch (all models) ----------------------------------------

log("\n## B. 学習の段階の境目（全モデルで推定）\n");
log("件数ごとに20回。学習の段階、μ の95%区間の幅（最後の記録の条件）、μ の誤差、まだ見ていない60の条件での予測の成績（RPS の期待値。小さいほど良い）を、その人の過去の答えの割合（基準）と、真の確率（下限）と比べました。\n");
interface Row {
  n: number;
  width: number;
  err: number;
  gain: number;
  state: string;
}
const rowsB: Row[] = [];
{
  const test = Array.from({ length: 300 }, (_, i) => moment(rng(900 + i)));
  const rows: (string | number)[][] = [];
  for (const n of [5, 10, 15, 20, 30, 40, 60, 80]) {
    const states: Record<string, number> = {};
    const widths: number[] = [];
    const errs: number[] = [];
    const model: number[] = [];
    const ref: number[] = [];
    const floor: number[] = [];
    for (let r = 0; r < 20; r++) {
      const { obs, days } = dataset(n, 20000 + 53 * r + n);
      const ens = fitEnsemble(obs, 0.8);
      const lv = learningFrom(obs, days, [], ens);
      states[lv.state] = (states[lv.state] ?? 0) + 1;
      const last = obs[obs.length - 1];
      const [lo, hi] = muIntervalOf(ens, last);
      const w = hi - lo;
      widths.push(w);
      const muHat = predictComfort(ens, last, 0).state.mu;
      const e = Math.abs(muHat - trueMu(PERSON, last.a));
      errs.push(e);
      const refP = referenceProbs(obs.map((o) => o.y));
      let m = 0;
      let rf = 0;
      let fl = 0;
      for (const x of test.slice(0, 60)) {
        const truth = truthProbs(x);
        m += expectedRps(predictComfort(ens, x, 0).probs, truth);
        rf += expectedRps(refP, truth);
        fl += expectedRps(truth, truth);
      }
      model.push(m / 60);
      ref.push(rf / 60);
      floor.push(fl / 60);
      rowsB.push({ n, width: w, err: e, gain: rf / 60 - m / 60, state: lv.state });
    }
    const st = Object.entries(states)
      .map(([k, v]) => `${k} ${v}`)
      .join("、");
    rows.push([n, st, f(mean(widths), 1), f(mean(errs), 2), f(mean(model), 3), f(mean(ref), 3), f(mean(floor), 3)]);
  }
  log(table(["件数", "学習の段階（20回中）", "μ の区間の幅（℃）", "μ の誤差（℃）", "RPS モデル", "RPS 基準", "RPS 真の確率"], rows));

  // How the interval width predicts the error and the gain over the reference.
  log("\n### B2. μ の区間の幅と、誤差・成績の関係（上の160回をまとめて）\n");
  const bins: [number, number][] = [
    [0, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 7],
    [7, 10],
    [10, 99],
  ];
  log(
    table(
      ["区間の幅（℃）", "回数", "μ の誤差 平均（℃）", "μ の誤差が2℃以内", "基準より良い割合"],
      bins
        .map(([a, b]) => {
          const r = rowsB.filter((x) => x.width >= a && x.width < b);
          return [`${a}〜${b === 99 ? "" : b}`, r.length, f(mean(r.map((x) => x.err)), 2), r.length ? pct(r.filter((x) => x.err <= 2).length / r.length) : "—", r.length ? pct(r.filter((x) => x.gain > 0).length / r.length) : "—"];
        })
        .filter((r) => r[1] !== 0),
    ),
  );
}

// ---- C. saying "cannot tell" when it cannot ------------------------------------------------------------

log("\n## C. 推定できない条件を、推定できないと言えるか\n");
{
  const rows: (string | number)[][] = [];
  const R = 10;
  const run = (name: string, make: (seed: number) => Data, judge: (ens: ReturnType<typeof fitEnsemble>, d: Data) => string) => {
    const results: string[] = [];
    for (let r = 0; r < R; r++) {
      const d = make(40000 + 71 * r);
      const ens = fitEnsemble(d.obs, 0.8);
      results.push(judge(ens, d));
    }
    const counts: Record<string, number> = {};
    for (const x of results) counts[x] = (counts[x] ?? 0) + 1;
    rows.push([
      name,
      Object.entries(counts)
        .map(([k, v]) => `${k} ${v}`)
        .join("、"),
    ]);
  };
  const state = (ens: ReturnType<typeof fitEnsemble>, d: Data) => learningFrom(d.obs, d.days, [], ens).state;

  run("寒い側の答えしかない（その場の温度が中心−範囲より低い条件だけ、60件）", (seed) => {
    const d = dataset(400, seed);
    const cold = d.obs.filter((o) => o.e < trueMu(PERSON, o.a) - PERSON.h).slice(0, 60);
    return { obs: cold, days: d.days };
  }, state);
  run("温度がとても狭い（その場の温度 19〜21℃、60件）", (seed) => dataset(60, seed, PERSON, (u) => moment(u, { e: 19 + 2 * u(), a: 15 + 2 * u() })), state);
  run("答えが少ない（6件）", (seed) => dataset(6, seed), state);
  run("1日に集中（40件を1日で）", (seed) => ({ ...dataset(40, seed), days: 1 }), state);
  run("入力の3割が欠けている（今の湿度・季節の向き、80件）", (seed) =>
    dataset(80, seed, PERSON, (u, i) => moment(u, i % 3 === 0 ? { hNow: null, trend: null } : {})), (ens, d) => {
    const s = state(ens, d);
    const used = ens.fits.find((ff) => ff.model.id === "M4")!.n;
    return `${s}（M4 の学習は ${used}件）`;
  });

  // Two inputs that move together: 1週間の湿度 rises and falls with the baseline (r ≈ 0.97).
  const corr: number[] = [];
  const found: number[] = [];
  for (let r = 0; r < R; r++) {
    const d = dataset(120, 60000 + 13 * r, PERSON, (u) => {
      const x = moment(u);
      return { ...x, h7: 65 + 2.5 * (x.a - 17) + gauss(u) * 0.6 };
    });
    const fit = fitModel(M2, d.obs);
    const pairs = confoundedPairs(fit);
    const hit = pairs.find(([p, q]) => (p.includes(":a") && q.includes(":h7")) || (p.includes(":h7") && q.includes(":a")));
    if (hit) found.push(1);
    const ai = 1;
    const hi = 2;
    if (fit.cov) corr.push(fit.cov[ai][hi] / Math.sqrt(fit.cov[ai][ai] * fit.cov[hi][hi]));
  }
  rows.push(["2つの入力が一緒に動く（1週間の湿度が基準とほぼ連動、M2、120件）", `「分けられない」と検出 ${found.length}/${R}（推定の相関 平均 ${f(mean(corr), 2)}）`]);

  // A person who changes: the centre moves +3 ℃ halfway.
  const bias: number[] = [];
  const drifted: string[] = [];
  for (let r = 0; r < R; r++) {
    const first = dataset(60, 70000 + 17 * r);
    const later = dataset(30, 71000 + 17 * r, { ...PERSON, mu15: PERSON.mu15 + 3 });
    const ens = fitEnsemble(first.obs, 0.8);
    // Predictions made in advance for the later answers (the model does not know the change).
    const res = later.obs.map((o) => {
      const p = predictComfort(ens, o, 0);
      return o.y - p.probs.reduce((s, v, k) => s + v * (k - 3), 0);
    });
    bias.push(mean(res));
    drifted.push(mean(res.slice(-10)) < -0.5 ? "検出" : "未検出");
  }
  // The same check on a person who did not change: how often it raises a false alarm.
  const calm: string[] = [];
  for (let r = 0; r < R; r++) {
    const first = dataset(60, 72000 + 17 * r);
    const later = dataset(30, 73000 + 17 * r);
    const ens = fitEnsemble(first.obs, 0.8);
    const res = later.obs.map((o) => o.y - predictComfort(ens, o, 0).probs.reduce((s, v, k) => s + v * (k - 3), 0));
    calm.push(Math.abs(mean(res.slice(-10))) > 0.5 ? "誤検出" : "なし");
  }
  rows.push(["（対照）本人が変わらない：同じ判定で誤って「変化」とする", `${calm.filter((x) => x === "誤検出").length}/${R}`]);
  rows.push([
    "本人が途中で変わる（中心が+3℃、変化の後の30件の事前予測）",
    `答え−予測の平均 ${f(mean(bias), 2)}段（寒い側にずれる）。直近10件の平均が −0.5段を下回る：${drifted.filter((x) => x === "検出").length}/${R}`,
  ]);
  log(table(["条件（各10回）", "結果"], rows));
}

// ---- D. a person the model does not describe exactly ------------------------------------------------

log("\n## D. モデルの形に合わない人（寒い側の段が狭く、暑い側の段が広い）\n");
log("モデルは範囲の外の段の幅を両側で同じ（g）と仮定しています。寒い側 2.5℃・暑い側 5.5℃ の人で、どこまで崩れるかを見ました（各10回）。\n");
{
  const rows: (string | number)[][] = [];
  const asym = (x: Drivers) => {
    const mu = trueMu(PERSON, x.a);
    const h = PERSON.h;
    const edges = [-h - 5, -h - 2.5, -h, h, h + 5.5, h + 11];
    const sig = (v: number) => 1 / (1 + Math.exp(-v));
    const cdf = [0, ...edges.map((c) => sig((c - (x.e - mu)) / PERSON.s)), 1];
    return Array.from({ length: 7 }, (_, k) => Math.max(1e-9, cdf[k + 1] - cdf[k]));
  };
  const test = Array.from({ length: 60 }, (_, i) => moment(rng(990 + i)));
  for (const n of [20, 60, 120]) {
    const errs: number[] = [];
    const m: number[] = [];
    const rf: number[] = [];
    const fl: number[] = [];
    const states: Record<string, number> = {};
    for (let r = 0; r < 10; r++) {
      const u = rng(80000 + 19 * r + n);
      const obs: Observation[] = [];
      let days = 0;
      while (obs.length < n) {
        days++;
        for (let k = 0; k < 1 + Math.floor(u() * 3) && obs.length < n; k++) {
          const x = moment(u);
          const p = asym(x);
          let q = u();
          let y = 3;
          for (let j = 0; j < 7; j++) {
            q -= p[j];
            if (q <= 0) {
              y = j - 3;
              break;
            }
          }
          obs.push({ ...x, y });
        }
      }
      const ens = fitEnsemble(obs, 0.8);
      const lv = learningFrom(obs, days, [], ens);
      states[lv.state] = (states[lv.state] ?? 0) + 1;
      const last = obs[obs.length - 1];
      errs.push(Math.abs(predictComfort(ens, last, 0).state.mu - trueMu(PERSON, last.a)));
      const refP = referenceProbs(obs.map((o) => o.y));
      m.push(mean(test.map((x) => expectedRps(predictComfort(ens, x, 0).probs, asym(x)))));
      rf.push(mean(test.map((x) => expectedRps(refP, asym(x)))));
      fl.push(mean(test.map((x) => expectedRps(asym(x), asym(x)))));
    }
    rows.push([n, Object.entries(states).map(([k, v]) => `${k} ${v}`).join("、"), f(mean(errs), 2), f(mean(m), 3), f(mean(rf), 3), f(mean(fl), 3)]);
  }
  log(table(["件数", "学習の段階（10回中）", "μ の誤差（℃）", "RPS モデル", "RPS 基準", "RPS 真の確率"], rows));
}

log(`\n（今の境目：温度の幅 ${LEARNING_RULES.minSpan}℃、記録した日 ${LEARNING_RULES.minDays}日、μ の区間 ${LEARNING_RULES.maxMuWidth}℃、検証用の予測 ${LEARNING_RULES.minChecked}件）`);

writeFileSync(
  new URL("./synthetic-results.md", import.meta.url),
  `# 合成データによる検証の結果（#35）\n\n\`npx vite-node research/comfort-model/synthetic.ts\` で作り直せます（乱数は固定）。考え方と結論は [README.md](README.md) と正本 [mathematical-contract.md](mathematical-contract.md) の MATH-04・05・07 にまとめています。\n\n${out.join("\n")}\n`,
);

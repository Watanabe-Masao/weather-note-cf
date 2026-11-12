// #114: the person's answers come before the model's prediction; the prediction fills in where
// there are no answers. A first check of "the day's offset" on answers we made ourselves.
//
// The model's centre μ (here M1: 慣れ only) misses whatever the person does that it has no input
// for. The offset u is that miss, read off the answers near the moment: an answer counts the more
// the nearer it is in days AND in the state of being used to the season (the 1-month mean), so a
// winter "寒い at 15" says little about summer (渡辺さん, 2026-11-13). Gaussian-process form:
//
//   residual of answer i (℃):  r_i = (E_i − μ̂_i) − mid(y_i)       (μ_true ≈ μ̂ + r)
//   mid(y): where in E − μ the answer y sits: 0, ±(h + g/2), ±(h + 1.5g), ±(h + 2.5g)
//   û(x*) = k*ᵀ (K + σ_r² I)⁻¹ r,   k(i, j) = σ_u² · exp(−|Δdays| / ℓ_t) · exp(−Δa² / (2 ℓ_a²))
//
// Each answer is predicted from the earlier answers only (MATH-06), and scored by RPS against the
// true answer probabilities (expected RPS), so no method can look good by seeing the answer.
// The kernel's sizes are chosen by the evidence of the recent residuals at each refit.
//
// Run:  research/data/node_modules/.bin/vite-node research/comfort-model/local-offset.ts
//       (writes local-offset-results.md here). Deterministic (seeded).

import { writeFileSync } from "node:fs";
import { type Drivers, fitModel, MODELS, type Observation, placeTemp, probabilities, rps, stateOf, type Theta } from "../../src/beta/comfort";

const M1 = MODELS.find((m) => m.id === "M1")!;

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

// ---- the people: what the model knows (μ by 慣れ) plus what it does not --------------------------

interface Scenario {
  name: string;
  note: string;
  /** The true centre at day t with 1-month mean a. */
  mu: (t: number, a: number, drift: number) => number;
}
const BASE = (a: number) => 20 + 0.33 * (a - 15);
const SCENARIOS: Scenario[] = [
  { name: "モデルどおりの人", note: "ずれなし（u が要らない人で、悪くならないか）", mu: (_t, a) => BASE(a) },
  { name: "ゆっくり変わる人", note: "2週間ほどの時間で ±2℃ ほど動くずれ（服装・体調・生活の変化）", mu: (_t, a, d) => BASE(a) + d },
  { name: "季節で慣れ方が違う人", note: "慣れの傾きが 0.6（モデルの事前は 0.33）。冬と夏でずれの向きが逆", mu: (_t, a) => 20 + 0.6 * (a - 15) },
  { name: "冬だけ寒がり", note: "1か月の平均が 12℃ より下のときだけ +2.5℃", mu: (_t, a) => BASE(a) + (a < 12 ? 2.5 : 0) },
];
const H = 3, G = 4, S = 0.7;
const trueTheta = (mu: number): Theta => [mu, 0, Math.log(H), Math.log(G), Math.log(S), 0, 0];

interface Point {
  x: Drivers;
  day: number;
  truth: number[];
  y: number;
}

/** A year and a half of answers: on 60% of days, 1–3 answers. a: the 1-month mean (Kochi-like). */
function timeline(sc: Scenario, seed: number): Point[] {
  const u = rng(seed);
  const pts: Point[] = [];
  let drift = 0;
  for (let day = 0; day < 540; day++) {
    drift = drift * Math.exp(-1 / 14) + gauss(u) * 2 * Math.sqrt(1 - Math.exp(-2 / 14)); // AR(1), τ 14 days, sd 2
    if (u() > 0.6) continue;
    const doy = (day + 300) % 365; // start in late October
    const a = 17 + 8 * Math.cos((2 * Math.PI * (doy - 210)) / 365);
    const n = 1 + Math.floor(u() * 3);
    for (let k = 0; k < n; k++) {
      const e = a + (u() - 0.45) * 16;
      const x = { e, a, doy, windFelt: "weak" } as unknown as Drivers;
      const mu = sc.mu(day, a, drift);
      const truth = probabilities(stateOf(M1, trueTheta(mu), x), placeTemp(M1, trueTheta(mu), x));
      let r = u(), y = 3;
      for (let j = 0; j < 7; j++) if ((r -= truth[j]) <= 0) { y = j - 3; break; }
      pts.push({ x, day, truth, y });
    }
  }
  return pts;
}

// ---- the offset --------------------------------------------------------------------------------

interface Kernel { lt: number; la: number; su: number; sr: number }
/** The methods: none, distance by days only, by days and the state of being used to the season. */
const METHODS: Record<string, null | { state: boolean }> = { "なし（今のモデル）": null, "日数だけ": { state: false }, "日数＋慣れの状態": { state: true } };

const midOf = (y: number, h: number, g: number) => (y === 0 ? 0 : Math.sign(y) * (h + (Math.abs(y) - 0.5) * g));

/** Cholesky of a symmetric positive definite matrix (lower). */
function chol(A: number[][]): number[][] | null {
  const n = A.length, L = A.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  return L;
}
/** Solves L Lᵀ x = b. */
function cholSolve(L: number[][], b: number[]): number[] {
  const n = b.length, y = new Array(n).fill(0), x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

const WINDOW = 120;
const kernOf = (k: Kernel) => (a: Point, b: Point) =>
  k.su ** 2 * Math.exp(-Math.abs(a.day - b.day) / k.lt) * (Number.isFinite(k.la) ? Math.exp(-((a.x.a - b.x.a) ** 2) / (2 * k.la ** 2)) : 1);
const residuals = (pts: Point[], theta: Theta) =>
  pts.map((q) => {
    const st = stateOf(M1, theta, q.x);
    return placeTemp(M1, theta, q.x) - st.mu - midOf(q.y, st.h, st.g);
  });

/** The kernel's sizes chosen by the evidence of the recent residuals (log marginal likelihood). */
function chooseKernel(past: Point[], theta: Theta, useState: boolean): Kernel {
  const near = past.slice(-WINDOW), r = residuals(near, theta);
  let best: Kernel = { lt: 10, la: useState ? 3 : Infinity, su: 0, sr: 2.5 }, bestLl = -Infinity;
  for (const su of [0, 0.25, 0.5, 1, 1.5, 2.5]) // 0: no offset at all (it must be choosable, review 2026-11-13)
    for (const lt of [5, 15, 45, 150])
      for (const sr of [2, 2.5, 3.5])
        for (const la of useState ? [2, 4, 8] : [Infinity]) {
          const k: Kernel = { lt, la, su, sr }, kern = kernOf(k);
          const L = chol(near.map((a, i) => near.map((b, j) => kern(a, b) + (i === j ? sr ** 2 : 0))));
          if (!L) continue;
          const al = cholSolve(L, r);
          const ll = -0.5 * r.reduce((s, v, i) => s + v * al[i], 0) - L.reduce((s, row, i) => s + Math.log(row[i]), 0);
          if (ll > bestLl) [bestLl, best] = [ll, k];
        }
  return best;
}

/** û at `p` from the earlier points (the WINDOW latest, to keep it small). */
function offsetAt(p: Point, past: Point[], theta: Theta, k: Kernel): number {
  const near = past.slice(-WINDOW);
  if (!near.length) return 0;
  const kern = kernOf(k);
  const L = chol(near.map((a, i) => near.map((b, j) => kern(a, b) + (i === j ? k.sr ** 2 : 0))));
  if (!L) return 0;
  const alpha = cholSolve(L, residuals(near, theta));
  return near.reduce((s, q, i) => s + kern(p, q) * alpha[i], 0);
}

const expectedRps = (pred: number[], truth: number[]) => truth.reduce((s, pk, j) => s + pk * rps(pred, j - 3), 0);

// ---- run ---------------------------------------------------------------------------------------

const out: string[] = [
  "# その日のずれ（#114）：答えの近さで予測を補う、最初の確認",
  "",
  "作った答えでの確認です。各答えを、それより前の答えだけで予測し、真の答えの確率に対する RPS（小さいほど良い）の平均で比べます。基のモデルは M1（慣れだけ）を20件ごとに学び直し。ずれ u は、近い答え（直近120件）の「予測からの外れ」をガウス過程で平均したもの。u の大きさ・日数の長さ・慣れの状態の長さ・1件の答えのぶれは、学び直しのたびに証拠（周辺尤度）で選ぶ（u が要らない人では小さく選ばれるはず）。最初の30件は比べない。各4回の平均。",
  "",
  `| 人 | ${Object.keys(METHODS).join(" | ")} | 説明 |`,
  `|---|${Object.keys(METHODS).map(() => "---").join("|")}|---|`,
];
const chosen: string[] = [];
const fmtK = (k: Kernel) => `u ${k.su}℃・${k.lt}日${Number.isFinite(k.la) ? `・慣れ ${k.la}℃` : ""}・ぶれ ${k.sr}℃`;
for (const sc of SCENARIOS) {
  const sums: Record<string, number> = {};
  let count = 0;
  for (let rep = 0; rep < 4; rep++) {
    const pts = timeline(sc, 11 + 101 * rep + sc.name.length);
    let theta: Theta | null = null;
    let kernels: Record<string, Kernel> = {};
    for (let i = 30; i < pts.length; i++) {
      if (!theta || i % 20 === 0) {
        theta = fitModel(M1, pts.slice(0, i).map((p): Observation => ({ ...p.x, y: p.y }))).theta;
        kernels = { 日数だけ: chooseKernel(pts.slice(0, i), theta, false), "日数＋慣れの状態": chooseKernel(pts.slice(0, i), theta, true) };
        if (rep === 0 && i % 100 === 0) chosen.push(`${sc.name} ${i}件：日数だけ ${fmtK(kernels["日数だけ"])}／日数＋慣れ ${fmtK(kernels["日数＋慣れの状態"])}`);
      }
      const p = pts[i];
      for (const [name, m] of Object.entries(METHODS)) {
        const st = stateOf(M1, theta, p.x);
        const off = m ? offsetAt(p, pts.slice(0, i), theta, kernels[name]) : 0;
        const pred = probabilities({ ...st, mu: st.mu + off }, placeTemp(M1, theta, p.x));
        sums[name] = (sums[name] ?? 0) + expectedRps(pred, p.truth);
      }
      count++;
    }
  }
  const base = sums["なし（今のモデル）"] / count;
  const cells = Object.keys(METHODS).map((n) => {
    const v = sums[n] / count;
    return n === "なし（今のモデル）" ? v.toFixed(3) : `${v.toFixed(3)}（${((1 - v / base) * 100).toFixed(1)}%）`;
  });
  out.push(`| ${sc.name} | ${cells.join(" | ")} | ${sc.note} |`);
  console.log(sc.name, cells.join(" "));
}
out.push(
  "",
  "（ ）は今のモデルに対する RPS の改善。",
  "",
  "## 見えたこと",
  "",
  "- モデルが知らない、ゆっくりしたずれがある人では、近い答えで補うと RPS が約25%良くなる（答えが予測より優先される形が効く）。",
  "- ずれのない人・慣れの傾きが違うだけの人では、ほぼ変わらない（証拠で u が 0 か小さく選ばれ、悪くしない）。慣れの傾きの違いは、基のモデルの学習が受け持つ。u の候補に 0（ずれなし）を入れた（2026-11-13 のレビュー）。100件目以降はほぼ 0 が選ばれるが、ずれのない人での −0.6% はほとんど変わらなかった：残りは記録の少ない初め（30〜100件）に証拠が小さな u を選ぶ分。初めのうちは u を使わない（件数の下限を置く）案を、採用前に比べる。",
  "- 冬だけ寒がりの人では少しだけ良くなる（2〜3%）。",
  "- 「日数だけ」と「日数＋慣れの状態」の差は、この作った答えでは出ない。直近120件だけを使うので、その中では慣れの状態がほとんど変わらないため。慣れの状態の距離が効くのは、離れた季節の答えも使うとき（1年分の記録がたまってから）で、そこで改めて比べる。",
  "- 選ばれる日数の長さは件数ごとに揺れる（5〜150日）。答えが少ないうちは証拠で決めきれないため。採用前に、長さを固定した場合と比べる（#117 の決まりで）。",
  "- まだ作った答えだけ。同意した記録で、答えを見る前の予測の当たり方で比べてから採用を決める（D10）。",
  "",
  "## 選ばれた大きさ（1回目、100件ごと）",
  "",
  ...chosen.map((c) => `- ${c}`));
writeFileSync(new URL("./local-offset-results.md", import.meta.url), out.join("\n") + "\n");

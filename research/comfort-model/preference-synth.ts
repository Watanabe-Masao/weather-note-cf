// #63 P5 (#68): the preference models (MATH-09, src/beta/preferenceModel.ts) on people whose
// answers we made ourselves. Does the model recover the index? Are its intervals honest? When may
// an index be shown? Does a half-life help a person who changes? How much does the feeling of the
// same report add (reported apart from the prediction made before)?
//
// Run:  npx vite-node research/comfort-model/preference-synth.ts   (writes preference-synth-results.md)
// Deterministic (seeded).

import { writeFileSync } from "node:fs";
import { fitPreference, type PrefObs, predictPreference, prefProbs, prefRps, PREF_RULES, preferenceLearning } from "../../src/beta/preferenceModel";
import type { PreferenceScore } from "../../src/beta/preference";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (u: () => number) => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
const DAY = 86_400_000;

/** A virtual person: the true coefficients of the weather-only model (−1 side, then +1 side). */
type Truth = (e: number, a: number, day: number) => [number, number, number];
/** Wants warm drinks below ~17 ℃ and cold ones above ~23 ℃ (place temperature), a little more so after warm weeks. */
const TYPICAL: Truth = (e, a) => prefProbs([-0.4, 1.8, -0.3, -0.4, -1.8, 0.3], [1, (e - 20) / 5, (a - 15) / 5]);
/** No relation to the weather: "either" most of the time. */
const FLAT: Truth = () => [0.2, 0.6, 0.2];
/** Changes after day 30: the same person, 4 ℃ warmer in what they want. */
const CHANGES: Truth = (e, a, day) => TYPICAL(day < 30 ? e : e - 4, a, day);

function draw(u: () => number, p: [number, number, number]): PreferenceScore {
  const r = u();
  return r < p[0] ? -1 : r < p[0] + p[1] ? 0 : 1;
}

/** n answers, one or two a day (spread, so the weights for runs do not enter here). */
function dataset(n: number, seed: number, truth: Truth): PrefObs[] {
  const u = rng(seed);
  const out: PrefObs[] = [];
  for (let i = 0; i < n; i++) {
    const day = Math.floor(i / 1.5);
    const a = 15 + 6 * Math.sin((2 * Math.PI * day) / 180) + gauss(u);
    const e = a + (u() - 0.45) * 16;
    const p = truth(e, a, day);
    const k = draw(u, p);
    // The feeling of the same report: warmer places feel warmer (−3…+3), loosely.
    const y = Math.max(-3, Math.min(3, Math.round((e - 20) / 3 + gauss(u) * 0.8)));
    out.push({ e, a, y, k, t: day * DAY, w: 1 });
  }
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  console.log(s);
};
const row = (cells: (string | number)[]) => log(`| ${cells.join(" | ")} |`);
const head = (cells: string[]) => {
  row(cells);
  row(cells.map(() => "---"));
};

const R = 100;
const TEMPS = [12, 20, 28];
const now = (obs: PrefObs[]) => obs[obs.length - 1].t;

log("# 温熱選好・飲料選好のモデルの検証（#63 P5、合成データ）\n");
log("仮想の人：場所の温度 E′ が約17℃より低いと温かい飲み物、約23℃より高いと冷たい飲み物を選びやすい（その間は「どちらでもよい」が多い）。各条件100人。指数は P(+1) − P(−1)（D13）。\n");

// ---- A. recovery, coverage, and when an index may be shown ------------------------------------------
log("## A. 件数ごとの、指数の誤差・区間の被覆率・表示してよいか\n");
log("E′ = 12・20・28℃ での指数について。被覆率は、95%区間が本当の指数を含む割合。表示は PREF_RULES（重み付き件数・2種類以上の答え・温度の幅・指数の区間の幅）を満たした割合。\n");
head(["件数", "指数の誤差（平均）", "被覆率", "区間の幅", "表示の条件を満たす", "満たしたときの誤差"]);
for (const n of [5, 10, 20, 40, 80]) {
  const err: number[] = [];
  const width: number[] = [];
  const shownErr: number[] = [];
  let cover = 0;
  let total = 0;
  let shown = 0;
  for (let r = 0; r < R; r++) {
    const obs = dataset(n, 100 + 37 * r + n, TYPICAL);
    const fit = fitPreference(obs, { withFeeling: false, halfLifeDays: null, now: now(obs) });
    // Shown when the rule holds at the middle temperature.
    const mid = predictPreference(fit, { e: 20, a: 15 }, 100);
    const show = preferenceLearning(obs, fit, mid).show;
    if (show) shown++;
    for (const e of TEMPS) {
      const p = predictPreference(fit, { e, a: 15 }, 100);
      const t = TYPICAL(e, 15, 0);
      const ti = t[2] - t[0];
      err.push(Math.abs(p.index - ti));
      width.push(p.indexInterval[1] - p.indexInterval[0]);
      if (p.indexInterval[0] <= ti && ti <= p.indexInterval[1]) cover++;
      total++;
      if (show) shownErr.push(Math.abs(p.index - ti));
    }
  }
  row([n, f(mean(err)), pct(cover / total), f(mean(width)), pct(shown / R), f(mean(shownErr))]);
}

// ---- B. a person with no relation ------------------------------------------------------------------------
log("\n## B. 天気と関係のない人（「どちらでもよい」が6割、ほかが2割ずつ）\n");
log("本当の指数はどの温度でも0。区間が0を含む割合（含めば「傾きなし」と正しく言える）。\n");
head(["件数", "指数の平均（E′ 12 / 28℃）", "区間が0を含む", "表示の条件を満たす"]);
for (const n of [20, 40, 80]) {
  let zero = 0;
  let total = 0;
  let shown = 0;
  const lo: number[] = [];
  const hi: number[] = [];
  for (let r = 0; r < R; r++) {
    const obs = dataset(n, 9000 + 41 * r + n, FLAT);
    const fit = fitPreference(obs, { withFeeling: false, halfLifeDays: null, now: now(obs) });
    if (preferenceLearning(obs, fit, predictPreference(fit, { e: 20, a: 15 }, 100)).show) shown++;
    for (const e of [12, 28]) {
      const p = predictPreference(fit, { e, a: 15 }, 100);
      (e === 12 ? lo : hi).push(p.index);
      if (p.indexInterval[0] <= 0 && 0 <= p.indexInterval[1]) zero++;
      total++;
    }
  }
  row([n, `${f(mean(lo))} / ${f(mean(hi))}`, pct(zero / total), pct(shown / R)]);
}

// ---- C. before vs with the feeling -----------------------------------------------------------------------
log("\n## C. 回答前の予測と、同じ記録の温冷感を使う予測（別々に評価する）\n");
log("後半の答えを、前半だけで学んだモデルで予測した RPS（小さいほどよい）。基準は前半の答えの割合。温冷感を使う予測は、答えた後にしかできないので、回答前の成績としては扱わない。\n");
head(["件数（前半）", "基準", "回答前（天気だけ）", "温冷感も使う"]);
for (const n of [20, 40, 80]) {
  const ref: number[] = [];
  const before: number[] = [];
  const withY: number[] = [];
  for (let r = 0; r < R; r++) {
    const obs = dataset(2 * n, 20_000 + 53 * r + n, TYPICAL);
    const train = obs.slice(0, n);
    const test = obs.slice(n);
    const freq = [-1, 0, 1].map((k) => (train.filter((o) => o.k === k).length + 1) / (train.length + 3)) as [number, number, number];
    const fb = fitPreference(train, { withFeeling: false, halfLifeDays: null, now: now(train) });
    const fy = fitPreference(train, { withFeeling: true, halfLifeDays: null, now: now(train) });
    for (const o of test.slice(0, 20)) {
      ref.push(prefRps(freq, o.k));
      before.push(prefRps(predictPreference(fb, o, 60).probs, o.k));
      withY.push(prefRps(predictPreference(fy, o, 60).probs, o.k));
    }
  }
  row([n, f(mean(ref), 3), f(mean(before), 3), f(mean(withY), 3)]);
}

// ---- D. a person who changes: half-life ----------------------------------------------------------------
log("\n## D. 変わる人と半減期（30日目から、望む温度が4℃暖かい側へ）\n");
log("60日ぶん（約90件）で学び、その後の答えを予測した RPS。変わらない人（典型）で損をしないかも見る。\n");
head(["半減期", "変わる人の RPS", "変わらない人の RPS"]);
for (const hl of [null, 60, 30, 14]) {
  const ch: number[] = [];
  const st: number[] = [];
  for (let r = 0; r < R; r++) {
    for (const [truth, sink] of [
      [CHANGES, ch],
      [TYPICAL, st],
    ] as const) {
      const obs = dataset(110, 40_000 + 61 * r, truth);
      const train = obs.slice(0, 90);
      const test = obs.slice(90);
      const fit = fitPreference(train, { withFeeling: false, halfLifeDays: hl, now: now(train) });
      for (const o of test) {
        const t = truth(o.e, o.a, 70);
        const p = predictPreference(fit, o, 60).probs;
        sink.push(t.reduce((s, pk, i) => s + pk * prefRps(p, (i - 1) as PreferenceScore), 0));
      }
    }
  }
  row([hl == null ? "なし（同じ重み）" : `${hl}日`, f(mean(ch), 4), f(mean(st), 4)]);
}

log(`\n今の境目（PREF_RULES）：学習・評価は重み付き ${PREF_RULES.minFitEff}件分以上と2種類以上の答え、表示は ${PREF_RULES.minShowEff}件分以上・温度の幅 ${PREF_RULES.minSpan}℃以上・指数の95%区間の幅 ${PREF_RULES.maxIndexWidth} 以下。`);

writeFileSync(new URL("./preference-synth-results.md", import.meta.url), out.join("\n") + "\n");

// #117: the checks of src/beta/engine/diagnostics.ts on answers we made ourselves, where we know
// what is broken — do they find it, and only it?
//
// The made-up person: centre 20 + 0.33·(最近の基準 − 15) − 0.5·(前日の変化) (M3 can learn it, M1
// cannot), and a base-layer fault: they feel 0.5 colder per m/s of wind above 3 than the app's 肌感
// says (no model can learn it: the wind is not one of the β inputs).
//   1. M1 against M3, each answer predicted from the earlier ones only, the difference with the
//      day-block interval, and MATH-08's rule.
//   2. M3's surrogate residuals against 10 variables (wind, hour, the β inputs, and 5 with nothing
//      in them), slopes, and the false discovery rate: only the wind should stand.
//   3. M3's PIT histogram (flat if its predictions are right).
//
// Run:  research/data/node_modules/.bin/vite-node research/comfort-model/diagnostics-demo.ts
//       (writes diagnostics-demo-results.md here). Deterministic (seeded).

import { writeFileSync } from "node:fs";
import { type Drivers, fitModel, MODELS, type Observation, placeTemp, probabilities, rps, stateOf, type Theta } from "../../src/beta/comfort";
import { adoptionCheck, falseDiscovery, type Pair, pairedDifference, pitHistogram, randomizedPit, residualSlope, seeded, surrogateResidual } from "../../src/beta/engine/diagnostics";

const M1 = MODELS.find((m) => m.id === "M1")!;
const M3 = MODELS.find((m) => m.id === "M3")!;
const r = seeded(17);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
const logit = () => { const u = Math.min(1 - 1e-9, Math.max(1e-9, r())); return Math.log(u / (1 - u)); };

interface Rec { x: Drivers; y: number; day: string; wind: number; hour: number; noise: number[] }
const recs: Rec[] = [];
for (let d = 0; d < 220; d++) {
  if (r() > 0.7) continue;
  const doy = (d + 200) % 365;
  const a = 17 + 8 * Math.cos((2 * Math.PI * (doy - 210)) / 365);
  const dT1 = gauss() * 2.5;
  const day = new Date(Date.UTC(2026, 6, 20 + d)).toISOString().slice(0, 10);
  const n = 1 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const hour = 7 + Math.floor(r() * 15);
    const wind = Math.max(0, 3 + gauss() * 1.8);
    const e = a + dT1 + (r() - 0.45) * 14;
    const x = { e, a, dT1, h1: 60 + gauss() * 10, sun1: r() * 10, rain1: r() < 0.3 ? r() * 20 : 0, hNow: 60, v7: 2 + r() * 2, windFelt: "weak" } as unknown as Drivers;
    const mu = 20 + 0.33 * (a - 15) - 0.5 * dT1;
    const felt = e - 0.5 * (wind - 3);
    const z = felt - mu + 0.7 * logit();
    const y = [-10, -7, -3, 3, 7, 10].filter((b) => z > b).length - 3;
    recs.push({ x, y, day, wind, hour, noise: Array.from({ length: 5 }, () => r()) });
  }
}

// 1. one step ahead, both models, refitted every 10 answers.
const START = 30;
const pairs: Pair[] = [];
const res3: number[] = [], pits3: number[] = [];
let t1: Theta | null = null, t3: Theta | null = null;
for (let i = START; i < recs.length; i++) {
  if (!t1 || i % 10 === 0) {
    const obs = recs.slice(0, i).map((q): Observation => ({ ...q.x, y: q.y }));
    t1 = fitModel(M1, obs).theta;
    t3 = fitModel(M3, obs).theta;
  }
  const q = recs[i];
  const p1 = probabilities(stateOf(M1, t1, q.x), placeTemp(M1, t1, q.x));
  const p3 = probabilities(stateOf(M3, t3!, q.x), placeTemp(M3, t3!, q.x));
  pairs.push({ day: q.day, a: rps(p1, q.y), b: rps(p3, q.y) });
  res3.push(surrogateResidual(p3, q.y, r()));
  pits3.push(randomizedPit(p3, q.y, r()));
}
const diff = pairedDifference(pairs, 4000, 3)!;
const aOf = recs.slice(START).map((q) => q.x.a);
const check = adoptionCheck({ diff, seasonal: false, seasonMin: Math.min(...aOf), seasonMax: Math.max(...aOf) });
const flat = pairedDifference(pairs.map((p, i) => ({ ...p, day: String(i) })), 4000, 3)!;

// 2. residuals against variables.
const tested = recs.slice(START);
const vars: [string, number[]][] = [
  ["風（観測所）", tested.map((q) => q.wind)],
  ["時刻", tested.map((q) => q.hour)],
  ["最近の基準", tested.map((q) => q.x.a)],
  ["前日の変化", tested.map((q) => q.x.dT1!)],
  ["前日の湿度", tested.map((q) => q.x.h1!)],
  ...Array.from({ length: 5 }, (_, k): [string, number[]] => [`何もない変数 ${k + 1}`, tested.map((q) => q.noise[k])]),
];
const slopes = vars.map(([, x]) => residualSlope(x, res3)!);
const keep = falseDiscovery(slopes.map((s) => s.p), 0.1);
const raw = slopes.filter((s) => s.p < 0.05).length;

const f3 = (v: number) => v.toFixed(3), f4 = (v: number) => v.toFixed(4);
const out = [
  "# 検証の基盤（#117）を、作った答えで確かめる",
  "",
  `作った人：中心は慣れと前日の変化で動く（M3 は学べる、M1 は学べない）。さらに土台の故障として、風が 3 m/s を超えると 1 m/s ごとに 0.5 寒く感じる（β の入力に風はないので、どのモデルも学べない）。${recs.length} 件、${new Set(recs.map((q) => q.day)).size} 日。最初の ${START} 件は比べない。`,
  "",
  "## 1. M1 と M3 を同じ答えで比べる（答えを見る前の予測、時間の順に1歩先）",
  "",
  `| 件数 | 日数 | RPS の差（M1 − M3） | 95%区間（日単位のブロック） | 95%区間（1件ずつ、参考） |`,
  `|---|---|---|---|---|`,
  `| ${diff.n} | ${diff.days} | ${f4(diff.mean)} | ${f4(diff.lo)}〜${f4(diff.hi)} | ${f4(flat.lo)}〜${f4(flat.hi)} |`,
  "",
  `MATH-08 の決まり：${check.ok ? "満たす（M3 の方が良いと言える）" : `満たさない（${check.reasons.join("、")}）`}。日単位の区間の幅は、1件ずつ引き直した場合の ${((diff.hi - diff.lo) / (flat.hi - flat.lo)).toFixed(2)} 倍。この作った人には「その日のずれ」がないので差は小さい。実際の答えでは同じ日の答えが似る（天気・気分）ので、日単位の方が広く出る（tests：日のずれがあると 1.4 倍以上）。`,
  "",
  "## 2. M3 の外れ（surrogate residual）と変数の傾き",
  "",
  "| 変数 | 傾き | p | 偽発見率 10% で残る |",
  "|---|---|---|---|",
  ...vars.map(([name], i) => `| ${name} | ${f3(slopes[i].slope)} | ${slopes[i].p < 1e-4 ? "<0.0001" : f4(slopes[i].p)} | ${keep[i] ? "残る" : "—"} |`),
  "",
  `p < 0.05 だけで選ぶと ${raw} 個、偽発見率で調整すると ${keep.filter(Boolean).length} 個。風の傾きは負（風が強いほど、予測より寒く感じる）で、土台（風の換算）の故障を指す。β の変数（前日の変化）は M3 が学んでいるので平ら。`,
  "",
  "## 3. M3 の PIT（10区間、平らなら予測の確率が正しい）",
  "",
  `| ${Array.from({ length: 10 }, (_, k) => `${k / 10}–`).join(" | ")} |`,
  `|${Array(10).fill("---").join("|")}|`,
  `| ${pitHistogram(pits3, 10).join(" | ")} |`,
  "",
  "風の故障の分だけ、端の区間が少し多い。",
  "",
  "## 試していて見つかったこと",
  "",
  "- 最初の試算では、M3 が事前分布のまま（学習ゼロ）で M1 より悪く出た。M3 は幅に「1週間の気温の振れ」を使うので、その入力がない記録はすべて学習から外れ、使える記録がなかった。`fitModel` は使える記録が 0 件でも何も言わずに事前分布を返す。実際のアプリでも、入力の欠けたモデルは黙って外れる（#117 の「記録ごとの入力の品質」）。検証の画面には、モデルごとに学習に使えた件数を必ず出す。",
];
writeFileSync(new URL("./diagnostics-demo-results.md", import.meta.url), out.join("\n") + "\n");
console.log(out.join("\n"));

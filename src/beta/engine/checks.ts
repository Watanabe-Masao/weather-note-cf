// #117/#118: the checks of diagnostics.ts on the person's own reports, for the 計算の根拠 sheet.
// Every number here is from the predictions as they were made at sending (MATH-06): nothing is
// refitted to look better afterwards.

import { type Report, SCALE_VERSION } from "../reports";
import { falseDiscovery, type PairedDifference, pairedDifference, pitHistogram, randomizedPit, residualSlope, seeded, type Slope, surrogateResidual } from "./diagnostics";
import { rps } from "./evaluation";
import { PRIOR, type Prior, priorFor, probabilities, stateOf } from "./model";
import { type Ensemble } from "./ensemble";
import { fitModel } from "./estimation";
import { observationsOf, placeTempOf } from "./observations";

/** The variables checked against the residuals, fixed in advance (MATH-08: not a fishing list). */
export const CHECKED = [
  { key: "wind", label: "風（観測所）", unit: "m/s", layer: "土台" },
  { key: "sunshine", label: "日照（その時間）", unit: "時間", layer: "土台" },
  { key: "humidity", label: "湿度", unit: "%", layer: "土台" },
  { key: "hour", label: "時刻", unit: "時", layer: "土台" },
  { key: "a", label: "最近の基準", unit: "℃", layer: "β" },
] as const;
type Key = (typeof CHECKED)[number]["key"];

/** Answers per period in the time series. */
export const PERIOD = 10;

/** Fewer answers than this, and a slope is not judged. */
export const MIN_FOR_SLOPE = 20;

export interface SlopeCheck {
  key: Key;
  label: string;
  unit: string;
  layer: string;
  slope: Slope | null;
  /** Stands at a false discovery rate of 10% among the variables checked. */
  flagged: boolean;
}

export interface Checks {
  /** Reports judged (same answer words, with the prediction made at sending). */
  n: number;
  /** β's starting point (the prior, nothing learned; its ちょうどよい is 従来版's, its outer steps not yet: #111) against β, on the same answers. */
  base: { n: number; rpsBase: number; rpsBeta: number; diff: PairedDifference | null } | null;
  /** PIT of β's predictions in 10 bins (flat if the probabilities are right). */
  pit: number[];
  /** Mean surrogate residual (+: felt warmer than predicted). */
  residualMean: number | null;
  slopes: SlopeCheck[];
  /** β against the starting point per 10 answers, with the day-block interval (a few answers: wide). */
  periods: { from: string; to: string; diff: PairedDifference }[];
  /** Running sum of the surrogate residuals in time order (a sustained slope: a lasting lean, drift). */
  cusum: number[];
  /** What could be seen before answering (#116), over the reports that kept it. */
  context: { n: number; changedAfterPrediction: number; sameAsShown: number; sameAsPrediction: number } | null;
}

const jstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const modeOf = (p: number[]) => p.indexOf(Math.max(...p)) - 3;

/** The shared constants' prediction (the prior: centre 18 + 0.33 × (最近の基準 − 15), h 3, g 4, s 1). */
export function sharedPrediction(e: number, a: number): number[] {
  return probabilities({ mu: PRIOR.m0 + PRIOR.slope * (a - 15), h: PRIOR.h, g: PRIOR.g, s: 1 }, e);
}

export function checksOf(reports: Report[]): Checks {
  const live = reports
    .filter((r) => !r.deleted && r.comfort && (r.scaleVersion ?? 1) === SCALE_VERSION && Number.isInteger(r.sensation))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const rnd = seeded(7);
  const pits: number[] = [], res: number[] = [];
  const vars: Record<Key, number[]> = { wind: [], sunshine: [], humidity: [], hour: [], a: [] };
  const pairs: { day: string; a: number; b: number }[] = [];
  let ctxN = 0, changed = 0, sameShown = 0, samePred = 0;
  for (const r of live) {
    const probs = r.comfort!.probs;
    const y = r.sensation as number;
    pits.push(randomizedPit(probs, y, rnd()));
    res.push(surrogateResidual(probs, y, rnd()));
    const s = r.snapshot;
    vars.wind.push(s?.wind ?? NaN);
    vars.sunshine.push(s?.sunshine ?? NaN);
    vars.humidity.push(s?.humidity ?? NaN);
    vars.hour.push(s?.hour ?? NaN);
    vars.a.push(r.baseline?.value ?? NaN);
    const e = placeTempOf(r), a = r.baseline?.value;
    if (e != null && a != null) pairs.push({ day: jstDay(r.at), a: rps(sharedPrediction(e, a), y), b: rps(probs, y) });
    const c = r.context;
    if (c) {
      ctxN++;
      if (c.changedAfterPrediction) changed++;
      if (c.shownLevel != null && c.shownLevel - 3 === y) sameShown++;
      if (modeOf(probs) === y) samePred++;
    }
  }
  const slopes0 = CHECKED.map((v) => ({ ...v, slope: live.length >= MIN_FOR_SLOPE ? residualSlope(vars[v.key], res) : null }));
  const flags = falseDiscovery(slopes0.map((v) => v.slope?.p ?? 1), 0.1);
  const diff = pairedDifference(pairs, 2000, 1);
  const periods: Checks["periods"] = [];
  for (let k = 0; k + PERIOD <= pairs.length; k += PERIOD) {
    const chunk = pairs.slice(k, k + PERIOD);
    const d = pairedDifference(chunk, 1000, k + 1);
    if (d) periods.push({ from: chunk[0].day, to: chunk[chunk.length - 1].day, diff: d });
  }
  let run = 0;
  const cusum = res.map((v) => (run += v));
  return {
    periods,
    cusum,
    n: live.length,
    base: pairs.length ? { n: pairs.length, rpsBase: pairs.reduce((t, p) => t + p.a, 0) / pairs.length, rpsBeta: pairs.reduce((t, p) => t + p.b, 0) / pairs.length, diff } : null,
    pit: pitHistogram(pits, 10),
    residualMean: res.length ? res.reduce((t, v) => t + v, 0) / res.length : null,
    slopes: slopes0.map((v, i) => ({ ...v, flagged: flags[i] && v.slope != null })),
    context: ctxN ? { n: ctxN, changedAfterPrediction: changed, sameAsShown: sameShown, sameAsPrediction: samePred } : null,
  };
}

// ---- weak spots: where the predictions keep missing in one direction (#118) ------------------

/** Fewer answers than this in a group, and it is not judged. */
export const MIN_FOR_GROUP = 5;

export interface Spot {
  axis: string;
  group: string;
  n: number;
  /** Mean surrogate residual (+: felt warmer than predicted) and its 95% interval. */
  mean: number;
  lo: number;
  hi: number;
  /** The interval leaves 0 out. Exploratory: many groups are looked at, so a single flag is a lead, not a finding. */
  leaning: boolean;
}

const partOfHour = (h: number) => (h >= 5 && h < 10 ? "朝" : h >= 10 && h < 16 ? "日中" : h >= 16 && h < 19 ? "夕方" : "夜");
const PLACE: Record<string, string> = { sun: "日なた", shade: "日かげ", mixed: "半々" };
const WIND: Record<string, string> = { none: "なし", weak: "弱い", strong: "強い" };
const SKY: Record<string, string> = { clear: "快晴", sunny: "晴れ", thin: "薄曇り", cloudy: "曇り", rain: "雨", snow: "雪" };

/** Mean residual per group of time of day, place, felt wind and sky (from the predictions made at sending). */
export function weakSpots(reports: Report[]): Spot[] {
  const live = reports.filter((r) => !r.deleted && r.comfort && (r.scaleVersion ?? 1) === SCALE_VERSION && Number.isInteger(r.sensation));
  const rnd = seeded(11);
  const axes: { axis: string; of: (r: Report) => string | null }[] = [
    { axis: "時間帯", of: (r) => (r.snapshot?.hour != null ? partOfHour(r.snapshot.hour) : null) },
    { axis: "いる場所", of: (r) => (r.exposure ? PLACE[r.exposure] ?? null : "夜（場所なし）") },
    { axis: "感じた風", of: (r) => WIND[r.windFelt] ?? null },
    { axis: "空", of: (r) => (r.sky ? SKY[r.sky] ?? null : null) },
    // Where the moment's temperature came from: a forecast or an observation (#117, input error).
    { axis: "気温の出どころ", of: (r) => (r.snapshot?.from?.temp ? (r.snapshot.from.temp === "forecast" ? "予報" : "観測") : null) },
  ];
  const res = live.map((r) => surrogateResidual(r.comfort!.probs, r.sensation as number, rnd()));
  const out: Spot[] = [];
  for (const a of axes) {
    const groups = new Map<string, number[]>();
    live.forEach((r, i) => {
      const g = a.of(r);
      if (g) groups.set(g, [...(groups.get(g) ?? []), res[i]]);
    });
    for (const [group, v] of groups) {
      if (v.length < MIN_FOR_GROUP) continue;
      const mean = v.reduce((t, x) => t + x, 0) / v.length;
      const sd = Math.sqrt(v.reduce((t, x) => t + (x - mean) ** 2, 0) / (v.length - 1));
      const half = (1.96 * sd) / Math.sqrt(v.length);
      out.push({ axis: a.axis, group, n: v.length, mean, lo: mean - half, hi: mean + half, leaning: mean - half > 0 || mean + half < 0 });
    }
  }
  return out;
}

// ---- stacking, prior sensitivity, answering habits (#117) --------------------------------------

/**
 * Stacking weights: the mix of the models' stored predictions that would have scored best (log
 * score) on the common answers, by EM on the simplex. Unlike the evidence weights, it does not
 * assume one of the models is the true one, so it piles less on a single model.
 */
export function stackingWeights(probsByModel: number[][][], answers: number[], iterations = 200): number[] {
  const m = probsByModel.length, n = answers.length;
  if (!m || !n) return [];
  let w = Array(m).fill(1 / m);
  const p = probsByModel.map((ps) => ps.map((pr, i) => Math.max(1e-6, pr[answers[i] + 3] ?? 0)));
  for (let it = 0; it < iterations; it++) {
    const next = Array(m).fill(0);
    for (let i = 0; i < n; i++) {
      const tot = w.reduce((t, wk, k) => t + wk * p[k][i], 0);
      for (let k = 0; k < m; k++) next[k] += (w[k] * p[k][i]) / tot;
    }
    w = next.map((v) => v / n);
  }
  return w;
}

/** When and how the person answers, against what would be even (#117: answering habits). */
export function answerHabits(reports: Report[]): { n: number; bands: { label: string; n: number; share: number; even: number }[]; extreme: number } | null {
  const live = reports.filter((r) => !r.deleted && Number.isInteger(r.sensation) && r.snapshot?.hour != null);
  if (!live.length) return null;
  // Waking hours 6–23, split as the time bands above; "even" is each band's share of those hours.
  const BANDS = [
    { label: "朝（5〜9時）", from: 5, to: 10 },
    { label: "日中（10〜15時）", from: 10, to: 16 },
    { label: "夕方（16〜18時）", from: 16, to: 19 },
    { label: "夜（19〜4時）", from: 19, to: 29 },
  ];
  const hourOf = (h: number) => (h < 5 ? h + 24 : h);
  const span = BANDS.reduce((t, b) => t + (b.to - b.from), 0);
  return {
    n: live.length,
    bands: BANDS.map((b) => {
      const k = live.filter((r) => hourOf(r.snapshot!.hour) >= b.from && hourOf(r.snapshot!.hour) < b.to).length;
      return { label: b.label, n: k, share: k / live.length, even: (b.to - b.from) / span };
    }),
    extreme: live.filter((r) => Math.abs(r.sensation as number) >= 2).length / live.length,
  };
}

/**
 * Prior sensitivity (#117): the most weighted model refitted with its prior moved (the centre ±2,
 * every spread ×2 and ÷2), at the latest answer's moment. If the centre barely moves, the records
 * decide it; if it follows the prior, the prior (= the starting point, #111) still decides it.
 */
export function priorSensitivity(reports: Report[], ens: Ensemble): { model: string; rows: { label: string; mu: number; h: number }[] } | null {
  const obs = observationsOf(reports.filter((r) => !r.deleted).sort((a, b) => (a.at < b.at ? -1 : 1)), ens.alpha);
  if (!obs.length || !ens.fits.length) return null;
  const top = ens.fits[ens.weights.indexOf(Math.max(...ens.weights))].model;
  const x = obs[obs.length - 1];
  const base = priorFor(top);
  const variants: { label: string; prior: Prior }[] = [
    { label: "今の出発点", prior: base },
    { label: "中心 −2", prior: { mean: base.mean.map((v, i) => (i === 0 ? v - 2 : v)), sd: base.sd } },
    { label: "中心 +2", prior: { mean: base.mean.map((v, i) => (i === 0 ? v + 2 : v)), sd: base.sd } },
    { label: "幅 ×2（ゆるく）", prior: { mean: base.mean, sd: base.sd.map((v) => v * 2) } },
    { label: "幅 ÷2（きつく）", prior: { mean: base.mean, sd: base.sd.map((v) => v / 2) } },
  ];
  return {
    model: `${top.id} ${top.name}`,
    rows: variants.map((v) => {
      const f = fitModel(top, obs, v.prior);
      const st = stateOf(top, f.theta, x);
      return { label: v.label, mu: st.mu, h: st.h };
    }),
  };
}

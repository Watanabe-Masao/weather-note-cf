// MATH-04: the models and the 7-step ordinal model itself.
// Contract: research/comfort-model/mathematical-contract.md

import { type DriverKey, type Drivers, DRIVERS } from "./drivers";

export interface ModelSpec {
  id: string;
  name: string;
  /** Drivers of the centre, of the range's width, and of the place temperature itself. */
  mu: DriverKey[];
  h: DriverKey[];
  e?: DriverKey[];
}

export const MODELS: ModelSpec[] = [
  { id: "M0", name: "一定", mu: [], h: [] },
  { id: "M1", name: "慣れ", mu: ["a"], h: [] },
  { id: "M2", name: "慣れ＋1週間", mu: ["a", "h7"], h: ["v7", "hNow"] },
  { id: "M3", name: "慣れ＋前日", mu: ["a", "dT1", "h1", "sun1", "rain1"], h: ["v7", "h1"] },
  { id: "M4", name: "慣れ＋季節の向き", mu: ["a", "trend"], h: ["v7", "trend"] },
  {
    id: "M5",
    name: "前日・1週間・天気・季節の向き",
    mu: ["a", "dT1", "trend", "h7", "h1", "sun1", "sun7", "rain1", "rain7", "sky"],
    h: ["v7", "hNow", "h1", "sun1", "sky", "trend"],
    e: ["radNight", "radNightWind", "coldNight", "coldNightWind"],
  },
  { id: "M6", name: "慣れ＋暦の季節（確認用）", mu: ["a", "spring"], h: ["v7", "spring"] },
  { id: "M7", name: "慣れ＋季節の向き＋日射の余熱", mu: ["a", "trend"], h: ["v7"], e: ["radNight", "radNightWind"] },
  { id: "M8", name: "慣れ＋季節の向き＋地面の熱（余熱と前夜の冷え、風付き）", mu: ["a", "trend"], h: ["v7"], e: ["radNight", "radNightWind", "coldNight", "coldNightWind"] },
  { id: "M9", name: "慣れ（頭打ち）", mu: ["aLim"], h: [] },
];

/** Parameter names of a model, in theta order. */
/** Drivers of model `m` whose input is missing at `x` (MATH-03). */
export function missingDrivers(m: ModelSpec, x: Drivers): DriverKey[] {
  return [...new Set([...m.mu, ...m.h, ...(m.e ?? [])])].filter((k) => DRIVERS[k].value(x) == null);
}

/** A model can be used at `x` only with every one of its inputs present. */
export const usable = (m: ModelSpec, x: Drivers) => missingDrivers(m, x).length === 0;

/** A driver's value where the model is usable (callers check `usable` first). */
const dv = (k: DriverKey, x: Drivers) => DRIVERS[k].value(x) ?? 0;

export function paramNames(m: ModelSpec): string[] {
  return ["m0", ...m.mu.map((k) => `中心:${k}`), "l0", ...m.h.map((k) => `範囲:${k}`), ...(m.e ?? []).map((k) => `場所:${k}`), "q0", "r0", "wS", "wN"];
}

export type Theta = number[];

export interface Prior {
  mean: Theta;
  sd: Theta;
}

/** Fixed starting values (see the header): never taken from the 肌感 display settings. */
export const PRIOR = { m0: 18, m0Sd: 4, h: 3, g: 4, logSd: 0.5, slope: 0.33 } as const;

export function priorFor(m: ModelSpec): Prior {
  const es = m.e ?? [];
  const slope = (k: DriverKey) => (k === "a" || k === "aLim" ? PRIOR.slope : 0);
  const mean = [PRIOR.m0, ...m.mu.map(slope), Math.log(PRIOR.h), ...m.h.map(() => 0), ...es.map(() => 0), Math.log(PRIOR.g), 0, 0, 0];
  const sd = [PRIOR.m0Sd, ...m.mu.map((k) => DRIVERS[k].muSd), PRIOR.logSd, ...m.h.map((k) => DRIVERS[k].hSd), ...es.map((k) => DRIVERS[k].eSd ?? 1), PRIOR.logSd, 0.5, 1.5, 1.5];
  return { mean, sd };
}

export interface State {
  mu: number;
  h: number;
  g: number;
  s: number;
}

export function stateOf(m: ModelSpec, theta: Theta, x: Drivers): State {
  let i = 0;
  let mu = theta[i++];
  for (const k of m.mu) mu += theta[i++] * dv(k, x);
  let lh = theta[i++];
  for (const k of m.h) lh += theta[i++] * dv(k, x);
  i += (m.e ?? []).length;
  return { mu, h: Math.exp(lh), g: Math.exp(theta[i]), s: Math.exp(theta[i + 1]) };
}

/** The place temperature E′: E plus the place drivers (the day's stored sun at night) and the felt wind. */
export function placeTemp(m: ModelSpec, theta: Theta, x: Drivers): number {
  const n = theta.length;
  let e = x.e + (x.windFelt === "strong" ? theta[n - 2] : x.windFelt === "none" ? theta[n - 1] : 0);
  const start = 1 + m.mu.length + 1 + m.h.length;
  (m.e ?? []).forEach((k, j) => (e += theta[start + j] * dv(k, x)));
  return e;
}

const sigma = (v: number) => 1 / (1 + Math.exp(-v));

/** Probability of each answer −3…+3 (7 numbers summing to 1). */
export function probabilities(st: State, e: number): number[] {
  const edges = [-st.h - 2 * st.g, -st.h - st.g, -st.h, st.h, st.h + st.g, st.h + 2 * st.g];
  const cdf = [0, ...edges.map((ck) => sigma((ck - (e - st.mu)) / st.s)), 1];
  return Array.from({ length: 7 }, (_, k) => Math.max(1e-9, cdf[k + 1] - cdf[k]));
}

/** Where E sits: inside the range (0), or how far past its edge (℃, signed). */
export function beyondRange(st: State, e: number): number {
  const d = e - st.mu;
  return Math.abs(d) <= st.h ? 0 : Math.sign(d) * (Math.abs(d) - st.h);
}

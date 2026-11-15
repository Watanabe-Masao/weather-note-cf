// 天気の型（見本）: the days of a month and of 前年同曜日 grouped by how alike they were — 最高・最低・
// 雨・日照・湿度・風 — with k-means on standardised values, the number of groups chosen by the
// silhouette, and each group named from its centre in the record's own units. Both years are
// grouped together, so a group means the same thing for each and their days can be counted side by side.
// Every material is in both the records and the forecasts (決まり3).

import type { WeatherRow } from "../../shared/types";
import { num } from "../design/format";

export const CLUSTER_KEYS = ["max", "min", "rain", "sun", "humidity", "wind"] as const;
type Key = (typeof CLUSTER_KEYS)[number];

export interface DayType {
  /** e.g. 晴れ・暖か */
  name: string;
  /** 雨 / 晴れ / 晴れ間 / 曇り: the colour family. */
  sky: "rain" | "sun" | "part" | "cloud";
  /** Warmer or cooler than the two years' mean 最高 by 1.5℃ or more. */
  warm: "warm" | "cool" | null;
  /** The group's centre in the record's units. */
  centre: Record<Key, number>;
  /** Indexes (into this year's days and the year before's) of the group's days. */
  a: number[];
  b: number[];
}

export interface Clustering {
  types: DayType[];
  /** Days that could not be placed (a value not recorded). */
  missingA: number;
  missingB: number;
  /** How well the groups stand apart (silhouette, −1…1). */
  silhouette: number;
}

/** Rain grows by orders: 0, 1, 10, 40 mm are steps apart, not a straight line. */
const shape = (k: Key, v: number) => (k === "rain" ? Math.log1p(v) : v);

/** A small fixed-seed random, so the same month always gives the same groups. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (p: number[], q: number[]) => p.reduce((s, v, i) => s + (v - q[i]) ** 2, 0);

function kmeans(points: number[][], k: number, rand: () => number) {
  // k-means++ start
  const centres: number[][] = [points[Math.floor(rand() * points.length)]];
  while (centres.length < k) {
    const d = points.map((p) => Math.min(...centres.map((c) => dist2(p, c))));
    const total = d.reduce((s, v) => s + v, 0);
    let r = rand() * total;
    let i = 0;
    while (i < d.length - 1 && (r -= d[i]) > 0) i++;
    centres.push(points[i]);
  }
  let label = points.map(() => 0);
  for (let it = 0; it < 50; it++) {
    const next = points.map((p) => centres.reduce((best, c, ci) => (dist2(p, c) < dist2(p, centres[best]) ? ci : best), 0));
    const same = next.every((l, i) => l === label[i]);
    label = next;
    for (let ci = 0; ci < k; ci++) {
      const mine = points.filter((_, i) => label[i] === ci);
      if (mine.length) centres[ci] = mine[0].map((_, j) => mine.reduce((s, p) => s + p[j], 0) / mine.length);
    }
    if (same && it) break;
  }
  const inertia = points.reduce((s, p, i) => s + dist2(p, centres[label[i]]), 0);
  return { label, inertia };
}

function silhouette(points: number[][], label: number[], k: number) {
  let total = 0;
  points.forEach((p, i) => {
    const mean = (ci: number) => {
      const others = points.filter((_, j) => j !== i && label[j] === ci);
      return others.length ? others.reduce((s, q) => s + Math.sqrt(dist2(p, q)), 0) / others.length : null;
    };
    const a = mean(label[i]);
    const b = Math.min(...Array.from({ length: k }, (_, ci) => (ci === label[i] ? Infinity : (mean(ci) ?? Infinity))));
    total += a == null || !isFinite(b) ? 0 : (b - a) / Math.max(a, b);
  });
  return total / points.length;
}

/** Group the days. `rowsA` this month's days, `rowsB` 前年同曜日's. */
/**
 * `sunPossible`: the hours of daylight the values cover (a time band has fewer than a day), so 晴れ
 * keeps its meaning: sunny from 55% of them (6h of an 11h day), 晴れ間 from 27% (3h).
 */
export function clusterDays(rowsA: (WeatherRow | null)[], rowsB: (WeatherRow | null)[], kRange: [number, number] = [2, 5], sunPossible: number | null = null): Clustering | null {
  const sunny = sunPossible == null ? 6 : sunPossible * 0.55;
  const broken = sunPossible == null ? 3 : sunPossible * 0.27;
  const read = (r: WeatherRow | null) => {
    const v = CLUSTER_KEYS.map((k) => num(r?.[k]));
    return v.every((x) => x != null) ? (v as number[]) : null;
  };
  const all = [...rowsA.map((r, i) => ({ side: "a" as const, i, v: read(r) })), ...rowsB.map((r, i) => ({ side: "b" as const, i, v: read(r) }))];
  const placed = all.filter((x) => x.v) as { side: "a" | "b"; i: number; v: number[] }[];
  if (placed.length < 8) return null;
  // Standardise each value over both years.
  const shaped = placed.map((x) => x.v.map((v, j) => shape(CLUSTER_KEYS[j], v)));
  const mu = CLUSTER_KEYS.map((_, j) => shaped.reduce((s, p) => s + p[j], 0) / shaped.length);
  const sd = CLUSTER_KEYS.map((_, j) => Math.sqrt(shaped.reduce((s, p) => s + (p[j] - mu[j]) ** 2, 0) / shaped.length) || 1);
  const z = shaped.map((p) => p.map((v, j) => (v - mu[j]) / sd[j]));
  let best: { label: number[]; k: number; sil: number } | null = null;
  for (let k = kRange[0]; k <= kRange[1]; k++) {
    const rand = seeded(47893 + k);
    let run = kmeans(z, k, rand);
    for (let t = 0; t < 9; t++) {
      const r = kmeans(z, k, rand);
      if (r.inertia < run.inertia) run = r;
    }
    // A group of one day is a day, not a type.
    const sizes = Array.from({ length: k }, (_, ci) => run.label.filter((l) => l === ci).length);
    if (sizes.some((n) => n < 2)) continue;
    const sil = silhouette(z, run.label, k);
    if (!best || sil > best.sil + 0.02) best = { label: run.label, k, sil };
  }
  if (!best) return null;
  const meanMax = placed.reduce((s, x) => s + x.v[0], 0) / placed.length;
  const types: DayType[] = Array.from({ length: best.k }, (_, ci) => {
    const mine = placed.filter((_, i) => best!.label[i] === ci);
    const centre = Object.fromEntries(CLUSTER_KEYS.map((k, j) => [k, mine.reduce((s, x) => s + x.v[j], 0) / mine.length])) as Record<Key, number>;
    // Named in the record's units: wet by the share of rain days, sky by sunshine, warmth against the two years' mean.
    const wetShare = mine.filter((x) => x.v[2] >= 1).length / mine.length;
    const sky: DayType["sky"] = wetShare >= 0.5 ? "rain" : centre.sun >= sunny ? "sun" : centre.sun >= broken ? "part" : "cloud";
    const skyName = { rain: "雨", sun: "晴れ", part: "晴れ間", cloud: "曇り" }[sky];
    const warmth: DayType["warm"] = centre.max - meanMax >= 1.5 ? "warm" : meanMax - centre.max >= 1.5 ? "cool" : null;
    const warm = warmth === "warm" ? "暖か" : warmth === "cool" ? "涼しい" : "";
    const windy = (centre.wind - mu[5]) / sd[5] >= 1 ? "風" : "";
    const name = [skyName, warm, windy].filter(Boolean).join("・");
    return { name, sky, warm: warmth, centre, a: mine.filter((x) => x.side === "a").map((x) => x.i), b: mine.filter((x) => x.side === "b").map((x) => x.i) };
  });
  // Same names apart by their warmth.
  for (const t of types) if (types.filter((u) => u.name === t.name).length > 1) t.name = `${t.name}（${t.centre.max.toFixed(0)}℃）`;
  // Order: sunny to wet, warm first within.
  const order = { sun: 0, part: 1, cloud: 2, rain: 3 };
  types.sort((x, y) => order[x.sky] - order[y.sky] || y.centre.max - x.centre.max);
  return {
    types,
    missingA: rowsA.length - placed.filter((x) => x.side === "a").length,
    missingB: rowsB.length - placed.filter((x) => x.side === "b").length,
    silhouette: best.sil,
  };
}

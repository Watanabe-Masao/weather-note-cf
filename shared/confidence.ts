// 信頼度 of a forecast day, from the spread of an ensemble (the same forecast computed many times
// with slightly different starts). The app's own measure — not JMA's 週間予報の信頼度 — with one
// meaning on every forecast day:
//   A: the runs agree (the day is likely to come out as forecast)
//   B: they differ somewhat
//   C: they differ a lot, or split on whether it rains
// Rules and thresholds: docs/design-system.md「信頼度」.

export type Confidence = "A" | "B" | "C";

export interface Spread {
  /** Standard deviation of the runs' daily maximum / minimum temperature (℃). */
  maxSd: number;
  minSd: number;
  /** Share of runs with at least RAIN_MM of rain (0…1). */
  rainShare: number;
  members: number;
}

/** A run counts as "rain" from this daily total (mm). */
export const RAIN_MM = 1;
/** Temperature spread (℃, the larger of max and min): up to A, up to B, above → C. */
export const TEMP_SD = { A: 1.5, B: 3 } as const;
/** Rain: runs this split (share between the bounds) → B; nearer an even split → C. */
export const RAIN_SPLIT = { B: [0.2, 0.8], C: [0.35, 0.65] } as const;
/** Fewer runs than this say nothing. */
export const MIN_MEMBERS = 5;

const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const finite = (xs: unknown[]) => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

export function spreadOf(maxes: unknown[], mins: unknown[], rains: unknown[]): Spread | null {
  const mx = finite(maxes);
  const mn = finite(mins);
  const rn = finite(rains);
  const members = Math.min(mx.length, mn.length);
  if (members < MIN_MEMBERS) return null;
  return {
    maxSd: +sd(mx).toFixed(2),
    minSd: +sd(mn).toFixed(2),
    rainShare: rn.length ? +(rn.filter((r) => r >= RAIN_MM).length / rn.length).toFixed(2) : 0,
    members,
  };
}

const inside = (x: number, [lo, hi]: readonly number[]) => x >= lo && x <= hi;

export function confidenceOf(s: Spread): Confidence {
  const t = Math.max(s.maxSd, s.minSd);
  const temp: Confidence = t <= TEMP_SD.A ? "A" : t <= TEMP_SD.B ? "B" : "C";
  const rain: Confidence = inside(s.rainShare, RAIN_SPLIT.C) ? "C" : inside(s.rainShare, RAIN_SPLIT.B) ? "B" : "A";
  // The weaker of the two decides.
  return temp > rain ? temp : rain;
}

/**
 * Per-day spread from an Open-Meteo ensemble `daily` block: each variable comes as the control run
 * (`temperature_2m_max`) and members (`temperature_2m_max_member01` …), each an array over `time`.
 * Keys with a model suffix are read the same way.
 */
export function ensembleSpreads(daily: Record<string, unknown>): Map<string, Spread> {
  const time = (daily.time as string[] | undefined) ?? [];
  const runsOf = (variable: string) =>
    Object.entries(daily)
      .filter(([k]) => k === variable || k.startsWith(variable + "_member") || k.startsWith(variable + "_"))
      .filter(([k]) => !k.slice(variable.length).startsWith("_mean") && Array.isArray(daily[k]))
      .map(([, v]) => v as unknown[]);
  const maxRuns = runsOf("temperature_2m_max");
  const minRuns = runsOf("temperature_2m_min");
  const rainRuns = runsOf("precipitation_sum");
  const out = new Map<string, Spread>();
  time.forEach((date, i) => {
    const s = spreadOf(
      maxRuns.map((r) => r[i]),
      minRuns.map((r) => r[i]),
      rainRuns.map((r) => r[i]),
    );
    if (s) out.set(date, s);
  });
  return out;
}

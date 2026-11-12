// MATH-03: the inputs (drivers) of the models, and what "missing" means.
// Contract: research/comfort-model/mathematical-contract.md


/** Everything a model may use, for one moment. Missing values count as typical (0 after centring). */
export interface Drivers {
  /** Place temperature (日なた／日かげ／半々). */
  e: number;
  /** 最近の基準 (℃). */
  a: number;
  /** Yesterday's mean − 最近の基準 (℃): a sudden change. */
  dT1: number | null;
  /** Humidity (%): mean of the 7 days before, yesterday, now. */
  h7: number | null;
  h1: number | null;
  hNow: number | null;
  /** Spread of the 7 daily means before (℃). */
  v7: number | null;
  /** Sunshine hours: yesterday, mean of the 7 days. */
  sun1: number | null;
  sun7: number | null;
  /** Rain (mm): yesterday, mean of the 7 days. */
  rain1: number | null;
  rain7: number | null;
  /** Sunny now (reported sky, or the day's weather). */
  sky: boolean | null;
  /** Slope of the 14 daily means before (℃ per week): + warming (spring-like), − cooling (autumn-like). */
  trend: number | null;
  /** Day of the year (1–366), for the calendar-season check model only. */
  doy: number | null;
  /** Global radiation summed from the morning to this moment (MJ/m²), and whether it is night now. */
  radDay: number | null;
  night: boolean | null;
  /** Wind as an amount: mean of the last 6 hours (m/s) — how much of the stored warmth it has carried off. */
  wind6h: number | null;
  /** Last night: the day before's minimum − 最近の基準 (℃), and last night's mean wind (sunset to sunrise; the
   *  day before's mean when the hours are missing) (m/s). */
  minPrev: number | null;
  windPrev: number | null;
  windFelt?: "strong" | "weak" | "none" | null;
  /** comfort-3/4 only (comparisons): the sky counted at night too. */
  skyAtNight?: boolean;
  /**
   * comfort-6 (night only): the radiation of the latest daytime (MJ/m²: the day's own total after
   * sunset, the day before's before sunrise) and the hours since that sunset. `radTauH` overrides
   * the fading time (checks); `legacyRad` reads the night as comfort-3/4/5 did (comparisons).
   */
  storedRad?: number | null;
  sinceSunset?: number | null;
  radTauH?: number;
  legacyRad?: boolean;
}

export type DriverKey =
  | "a"
  | "dT1"
  | "h7"
  | "h1"
  | "hNow"
  | "v7"
  | "sun1"
  | "sun7"
  | "rain1"
  | "rain7"
  | "sky"
  | "trend"
  | "spring"
  | "aLim"
  | "radNight"
  | "radNightWind"
  | "coldNight"
  | "coldNightWind";

interface DriverInfo {
  label: string;
  /** What one unit of the centred value is, for people. */
  unit: string;
  /**
   * The centred value, or null when its input is missing (MATH-03): a missing input is never
   * read as a typical one. A value that does not apply at this moment (the night's warmth by day)
   * is 0, which is not missing.
   */
  value: (d: Drivers) => number | null;
  /** Prior spread of its effect on the centre (℃ per unit), on log width (per unit) and on the place temperature (℃ per unit). */
  muSd: number;
  hSd: number;
  eSd?: number;
}

/** Where adaptation stops, for the limited model (EN 16798-1's range for the running mean). */
export const ADAPT_LO = 10;
export const ADAPT_HI = 30;

const c = (v: number | null, ref: number, unit: number) => (v == null ? null : (v - ref) / unit);

/**
 * Hours for the stored warmth to fall to 1/e after sunset (comfort-6, #86). None for now: on
 * synthetic people (research/comfort-model/stored-heat-results.md) the true fading time cannot be
 * known in advance, and a fixed one loses most when it is wrong — τ = 4 h lost as much as comfort-5
 * for a person who keeps the warmth all night — while no fading lost least in every case (0.0003 of
 * RPS at most). The fading stays in the formula, to be compared again on real reports (#54).
 */
export const RAD_TAU_H = Infinity;

/**
 * The stored sun at night, in units of 5 MJ/m² from an ordinary 10 MJ/m² day, fading with the
 * hours since sunset: ((R − 10) / 5) · e^(−t/τ). comfort-3/4/5 read the day's running total
 * without fading — and after midnight that was the new day's total (about 0), a cliff at 1時.
 */
export function storedHeat(d: Drivers): number | null {
  if (d.legacyRad) return d.radDay == null ? null : (d.radDay - 10) / 5;
  if (d.storedRad == null || d.sinceSunset == null) return null;
  return ((d.storedRad - 10) / 5) * Math.exp(-Math.max(0, d.sinceSunset) / (d.radTauH ?? RAD_TAU_H));
}

export const DRIVERS: Record<DriverKey, DriverInfo> = {
  a: { label: "最近の基準", unit: "1℃", value: (d) => d.a - 15, muSd: 0.15, hSd: 0.03 },
  aLim: { label: "最近の基準（10〜30℃で頭打ち）", unit: "1℃", value: (d) => Math.min(ADAPT_HI, Math.max(ADAPT_LO, d.a)) - 15, muSd: 0.15, hSd: 0.03 },
  dT1: { label: "前日の気温の変化（前日 − 基準）", unit: "1℃", value: (d) => d.dT1, muSd: 0.3, hSd: 0.05 },
  h7: { label: "1週間の湿度", unit: "10%", value: (d) => c(d.h7, 65, 10), muSd: 0.6, hSd: 0.15 },
  h1: { label: "前日の湿度", unit: "10%", value: (d) => c(d.h1, 65, 10), muSd: 0.6, hSd: 0.15 },
  hNow: { label: "今の湿度", unit: "10%", value: (d) => c(d.hNow, 65, 10), muSd: 0.6, hSd: 0.15 },
  v7: { label: "1週間の気温の振れ", unit: "1℃", value: (d) => c(d.v7, 2, 1), muSd: 0.5, hSd: 0.15 },
  sun1: { label: "前日の日照", unit: "3時間", value: (d) => c(d.sun1, 5, 3), muSd: 0.6, hSd: 0.15 },
  sun7: { label: "1週間の日照", unit: "3時間", value: (d) => c(d.sun7, 5, 3), muSd: 0.6, hSd: 0.15 },
  rain1: { label: "前日の雨", unit: "log(1+mm)", value: (d) => (d.rain1 == null ? null : Math.log1p(d.rain1) - 0.5), muSd: 0.6, hSd: 0.15 },
  rain7: { label: "1週間の雨", unit: "log(1+mm)", value: (d) => (d.rain7 == null ? null : Math.log1p(d.rain7) - 0.5), muSd: 0.6, hSd: 0.15 },
  // Sunshine on the person: daylight only (comfort-5). After sunset a clear sky cools instead, which
  // the place temperature already carries, so the sky says nothing then (0, not missing).
  sky: { label: "晴れている（日中）", unit: "晴れ=1", value: (d) => (d.night && !d.skyAtNight ? 0 : d.sky == null ? null : (d.sky ? 1 : 0) - 0.5), muSd: 1.0, hSd: 0.2 },
  // 春と秋: the same 15 ℃ after a cold winter and after a hot summer. The 最近の基準 carries most of
  // it; the trend says whether the season is warming or cooling.
  trend: { label: "季節の向き（2週間の気温の傾き）", unit: "1℃/週", value: (d) => d.trend, muSd: 0.5, hSd: 0.1 },
  // Check only: the calendar itself (+1 late March … −1 late September). If it explains more than
  // the history does, something besides temperature (clothes, day length) makes spring and autumn differ.
  spring: { label: "暦の春らしさ", unit: "春=+1, 秋=−1", value: (d) => (d.doy == null ? null : Math.cos((2 * Math.PI * (d.doy - 80)) / 365.25)), muSd: 1.5, hSd: 0.2 },
  // The day's sunshine stored in the ground and walls, given back after dark: it warms the place
  // (E′), not the person's centre. Counts at night only; 10 MJ/m² is an ordinary sunny-ish day.
  radNight: {
    label: "日中の日射の余熱（夜）",
    unit: "5MJ/m²",
    value: (d) => (d.night == null ? null : !d.night ? 0 : storedHeat(d)),
    muSd: 0.6,
    hSd: 0.15,
    eSd: 1.5,
  },
  // Wind carries the stored warmth off — not the wind of the instant but how much has blown since
  // dark: the same day's sun counts for less after hours of wind. (Product with radNight.)
  radNightWind: {
    label: "余熱 × 直近6時間の風",
    unit: "5MJ/m² × 2m/s",
    value: (d) => {
      if (d.night == null) return null;
      if (!d.night) return 0;
      const s = storedHeat(d);
      return s == null || d.wind6h == null ? null : s * ((d.wind6h - 2) / 2);
    },
    muSd: 0.3,
    hSd: 0.1,
    eSd: 1.0,
  },
  // Last night's cold stays in the ground and is felt the next day (daytime only).
  coldNight: {
    label: "前夜の冷え込み（前日の最低 − 基準）",
    unit: "3℃",
    value: (d) => (d.night == null ? null : d.night ? 0 : d.minPrev == null ? null : (d.minPrev + 6) / 3),
    muSd: 0.6,
    hSd: 0.15,
    eSd: 1.5,
  },
  // …and a windy night (in winter especially) draws more heat out of the ground.
  coldNightWind: {
    label: "前夜の冷え込み × 前夜の風",
    unit: "3℃ × 2m/s",
    value: (d) => (d.night == null ? null : d.night ? 0 : d.minPrev == null || d.windPrev == null ? null : ((d.minPrev + 6) / 3) * ((d.windPrev - 2) / 2)),
    muSd: 0.3,
    hSd: 0.1,
    eSd: 1.0,
  },
};

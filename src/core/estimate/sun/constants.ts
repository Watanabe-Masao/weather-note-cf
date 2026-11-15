// 太陽の決まりの数 (principles 5): astronomy, JMA's definitions and published models — numbers that
// nothing fits or changes, each with its source. The model's own provisional numbers (霞み、雲で
//弱める割合) are parameters, in params.ts.

/** Time. */
export const TIME = {
  /** ms in a day. */
  msPerDay: 86_400_000,
  /** ms in a minute. */
  msPerMinute: 60_000,
  /** Minutes in a day. */
  minutesPerDay: 1440,
  /** JST is UTC + 9 h: 540 minutes. */
  jstOffsetMinutes: 540,
  /** Julian date of the Unix epoch (1970-01-01 00:00 UTC). */
  julianAtUnixEpoch: 2440587.5,
  /** Julian date of J2000.0 (2000-01-01 12:00 TT). */
  julianJ2000: 2451545,
  /** Days in a Julian century. */
  daysPerCentury: 36525,
  /** Days in a year, for the yearly cycles of the sky (as the app's 肌感 has used them). */
  daysPerYear: 365,
} as const;

/** Angles. */
export const ANGLE = {
  /** Degrees in a turn, and in half a turn. */
  turn: 360,
  halfTurn: 180,
  /** Arcseconds in a degree. */
  arcsecPerDegree: 3600,
  /** Minutes of time per degree of the Earth's turn (24 h / 360°). */
  minutesPerDegree: 4,
} as const;

/**
 * NOAA's solar position algorithm (Meeus, Astronomical Algorithms, ch. 25), in Julian centuries T
 * from J2000. Polynomials are coefficients of T⁰, T¹, T² …; a series term is c(T)·sin(k·M).
 * Within about 0.01° (shared/sunTimes.ts, checked against 国立天文台 in research/sun).
 */
export const NOAA = {
  /** Geometric mean longitude of the sun (°). */
  meanLongitude: [280.46646, 36000.76983, 0.0003032],
  /** Mean anomaly of the sun (°). */
  meanAnomaly: [357.52911, 35999.05029, -0.0001537],
  /** Eccentricity of the Earth's orbit. */
  eccentricity: [0.016708634, -0.000042037, -0.0000001267],
  /** Equation of the centre (°): terms sin(k·M). */
  centre: [
    { k: 1, c: [1.914602, -0.004817, -0.000014] },
    { k: 2, c: [0.019993, -0.000101] },
    { k: 3, c: [0.000289] },
  ],
  /** Longitude of the moon's ascending node (°), for nutation. */
  node: [125.04, -1934.136],
  /** Aberration (°) and nutation in longitude (° × sin Ω). */
  aberration: -0.00569,
  nutationLongitude: -0.00478,
  /** Mean obliquity of the ecliptic (arcseconds; 23°26′21.448″ at J2000). */
  obliquity: [84381.448, -46.815, -0.00059, 0.001813],
  /** Correction to the obliquity (° × cos Ω). */
  obliquityNutation: 0.00256,
  /**
   * Equation of time (radians → minutes via minutesPerDegree): the terms of
   *   y·sin 2L − 2e·sin M + 4e·y·sin M·cos 2L − ½y²·sin 4L − 5/4·e²·sin 2M,  y = tan²(ε/2).
   */
  eqTime: { half: 2, twoL: 2, fourL: 4, twoM: 2, eTerm: 2, eyTerm: 4, yy: 0.5, ee: 1.25, square: 2 },
} as const;

/** The sky. */
export const SKY = {
  /** The solar constant (W/m², the mean irradiance outside the atmosphere). */
  solarConstant: 1361,
  /** The Earth–sun distance changes the solar constant by about ±3.3 % through the year. */
  orbitAmplitude: 0.033,
  /**
   * Ineichen & Perez (2002), clear sky at sea level, with the Linke turbidity TL:
   *   DNI = 0.827·I₀·exp(−0.09·m·(TL − 1)),  GHI = 0.868·I₀·sin h·exp(−0.0387·m·TL)·exp(0.01·m^1.8)
   */
  ineichen: { dni: 0.827, dniExp: 0.09, ghi: 0.868, ghiExp: 0.0387, ghiCorr: 0.01, ghiCorrPower: 1.8 },
  /** Kasten & Young (1989) relative air mass: 1 / (sin h + a·(h + b)^c). */
  airMass: { a: 0.50572, b: 6.07995, c: -1.6364 },
  /** The smallest sin h a division by it may meet (a sun on the horizon). */
  tinySin: 1e-6,
} as const;

/** JMA: 日照 is counted while the direct normal irradiance is at or above this (W/m²). */
export const SUNSHINE_THRESHOLD = 120;

/**
 * An hour is looked at every 5 minutes, at the middle of each (2.5, 7.5 … 57.5 minutes past): 12
 * moments, as the app's 肌感 has done (shared/mrt.ts hourRadiation).
 */
export const HOUR_STEPS = { minutes: 5, first: 2.5, count: 12 } as const;

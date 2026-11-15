// 比べ方の決まりの数 (principles 7, #117): fixed by the method, not fitted.

/** The seven steps 寒い … 暑い. */
export const STEPS = 7;

/** The block bootstrap of the differences: days are the blocks (1–3 answers a day: days, not
 *  answers, are the information). Resamples, and the interval's two tails. */
export const BOOTSTRAP = { resamples: 2000, lower: 0.025, upper: 0.975 } as const;

/** A fixed seed, so the same answers give the same interval every time (reproducible). */
export const SEED = 20261115;

/** Mulberry32, a small seeded generator (constants of the algorithm). */
export const MULBERRY = { add: 0x6d2b79f5, shiftA: 15, shiftB: 7, shiftC: 14, mulB: 61, range: 4294967296 } as const;

/** RPS: the squared difference of the cumulative chances (Epstein 1969). */
export const RPS_POWER = 2;

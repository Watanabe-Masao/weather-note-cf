// 学習あり版の決まりの数 (principles 5): of the fitting method, not of the person.

/** Nelder–Mead (the usual coefficients): reflection, expansion, contraction, shrink. */
export const NELDER_MEAD = { reflect: 1, expand: 2, contract: 0.5, shrink: 0.5 } as const;

/** Half of a square, for the log density of a normal prior: −½·z². */
export const HALF = 0.5;

/** Squares in the normal prior's −½·z². */
export const SQUARE = 2;

/** Where each of the ordinal model's numbers sits in the vector Nelder–Mead moves. */
export const THETA = { a0: 0, logS: 1, a1: 2 } as const;

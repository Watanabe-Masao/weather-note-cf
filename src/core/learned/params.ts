// 学習あり版の数: how the ordinal models are fitted — their priors (where the numbers start when
// there are few answers, and how far the answers may move them) and the fitting's own limits.
// Provisional (#189 S1), to be revisited with the real answers (#117: the priors' sensitivity).

import type { Param } from "../estimate/engine";

const p = (value: number, unit: string, basis: string): Param => ({ value, unit, basis });

export const ORDINAL_FIT = {
  id: "ordinal-fit",
  version: 1,
  values: {
    /** The intercept a₀ (℃ the boundaries move as a whole): centred on the plain version's 0. */
    interceptMean: p(0, "℃", "学習なし版の境目から始める"),
    interceptSd: p(3, "℃", "仮：境目がまとめて ±3℃ほどは動いてよい"),
    /** The weight a₁ of (肌感 − S): centred on no effect. */
    shortMean: p(0, "", "短期の履歴の効きは 0 から始める（効かないという仮説から）"),
    shortSd: p(0.5, "", "仮：肌感と S の差 1℃ で境目が ±0.5℃ほど"),
    /** The spread s of the logistic (℃): how sharply a step gives way to the next. */
    spreadMean: p(2, "℃", "仮：境目の前後 ±2℃ほどで答えが入れ替わる"),
    spreadLogSd: p(0.5, "", "仮：広がりは半分〜倍くらいまで"),
    /** Fitting. */
    minAnswers: p(10, "件", "これより少ないうちは事前の数のまま（学習なし版と同じ境目）"),
    iterations: p(400, "回", "Nelder–Mead の上限"),
    tolerance: p(1e-7, "", "Nelder–Mead の止め所"),
    step: p(0.5, "", "Nelder–Mead の最初の歩幅"),
  },
} as const;

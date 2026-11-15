// 学習あり版のいちばん素朴な形 (principles 0): how often each step has been answered so far, with
// one more of each so no step is ever impossible (Laplace). It reads no weather at all: anything
// learned that cannot beat this has learned nothing from the weather.

import { STEPS } from "../evaluate/constants";
import type { Predictor } from "../evaluate/prequential";

export const climatologyPredictor: Predictor<unknown> = {
  id: "learned.climatology",
  kind: "learned",
  fit: (past) => {
    const counts = Array.from({ length: STEPS }, () => 1);
    for (const c of past) counts[c.answer]++;
    const total = counts.reduce((a, b) => a + b, 0);
    const p = counts.map((n) => n / total);
    return { predict: () => p };
  },
};

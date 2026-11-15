// 学習なし版の予測 (principles 0, 7): the plain seven-step judge as a predictor for the one-step-ahead
// comparison. It says the step it judges, with all of its weight (it has no spread of its own: none
// has been given a basis), and learns nothing — the yardstick a learned version must beat.

import { STEPS } from "../evaluate/constants";
import type { Predictor } from "../evaluate/prequential";
import type { Estimate } from "../estimate/engine";

/** What the plain judge needs of a case: its step (judge.level7 on the case's 肌感 and shift). */
export interface PlainInputs {
  level: Estimate;
}

export const plainLevelPredictor: Predictor<PlainInputs> = {
  id: "plain.level7",
  kind: "plain",
  fit: () => ({
    predict: (x) => {
      const l = x.level;
      return "value" in l ? Array.from({ length: STEPS }, (_, k) => (k === l.value ? 1 : 0)) : null;
    },
  }),
};

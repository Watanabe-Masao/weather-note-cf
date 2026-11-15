// feel.rate の数: provisional, to be chosen by comparing with the answers (#189).

import { defineParams } from "../engine";
import { feelRate } from "./formula";

export const FEEL_RATE_STANDARD = defineParams(feelRate, {
  id: "standard",
  version: 1,
  values: {
    lag: { value: 3, unit: "時間", basis: "仮：短期の履歴の半減と同じ 3 時間。答えと比べて選ぶ" },
  },
});

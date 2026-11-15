// history.short.ema の数: provisional, to be chosen by comparing with the answers (S1, #189).

import { defineParams } from "../engine";
import { historyShort } from "./formula";

/** Half-life of 3 hours: α^3 = ½. */
const HALF_LIFE_HOURS = 3;

export const HISTORY_SHORT_STANDARD = defineParams(historyShort, {
  id: "standard",
  version: 1,
  values: {
    alpha: { value: 0.5 ** (1 / HALF_LIFE_HOURS), unit: "", basis: "仮：半減 3時間（朝の冷えが昼にはほぼ抜ける速さ）。答えと比べて選ぶ（S1）" },
    hours: { value: 12, unit: "時間", basis: "半日。α でも重みの 9 割以上が入る長さ" },
    minCoverage: { value: 0.8, unit: "", basis: "重みの8割がそろえば出す（長期の履歴と同じ）" },
  },
});

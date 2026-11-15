// history.long.mean の数: the window of 従来版's seasonal boundaries (shared/season.ts SEASON).

import { defineParams } from "../engine";
import { historyMean } from "./formula";

export const HISTORY_MEAN_SEASON = defineParams(historyMean, {
  id: "season",
  version: 1,
  values: {
    days: { value: 30, unit: "日", basis: "従来版の境目を季節で動かす期間（#111、渡辺さん 2026-11-13）" },
    minDays: { value: 24, unit: "日", basis: "30日のうち8割がそろえば平均を出す（#111）" },
  },
});

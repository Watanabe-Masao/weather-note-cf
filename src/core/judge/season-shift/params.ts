// judge.shift.season の数 (shared/season.ts SEASON, #111). Provisional: to be fitted to the answers
// (that fit would be the learned version's set).

import { defineParams } from "../../estimate/engine";
import { seasonShift } from "./formula";

const BASIS = "#111（渡辺さん 2026-11-13）";

export const SEASON_SHIFT_STANDARD = defineParams(seasonShift, {
  id: "season",
  version: 1,
  values: {
    slope: { value: 0.7, unit: "℃/℃", basis: `${BASIS}：冬の15℃が暖かい、夏の24℃が涼しい、という感覚から` },
    lo: { value: 5, unit: "℃", basis: `${BASIS}：これより寒い履歴は、それ以上は効かない` },
    hi: { value: 30, unit: "℃", basis: `${BASIS}：これより暑い履歴は、それ以上は効かない` },
    ref: { value: 15, unit: "℃", basis: `${BASIS}：設定の境目がそのまま使われる履歴` },
  },
});

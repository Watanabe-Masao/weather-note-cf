// adapt.long.ema の数. α is the one the learned version chooses from the answers; the plain version
// uses the standard one until then (src/beta/adaptation.ts).

import { defineParams } from "../engine";
import { adaptEma } from "./formula";

export const ADAPT_EMA_STANDARD = defineParams(adaptEma, {
  id: "standard",
  version: 1,
  values: {
    alpha: { value: 0.8, unit: "", basis: "EN 16798-1 の推奨値（半減 約3日）。答えから選ぶまでの標準" },
    days: { value: 60, unit: "日", basis: "α = 0.95 でも重みの 95% が入る長さ（0.95^60 ≈ 5%）" },
    minCoverage: { value: 0.8, unit: "", basis: "重みの8割がそろえば出す（これまでの β と同じ）" },
  },
});

// judge.level7 の数: the person's own six boundaries (設定), as at a long history of the shift's `ref`.

import { defineParams } from "../../estimate/engine";
import { level7 } from "./formula";

export const LEVEL_NAMES = ["寒い", "肌寒い", "涼しい", "暑くも寒くもない", "暖かい", "少し暑い", "暑い"] as const;

/** The plain version's set, from the settings' six boundaries (ascending, ℃ of 肌感). */
export function level7Settings(t: readonly [number, number, number, number, number, number]) {
  const [b1, b2, b3, b4, b5, b6] = t;
  const p = (value: number) => ({ value, unit: "℃", basis: "設定：感じ方の境目" });
  return defineParams(level7, { id: "settings", version: 1, values: { b1: p(b1), b2: p(b2), b3: p(b3), b4: p(b4), b5: p(b5), b6: p(b6) } });
}

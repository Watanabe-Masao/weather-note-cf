// wind.person の数. The surroundings' exponent is the person's own setting (周りの様子), so the
// plain version's set is made from it; the height of a person is fixed here.

import { defineParams } from "../engine";
import { windPerson } from "./formula";

/** The heights the app has used: the wind a person's face meets (shared/feel.ts PERSON_HEIGHT). */
export const PERSON_HEIGHT = { value: 1.5, unit: "m", basis: "立った人の顔の高さの目安（これまでの肌感と同じ）" };

/** Power-law exponents for the surroundings (wind engineering's usual values; 設定の選択肢). */
export const SURROUNDINGS_ALPHA = {
  open: 0.14,
  residential: 0.2,
  urban: 0.3,
  dense: 0.4,
} as const;

/** The plain version's set, from the setting 周りの様子. */
export function windPersonSettings(alpha: number) {
  return defineParams(windPerson, {
    id: "settings",
    version: 1,
    values: {
      personHeight: PERSON_HEIGHT,
      alpha: { value: alpha, unit: "", basis: "設定：周りの様子（べき指数）" },
    },
  });
}

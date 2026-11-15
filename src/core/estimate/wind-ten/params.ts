// wind.ten の数: the reference height of the radiation term, and the surroundings' exponent (設定).

import { defineParams } from "../engine";
import { windTen } from "./formula";

export function windTenSettings(alpha: number) {
  return defineParams(windTen, {
    id: "settings",
    version: 1,
    values: {
      tenMeters: { value: 10, unit: "m", basis: "オーストラリア気象局の体感温度の日射の項が使う風速の高さ" },
      alpha: { value: alpha, unit: "", basis: "設定：周りの様子（べき指数）" },
    },
  });
}

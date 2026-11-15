// feel.sun の数: the radiation term's coefficients (Bureau of Meteorology), and how much of the
// sunshine the body takes (設定「日差しの強さ」).

import { defineParams } from "../engine";
import { feelSun } from "./formula";

const BOM = "オーストラリア気象局の体感温度（Steadman 1994）の日射の項";

export function feelSunSettings(absorb: number) {
  return defineParams(feelSun, {
    id: "settings",
    version: 1,
    values: {
      k: { value: 0.7, unit: "℃·(m/s)/(W/m²)", basis: BOM },
      windOffset: { value: 10, unit: "m/s", basis: BOM },
      absorb: { value: absorb, unit: "", basis: "設定：日差しの強さ（体が受け取る日射の割合）" },
    },
  });
}

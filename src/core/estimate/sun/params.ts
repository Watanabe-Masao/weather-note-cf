// rad.sunshine の数: provisional ones of the app's 肌感 and light (shared/mrt.ts, shared/brightness.ts),
// to be checked against measured radiation (#132 H-02).

import { defineParams } from "../engine";
import { radSunshine } from "./formula";

const CHECK = "仮。高知の日射の実測で確かめる（#132 H-02）";

export const RAD_SUNSHINE_STANDARD = defineParams(radSunshine, {
  id: "standard",
  version: 1,
  values: {
    hazeMean: { value: 3.75, unit: "", basis: `空の霞み（リンケ混濁係数）の1年の平均。冬 約3、湿った夏 約4.5。${CHECK}` },
    hazeAmplitude: { value: 0.75, unit: "", basis: `霞みの1年の振れ幅。${CHECK}` },
    hazeClearestDay: { value: 15, unit: "日目", basis: "霞みが最も少ない日（1月中旬）" },
    cloudy: { value: 1 / 3, unit: "", basis: `日照のない時間（曇り）に通る光の割合。${CHECK}` },
    sharePower: { value: 0.7, unit: "", basis: `日照の割合から通る光への曲がり方。${CHECK}` },
    rainRef: { value: 0.5, unit: "mm", basis: "雨として数える1時間の降水量（気象庁の記録が示す最小）" },
    rainDim: { value: 1 / 7, unit: "", basis: `雨（rainRef）のときに通る光の割合。${CHECK}` },
    rainPower: { value: -0.25, unit: "", basis: `雨が強いほど暗くなる度合い（2 mm で 1/14、20 mm で 1/25）。${CHECK}` },
    rainFloor: { value: 1 / 40, unit: "", basis: "どんな雨でもこれより暗くしない" },
  },
});

// rad.sunshine の数: provisional ones of the app's 肌感 and light (shared/mrt.ts, shared/brightness.ts),
// to be checked against measured radiation (#132 H-02).

import { defineParams } from "../engine";
import { radSunshine } from "./formula";

const CHECK = "仮。高知の日射の実測で確かめる（#132 H-02）";

export const RAD_SUNSHINE_STANDARD = defineParams(radSunshine, {
  id: "standard",
  // v2: 日照のない時間を前後の時間で分ける数（#208 H-02b）
  version: 2,
  values: {
    hazeMean: { value: 3.75, unit: "", basis: `空の霞み（リンケ混濁係数）の1年の平均。冬 約3、湿った夏 約4.5。${CHECK}` },
    hazeAmplitude: { value: 0.75, unit: "", basis: `霞みの1年の振れ幅。${CHECK}` },
    hazeClearestDay: { value: 15, unit: "日目", basis: "霞みが最も少ない日（1月中旬）" },
    cloudy: { value: 1 / 3, unit: "", basis: "日照のない時間（曇り）に通る光の割合。前後の時間が分からない時と、日照が少しある時の基準。高知の1年の実測で、日照 0・雨なしの中央 0.31（#208）" },
    cloudyDark: { value: 0.25, unit: "", basis: "日照 0・雨なしで、前後の時間も日照 0（厚い雲が続く）。高知 2025-11〜2026-10 の実測 ÷ 快晴の中央 0.25、別の年（2024-11〜2025-10）でも 0.25（#208 H-02b）" },
    cloudyBetween: { value: 0.41, unit: "", basis: "日照 0・雨なしで、前後のどちらかに日照（晴れ間の合間の雲）。高知 2025-11〜2026-10 の実測の中央 0.41、別の年で 0.39（#208 H-02b）" },
    sharePower: { value: 0.7, unit: "", basis: `日照の割合から通る光への曲がり方。${CHECK}` },
    rainRef: { value: 0.5, unit: "mm", basis: "雨として数える1時間の降水量（気象庁の記録が示す最小）" },
    rainDim: { value: 1 / 7, unit: "", basis: `雨（rainRef）のときに通る光の割合。${CHECK}` },
    rainPower: { value: -0.25, unit: "", basis: `雨が強いほど暗くなる度合い（2 mm で 1/14、20 mm で 1/25）。${CHECK}` },
    rainFloor: { value: 1 / 40, unit: "", basis: "どんな雨でもこれより暗くしない" },
  },
});

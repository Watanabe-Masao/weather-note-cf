// The catalog (#189 S1): every source, part, driver and recipe of the 体感 calculation as it is on
// 2026-11-15. The map (docs/model-map.md) is written from this; tests keep the two together.
// To add a candidate: register its parts and drivers, then add a recipe. To change a calculation:
// change its part here in the same PR (status, inputs, note).

import { DRIVERS, type DriverKey } from "../beta/engine/drivers";
import { MODEL_VERSION } from "../beta/engine/prediction";
import { MODELS } from "../beta/engine/model";
import { FEEL_TRANSFORM } from "../../shared/feel";
import { FEEL2 } from "../../shared/sunLoad";
import { SEASON } from "../../shared/season";
import type { Catalog, Driver, Part, Recipe, Role, Source } from "./registry";

export const SOURCES: Source[] = [
  { id: "入力/気温", label: "気温", record: true, forecast: true },
  { id: "入力/湿度", label: "湿度", record: true, forecast: true },
  { id: "入力/風", label: "風速", record: true, forecast: true, note: "実績は観測所の高さ、予報は10m" },
  { id: "入力/日照", label: "日照時間", record: true, forecast: true },
  { id: "入力/雨", label: "降水量", record: true, forecast: true },
  { id: "入力/日射の実測", label: "全天日射量（実測）", record: true, forecast: false, note: "日射を測っている観測所だけ" },
  { id: "入力/日射の予報", label: "短波放射（予報）", record: false, forecast: true },
  { id: "入力/日の天気", label: "天気（天気概況・予報の天気）", record: true, forecast: true },
  { id: "入力/日付と地点", label: "日付・時刻・観測所の位置", record: true, forecast: true, note: "計算で出す（太陽の位置・日の出入り）" },
  { id: "入力/記録の空", label: "記録した人が答えた空", record: true, forecast: true, note: "記録のときだけ。なければ日の天気" },
];

export const PARTS: Part[] = [
  // ---- 太陽・雲・日射
  { id: "太陽/位置", label: "太陽の高さ", family: "太陽", status: "使用中", inputs: ["入力/日付と地点"], unit: "°", impl: "shared/sunTimes.ts solarAltitude" },
  { id: "時刻/夜", label: "夜か（日の入り〜日の出）", family: "時刻", status: "使用中", inputs: ["入力/日付と地点"], unit: "夜=1", impl: "src/beta/engine/observations.ts nightOf" },
  {
    id: "雲/通す割合",
    label: "雲で弱める割合（快晴に対して通す光）",
    family: "雲",
    status: "使用中",
    inputs: ["入力/日照", "入力/雨", "太陽/位置"],
    unit: "0〜1",
    impl: "shared/brightness.ts sunshineFactor",
    issues: [132],
    note: "日照 0 で 1/3、雨は 1/7 から降水量で暗く。係数は仮（高知 2025-11-01 の実測で日照 0 は 0.21）",
  },
  { id: "日射/日照から", label: "日照と雨から出す日射", family: "日射", status: "使用中", inputs: ["雲/通す割合", "太陽/位置"], unit: "W/m²", impl: "shared/mrt.ts hourRadiation・sunshineRadiation", issues: [103] },
  {
    id: "日射/実測か予報",
    label: "日射（実測、なければ予報）",
    family: "日射",
    status: "使用中",
    inputs: ["入力/日射の実測", "入力/日射の予報"],
    unit: "W/m²",
    impl: "shared/feel.ts radiationOf",
    issues: [103],
    ruleGap: 103,
    note: "日射を測っていない地点では、実績の日に値がない。日射/日照から にそろえるかは #132 の後で決める",
  },
  // ---- 肌感
  {
    id: "肌感/feel-1s",
    label: `肌感（日なた・日かげ）${FEEL_TRANSFORM}`,
    family: "肌感",
    status: "使用中",
    inputs: ["入力/気温", "入力/湿度", "入力/風", "日射/日照から"],
    unit: "℃",
    impl: "shared/feel.ts feelOf",
    note: "体感温度（オーストラリア気象局）＋日なたは日射の上乗せ",
  },
  { id: "肌感/feel-2c", label: `肌感の候補 ${FEEL2}：体に当たる直射`, family: "肌感", status: "候補", inputs: ["入力/気温", "入力/湿度", "入力/風", "入力/日照", "太陽/位置"], unit: "℃", impl: "shared/sunLoad.ts feel2Warming", issues: [96] },
  { id: "肌感/feel-3", label: "肌感の候補 feel-3：UTCI と平均放射温度", family: "肌感", status: "候補", inputs: ["入力/気温", "入力/湿度", "入力/風", "日射/日照から", "太陽/位置"], unit: "℃", impl: "shared/mrt.ts feel3", issues: [96] },
  // ---- 日ごと
  { id: "日/平均気温", label: "日平均気温", family: "日", status: "使用中", inputs: ["入力/気温"], unit: "℃", impl: "気象庁の日の値（予報は毎時の平均）" },
  { id: "日/最低気温", label: "日最低気温", family: "日", status: "使用中", inputs: ["入力/気温"], unit: "℃", impl: "気象庁の日の値" },
  { id: "日/湿度", label: "日平均湿度", family: "日", status: "使用中", inputs: ["入力/湿度"], unit: "%", impl: "気象庁の日の値" },
  { id: "日/日照", label: "日照時間（日）", family: "日", status: "使用中", inputs: ["入力/日照"], unit: "時間", impl: "気象庁の日の値" },
  { id: "日/雨", label: "降水量（日）", family: "日", status: "使用中", inputs: ["入力/雨"], unit: "mm", impl: "気象庁の日の値" },
  { id: "空/晴れ", label: "晴れているか", family: "空", status: "使用中", inputs: ["入力/記録の空", "入力/日の天気"], unit: "晴れ=1", impl: "src/beta/engine/observations.ts reportedSunny" },
  // ---- 慣れ
  {
    id: "慣れ/30日平均",
    label: "過去30日の日平均気温の単純平均（5〜30℃で頭打ち）",
    family: "慣れ",
    status: "使用中",
    inputs: ["日/平均気温"],
    unit: "℃",
    span: `${SEASON.days}日（平均の古さ 約15日）`,
    impl: "shared/season.ts mean30・seasonShift",
    issues: [111],
  },
  {
    id: "慣れ/重み付き",
    label: "日平均気温の重み付きの平均 θrm（最近の基準）",
    family: "慣れ",
    status: "使用中",
    inputs: ["日/平均気温"],
    unit: "℃",
    span: "α 0.6〜0.95 を記録から選ぶ（標準 0.8：半減 約3日）、最大60日",
    impl: "src/beta/adaptation.ts runningMean",
    issues: [54],
    note: "β の出発点は従来版の傾き 0.7 を借りるが、掛ける相手は 慣れ/30日平均 ではなくこちら",
  },
  { id: "慣れ/季節の向き", label: "2週間の日平均気温の傾き", family: "慣れ", status: "使用中", inputs: ["日/平均気温"], unit: "℃/週", span: "14日", impl: "src/beta/engine/observations.ts trendOf" },
  { id: "慣れ/気温の振れ", label: "1週間の日平均気温の標準偏差", family: "慣れ", status: "使用中", inputs: ["日/平均気温"], unit: "℃", span: "7日", impl: "src/beta/engine/observations.ts driversFrom（v7）" },
  {
    id: "慣れ/手前の平均",
    label: "同じ時刻の手前の平均（時間帯のグラフ）",
    family: "慣れ",
    status: "表示用",
    inputs: ["肌感/feel-1s", "入力/気温"],
    unit: "項目の単位",
    span: "1週・2週・1か月",
    impl: "src/hourAverage.ts meanByHour",
    note: "見せるだけで、ほかの計算に入らない",
  },
  // ---- 変化・余熱
  { id: "変化/直近の風", label: "直近6時間の平均風速", family: "変化", status: "使用中", inputs: ["入力/風"], unit: "m/s", span: "6時間", impl: "src/beta/reports.ts・useBaseline.ts（wind6h）" },
  { id: "変化/前夜の風", label: "前夜の平均風速（日の入り〜日の出）", family: "変化", status: "使用中", inputs: ["入力/風", "時刻/夜"], unit: "m/s", impl: "src/beta/useBaseline.ts lastNightWind" },
  { id: "余熱/日中の日射", label: "日中の日射の合計（夜は直近の昼の分）", family: "余熱", status: "使用中", inputs: ["日射/実測か予報", "時刻/夜"], unit: "MJ/m²", impl: "src/beta/reports.ts radDayOf・observations.ts nightOf", issues: [103, 86], ruleGap: 103 },
];

/** Which parts each β driver is made from (S1: by reading drivers.ts; S2 makes them the code). */
const DRIVER_FROM: Record<DriverKey, string[]> = {
  a: ["慣れ/重み付き"],
  aLim: ["慣れ/重み付き"],
  dT1: ["日/平均気温", "慣れ/重み付き"],
  h7: ["日/湿度"],
  h1: ["日/湿度"],
  hNow: ["日/湿度"],
  v7: ["慣れ/気温の振れ"],
  sun1: ["日/日照"],
  sun7: ["日/日照"],
  rain1: ["日/雨"],
  rain7: ["日/雨"],
  sky: ["空/晴れ", "時刻/夜"],
  trend: ["慣れ/季節の向き"],
  spring: ["太陽/位置"],
  radNight: ["余熱/日中の日射", "時刻/夜"],
  radNightWind: ["余熱/日中の日射", "時刻/夜", "変化/直近の風"],
  coldNight: ["日/最低気温", "慣れ/重み付き", "時刻/夜"],
  coldNightWind: ["日/最低気温", "慣れ/重み付き", "時刻/夜", "変化/前夜の風"],
};

export const DRIVER_LIST: Driver[] = (Object.keys(DRIVERS) as DriverKey[]).map((key) => ({
  key,
  label: DRIVERS[key].label,
  from: DRIVER_FROM[key],
  unit: DRIVERS[key].unit,
  how: "src/beta/engine/drivers.ts",
}));

const ROLE: Record<"mu" | "h" | "e", Role> = { mu: "中心", h: "幅", e: "場所" };

export const RECIPES: Recipe[] = [
  {
    id: "従来版",
    label: "従来版：肌感を7段の境目で切る",
    status: "使用中",
    kind: "固定",
    base: "肌感/feel-1s",
    roles: {},
    parts: ["慣れ/30日平均"],
    version: `境目は設定、慣れ 1℃につき ${SEASON.slope}（${SEASON.lo}〜${SEASON.hi}℃）`,
    impl: "shared/feel.ts levelOf・src/feelSeason.ts",
    note: "値は固定（学ばない）。表・グラフ・肌感マップの段、通知",
  },
  ...MODELS.map(
    (m): Recipe => ({
      id: `β/${m.id}`,
      label: `β ${m.id}：${m.name}`,
      status: "使用中",
      kind: "学習",
      base: "肌感/feel-1s",
      roles: Object.fromEntries((["mu", "h", "e"] as const).filter((k) => (m[k] ?? []).length).map((k) => [ROLE[k], [...m[k]!]])),
      version: MODEL_VERSION,
      impl: "src/beta/engine/model.ts MODELS",
      note: "成績で混ぜる（MATH-05）。出発点は従来版の傾き 0.7 を 慣れ/重み付き に掛ける",
    }),
  ),
];

export const CATALOG: Catalog = { sources: SOURCES, parts: PARTS, drivers: DRIVER_LIST, recipes: RECIPES };

// The catalog (#189 S1): every source, part, driver, recipe and rule of the 体感 calculation as it is
// on 2026-11-15, checked against the code by an independent review. The map (docs/model-map.md) is
// written from this; tests keep the two together. To add a candidate: register its parts and
// drivers, then a recipe. To change a calculation: change its entry here in the same PR.
//
// S1 is a description: it imports from src/beta (so it cannot be the source of truth yet). In S2 the
// direction turns and src/beta imports from src/model.

import { DRIVERS, type DriverKey } from "../beta/engine/drivers";
import { MODEL_VERSION } from "../beta/engine/prediction";
import { MODELS } from "../beta/engine/model";
import { ALPHA_GRID, STANDARD_ALPHA } from "../beta/engine/ensemble";
import { FEEL_TRANSFORM } from "../../shared/feel";
import { FEEL2 } from "../../shared/sunLoad";
import { SEASON } from "../../shared/season";
import type { Catalog, Driver, DriverPath, Part, Recipe, Role, Rule, Source } from "./registry";

export const SOURCES: Source[] = [
  { id: "入力/気温", label: "気温", kind: "気象", record: true, forecast: true },
  { id: "入力/湿度", label: "湿度", kind: "気象", record: true, forecast: true },
  { id: "入力/風", label: "風速", kind: "気象", record: true, forecast: true, note: "予報は10m。実績の測る高さは 設定/風速計の高さ" },
  { id: "入力/日照", label: "日照時間", kind: "気象", record: true, forecast: true },
  { id: "入力/雨", label: "降水量", kind: "気象", record: true, forecast: true },
  { id: "入力/日射の実測", label: "全天日射量（実測）", kind: "気象", record: true, forecast: false, note: "日射を測っている観測所だけ" },
  { id: "入力/日射の予報", label: "短波放射（予報）", kind: "気象", record: false, forecast: true },
  { id: "入力/日の天気", label: "天気（天気概況・予報の天気）", kind: "気象", record: true, forecast: true, note: "日の値だけ（毎時の記録の多くに天気の文はない）" },
  { id: "入力/日の出入り", label: "日の出・日の入り（太陽の API）", kind: "気象", record: true, forecast: true, note: "なければ計算（日付と地点）" },
  { id: "計算/日付と地点", label: "日付・時刻・観測所の位置", kind: "計算" },
  { id: "設定/風速計の高さ", label: "風速計の高さ（地点ごと、初期 10m）", kind: "設定" },
  { id: "設定/周りの様子", label: "周りの様子（風の弱まり α）", kind: "設定" },
  { id: "設定/吸収率", label: "日差しの吸収率", kind: "設定" },
  { id: "答え/感じ方", label: "感じ方（7段）", kind: "答え" },
  { id: "答え/いる場所", label: "いる場所（日なた・日かげ）", kind: "答え" },
  { id: "答え/感じた風", label: "感じた風（強い・弱い・ない）", kind: "答え" },
  { id: "答え/空", label: "答えた空", kind: "答え" },
  { id: "答え/選好", label: "暖かく・涼しくしたいか、飲み物の温度", kind: "答え" },
];

const SETTINGS = ["設定/風速計の高さ", "設定/周りの様子", "設定/吸収率"];

export const PARTS: Part[] = [
  // ---- 太陽・時刻
  { id: "太陽/位置", label: "太陽の高さ", family: "太陽", status: "使用中", inputs: ["計算/日付と地点"], unit: "°", impl: "shared/sunTimes.ts solarAltitude" },
  { id: "時刻/日の出入り", label: "日の出・日の入り（API、なければ計算）", family: "時刻", status: "使用中", inputs: ["入力/日の出入り", "計算/日付と地点"], unit: "時刻", impl: "src/beta/engine/observations.ts riseSet・shared/dayParts.ts dayEdges" },
  { id: "時刻/夜", label: "夜か（日の入り〜日の出）と、日の入りからの時間", family: "時刻", status: "使用中", inputs: ["時刻/日の出入り"], unit: "夜=1・時間", impl: "src/beta/engine/observations.ts nightOf" },
  { id: "時刻/時間区分", label: "時間区分（朝・日中・昼・夕方・夜）", family: "時刻", status: "使用中", inputs: ["太陽/位置"], unit: "区分", impl: "shared/dayParts.ts dayParts" },
  { id: "時刻/暦の日", label: "年の何日目か", family: "時刻", status: "使用中", inputs: ["計算/日付と地点"], unit: "日", impl: "src/beta/engine/observations.ts dayOfYear" },
  // ---- 雲・日射
  {
    id: "雲/通す割合",
    label: "雲で弱める割合（快晴に対して通す光）",
    family: "雲",
    status: "使用中",
    inputs: ["入力/日照", "入力/雨", "太陽/位置"],
    unit: "0〜1",
    params: [
      { name: "日照 0", value: "1/3" },
      { name: "雨", value: "1/7 から降水量で暗く（−0.25 乗）" },
    ],
    impl: "shared/brightness.ts sunshineFactor",
    issues: [132],
    note: "係数は仮。気象庁の実測で確かめる（#132、PR #188 のジョブ）",
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
  { id: "日/日射", label: "日射の日の合計（実測、なければ予報）", family: "日射", status: "使用中", inputs: ["入力/日射の実測", "入力/日射の予報"], unit: "MJ/m²", impl: "日の値 row.radiation", ruleGap: 103 },
  // ---- 肌感
  {
    id: "肌感/feel-1s",
    label: `肌感（日なた・日かげ）${FEEL_TRANSFORM}`,
    family: "肌感",
    status: "使用中",
    inputs: ["入力/気温", "入力/湿度", "入力/風", "日射/日照から", ...SETTINGS],
    unit: "℃",
    impl: "shared/feel.ts feelOf",
    note: "体感温度（オーストラリア気象局）＋日なたは日射の上乗せ。11/14 0時台より前の記録は feel-1（日射/実測か予報）で保存",
  },
  {
    id: "肌感/日中の平均",
    label: "日中（朝の終わり〜夕方）の肌感の平均",
    family: "肌感",
    status: "使用中",
    inputs: ["肌感/feel-1s", "時刻/時間区分"],
    unit: "℃",
    impl: "shared/feel.ts daytimeFeel",
    note: "β の日ごとの予測の場所の肌感、選好の日、比較の要約の「適応基準との差」",
  },
  {
    id: "肌感/最高最低から",
    label: "日の最高・最低から出す肌感（日射なし）",
    family: "肌感",
    status: "使用中",
    inputs: ["日/最高気温", "日/最低気温", "日/湿度", "日/風", ...SETTINGS],
    unit: "℃",
    impl: "shared/feel.ts estimatedBands",
    note: "毎時がない日の表の肌感の帯（従来版の段）",
  },
  { id: "肌感/feel-2c", label: `肌感の候補 ${FEEL2}：体に当たる直射`, family: "肌感", status: "候補", inputs: ["入力/気温", "入力/湿度", "入力/風", "入力/日照", "太陽/位置", ...SETTINGS], unit: "℃", impl: "shared/sunLoad.ts feel2Warming", issues: [96], note: "記録の列（研究用）" },
  { id: "肌感/feel-3", label: "肌感の候補 feel-3：UTCI と平均放射温度", family: "肌感", status: "候補", inputs: ["入力/気温", "入力/湿度", "入力/風", "日射/日照から", "太陽/位置"], unit: "℃", impl: "shared/mrt.ts feel3", issues: [96], note: "設定の太陽の比較板に出る" },
  // ---- 日ごと
  { id: "日/平均気温", label: "日平均気温", family: "日", status: "使用中", inputs: ["入力/気温"], unit: "℃", impl: "日の値 row.temp（予報は毎時の平均）" },
  { id: "日/最高気温", label: "日最高気温", family: "日", status: "使用中", inputs: ["入力/気温"], unit: "℃", impl: "日の値 row.max" },
  { id: "日/最低気温", label: "日最低気温", family: "日", status: "使用中", inputs: ["入力/気温"], unit: "℃", impl: "日の値 row.min" },
  { id: "日/湿度", label: "日平均湿度", family: "日", status: "使用中", inputs: ["入力/湿度"], unit: "%", impl: "日の値 row.humidity" },
  { id: "日/風", label: "日平均風速", family: "日", status: "使用中", inputs: ["入力/風"], unit: "m/s", impl: "日の値 row.wind" },
  { id: "日/日照", label: "日照時間（日）", family: "日", status: "使用中", inputs: ["入力/日照"], unit: "時間", impl: "日の値 row.sun" },
  { id: "日/雨", label: "降水量（日）", family: "日", status: "使用中", inputs: ["入力/雨"], unit: "mm", impl: "日の値 row.rain" },
  { id: "変化/その時の湿度", label: "その時刻の湿度（毎時・10分値）", family: "変化", status: "使用中", inputs: ["入力/湿度"], unit: "%", impl: "src/beta/reports.ts（snapshot.humidity）" },
  { id: "空/日の天気から", label: "晴れか（日の天気の文から）", family: "空", status: "使用中", inputs: ["入力/日の天気"], unit: "晴れ=1", impl: "src/beta/useBaseline.ts（weatherGroup）" },
  // ---- 慣れ
  {
    id: "慣れ/30日平均",
    label: "過去30日の日平均気温の単純平均",
    family: "慣れ",
    status: "使用中",
    inputs: ["日/平均気温"],
    unit: "℃",
    span: `${SEASON.days}日（${SEASON.minDays}日以上そろうとき。平均の古さ 約15.5日）`,
    impl: "shared/season.ts mean30",
    issues: [111],
  },
  {
    id: "慣れ/重み付き",
    label: "日平均気温の重み付きの平均 θrm（最近の基準）",
    family: "慣れ",
    status: "使用中",
    inputs: ["日/平均気温"],
    unit: "℃",
    span: "最大60日。前日の値と、重みの8割がそろうとき",
    params: [{ name: "α", value: `${ALPHA_GRID.join("・")} から選ぶ。記録が少ないうちは ${STANDARD_ALPHA}（半減 約3.1日）`, learnedBy: "β/M2 の成績（記録 30件以上）" }],
    impl: "src/beta/adaptation.ts runningMean",
    issues: [54],
    note: "β の出発点は従来版の傾き 0.7 を借りるが、掛ける相手は 慣れ/30日平均 ではなくこちら（model.ts PRIOR.slope は数を直接書いている）",
  },
  { id: "慣れ/季節の向き", label: "2週間の日平均気温の傾き", family: "慣れ", status: "使用中", inputs: ["日/平均気温"], unit: "℃/週", span: "14日（10日以上そろうとき）", impl: "src/beta/engine/observations.ts trendOf" },
  { id: "慣れ/気温の振れ", label: "1週間の日平均気温の標準偏差", family: "慣れ", status: "使用中", inputs: ["日/平均気温"], unit: "℃", span: "7日（3日以上）", impl: "src/beta/engine/observations.ts driversFrom（v7）" },
  {
    id: "慣れ/手前の平均",
    label: "同じ時刻の手前の平均（時間帯のグラフ）",
    family: "慣れ",
    status: "表示用",
    inputs: ["肌感/feel-1s", "入力/気温", "入力/湿度", "入力/風", "入力/日照", "入力/雨"],
    unit: "選んでいる項目の単位",
    span: "1週・2週・1か月",
    impl: "src/hourAverage.ts meanByHour",
    note: "見せるだけで、ほかの計算に入らない",
  },
  // ---- 変化・余熱
  { id: "変化/直近の風", label: "直近6時間の平均風速", family: "変化", status: "使用中", inputs: ["入力/風"], unit: "m/s", span: "6時間", impl: "src/beta/reports.ts windMemory（wind6h）" },
  {
    id: "変化/前夜の風",
    label: "前夜の平均風速（日の入り〜日の出）",
    family: "変化",
    status: "使用中",
    inputs: ["入力/風", "時刻/日の出入り"],
    unit: "m/s",
    impl: "src/beta/reports.ts windMemory（windLastNight）",
    note: "古い記録は 18〜6時で保存。計算の根拠の表示もまだ「18〜6時」",
  },
  {
    id: "余熱/日中の日射",
    label: "直近の昼の日射の合計と、日の入りからの時間",
    family: "余熱",
    status: "使用中",
    inputs: ["日射/実測か予報", "日/日射", "時刻/夜"],
    unit: "MJ/m²・時間",
    impl: "src/beta/reports.ts radDayOf・observations.ts storedSunOf",
    issues: [103, 86],
    ruleGap: 103,
    note: "夕方はその日の途中までの合計、日の出前は前日の日の合計",
  },
];

/** A driver built the same way for learning and for a day's prediction (from the store). */
const both = (from: string[], impl: string): { learn: DriverPath; predict: DriverPath } => ({ learn: { from, impl: `${impl}（記録の history・recent）` }, predict: { from, impl: `${impl}（useBaseline.ts driversOfDay）` } });

/** Each β driver: what learning and a day's prediction build it from (MATH-03). */
const PATHS: Record<DriverKey, Pick<Driver, "learn" | "predict" | "differs">> = {
  a: both(["慣れ/重み付き"], "observations.ts driversFrom"),
  aLim: both(["慣れ/重み付き"], "observations.ts driversFrom"),
  dT1: both(["日/平均気温", "慣れ/重み付き"], "observations.ts driversFrom"),
  h7: both(["日/湿度"], "observations.ts driversFrom"),
  h1: both(["日/湿度"], "observations.ts driversFrom"),
  hNow: {
    learn: { from: ["変化/その時の湿度"], impl: "observations.ts observationsOf（snapshot.humidity）", stored: true },
    predict: { from: ["日/湿度"], impl: "useDayComfort.ts・BasisSheet.tsx（日平均）" },
    differs: "学習は答えた時刻の湿度、日ごとの予測は日平均の湿度",
  },
  v7: both(["慣れ/気温の振れ"], "observations.ts driversFrom"),
  sun1: both(["日/日照"], "observations.ts driversFrom"),
  sun7: both(["日/日照"], "observations.ts driversFrom"),
  rain1: both(["日/雨"], "observations.ts driversFrom"),
  rain7: both(["日/雨"], "observations.ts driversFrom"),
  sky: {
    learn: { from: ["答え/空", "時刻/夜"], impl: "observations.ts reportedSunny（代わりの値なし）" },
    predict: { from: ["答え/空", "空/日の天気から", "時刻/夜"], impl: "useBaseline.ts driversOfDay（答えがなければ日の天気）" },
    differs: "学習は答えた空だけ、日ごとの予測は答えがなければ日の天気の文",
  },
  trend: both(["慣れ/季節の向き"], "observations.ts trendOf"),
  spring: both(["時刻/暦の日"], "observations.ts dayOfYear"),
  radNight: {
    learn: { from: ["余熱/日中の日射", "時刻/夜"], impl: "observations.ts storedSunOf（記録の radDay・recent の日射）", stored: true },
    predict: { from: ["余熱/日中の日射", "日/日射", "時刻/夜"], impl: "useBaseline.ts driversOfDay（日の値 row.radiation）" },
    differs: "学習は記録に保存した日射、日ごとの予測はストアの日の値",
  },
  radNightWind: {
    learn: { from: ["余熱/日中の日射", "時刻/夜", "変化/直近の風"], impl: "observations.ts（記録の wind6h）", stored: true },
    predict: { from: ["余熱/日中の日射", "日/日射", "時刻/夜", "変化/直近の風"], impl: "useBaseline.ts driversOfDay" },
    differs: "学習は記録に保存した日射と風、日ごとの予測はストアの値",
  },
  coldNight: both(["日/最低気温", "慣れ/重み付き", "時刻/夜"], "observations.ts driversFrom"),
  coldNightWind: {
    learn: { from: ["日/最低気温", "慣れ/重み付き", "時刻/夜", "変化/前夜の風", "日/風"], impl: "observations.ts driversFrom（snapshot.windLastNight、なければ前日の日平均の風）", stored: true },
    predict: { from: ["日/最低気温", "慣れ/重み付き", "時刻/夜", "変化/前夜の風", "日/風"], impl: "useBaseline.ts lastNightWind（なければ前日の日平均の風）" },
    differs: "学習は記録に保存した前夜の風、日ごとの予測はストアの毎時から計算し直す",
  },
};

export const DRIVER_LIST: Driver[] = [
  {
    key: "E",
    label: "場所の肌感（日なた・日かげ）",
    unit: "℃",
    learn: { from: ["肌感/feel-1s", "答え/いる場所"], impl: "observations.ts placeTempOf（snapshot.sunTemp・shadeTemp）", stored: true },
    predict: { from: ["肌感/日中の平均"], impl: "useDayComfort.ts（日中の平均、日なた、なければ日かげ）" },
    differs: "学習は答えた時刻・場所の肌感（保存したときの式：feel-1 が混ざる）、日ごとの予測は日中の平均の日なた",
  },
  {
    key: "windFelt",
    label: "感じた風（強い・弱い）",
    unit: "強い・弱い",
    learn: { from: ["答え/感じた風"], impl: "observations.ts observationsOf（r.windFelt）→ model.ts wS・wN" },
    predict: null,
    differs: "答えにしかない。日ごとの予測では使わない",
  },
  ...(Object.keys(DRIVERS) as DriverKey[]).map((key) => ({ key, label: DRIVERS[key].label, unit: DRIVERS[key].unit, ...PATHS[key] })),
  {
    key: "y",
    label: "答えた感じ方（選好のモデル用）",
    unit: "7段",
    learn: { from: ["答え/感じ方"], impl: "preferenceModel.ts preferenceObservations" },
    predict: null,
    differs: "答えにしかない。日ごとの選好の予測では 0（ちょうどよい）",
  },
];

const ROLE: Record<"mu" | "h" | "e", Role> = { mu: "中心", h: "幅", e: "場所" };

export const RECIPES: Recipe[] = [
  ...MODELS.map(
    (m): Recipe => ({
      id: `β/${m.id}`,
      label: m.name,
      family: "温冷感",
      base: ["E", "windFelt"],
      roles: Object.fromEntries((["mu", "h", "e"] as const).filter((k) => (m[k] ?? []).length).map((k) => [ROLE[k], [...m[k]!]])),
      impl: "src/beta/engine/model.ts MODELS",
      note: m.id === "M6" ? "確認用（暦の季節）。重みづけには加わる" : undefined,
    }),
  ),
  { id: "選好/温熱", label: "暖かく・涼しくしたいか（MATH-09）", family: "選好", base: ["E", "a", "y"], roles: {}, impl: "src/beta/preferenceModel.ts", note: "指数は記録がたまってから。計算の根拠に出る" },
  { id: "選好/飲み物", label: "温かい・冷たい飲み物（MATH-09）", family: "選好", base: ["E", "a"], roles: {}, impl: "src/beta/preferenceModel.ts" },
];

export const RULES: Rule[] = [
  {
    id: "従来版",
    label: "従来版の段：肌感を7段の境目で切る",
    reads: ["肌感/feel-1s", "肌感/最高最低から", "慣れ/30日平均"],
    params: [
      { name: "境目", value: "設定" },
      { name: "慣れの傾き", value: `1℃につき ${SEASON.slope}（${SEASON.lo}〜${SEASON.hi}℃で頭打ち、基準 ${SEASON.ref}℃）` },
    ],
    impl: "shared/feel.ts levelOf・shared/season.ts seasonShift・src/feelSeason.ts",
    note: "学ばない決まり。表・グラフ・肌感マップの段",
  },
];

export const CATALOG: Catalog = { modelVersion: MODEL_VERSION, sources: SOURCES, parts: PARTS, drivers: DRIVER_LIST, recipes: RECIPES, rules: RULES };

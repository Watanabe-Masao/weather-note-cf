// 仮説上の影響 (principles 0b): what is thought to act on what — research claims, not computation. A
// formula's needs say what a value is computed from; a hypothesis says what a person's answers might
// show. Each has an id that comparisons and notes refer to, and a status that only a comparison of
// the answers changes (one step ahead, principles 7). The map draws them apart from the computed
// dependencies, so a wire in a formula is never read as a finding.

import { ISSUE } from "./constants";

/** Things that are not computed: the latent state and the response, and the parts of the answer. */
export const CONCEPTS = {
  adaptation: "適応状態（慣れ）：直接は見えない状態",
  intercept: "切片：同じ肌感でも感じ方がどちらへ偏るか",
  slope: "傾き：肌感の変化にどれだけ強く反応するか",
  timeOfDay: "時刻（朝・昼・夜）",
  shortHistory: "短期の履歴（当日の数時間）：これから作る",
  rate: "肌感の変化の速さ：これから作る",
} as const;

export type Concept = keyof typeof CONCEPTS;

export interface Hypothesis {
  id: string;
  /** What acts (a formula's key or a concept). */
  from: string;
  /** On what (a concept). */
  to: Concept;
  statement: string;
  /** 仮説 until a comparison of the answers says otherwise. */
  status: "仮説" | "確かめ中" | "支持" | "支持されない";
  /** Issues it is studied in. */
  issues: readonly number[];
}

export const HYPOTHESES: readonly Hypothesis[] = [
  { id: "hyp.long-history.adaptation", from: "historyMean", to: "adaptation", statement: "長い期間の気温履歴が、慣れ（適応状態）をつくる（L1 のまとめ方で）", status: "仮説", issues: [ISSUE.modelRebuild] },
  { id: "hyp.long-history-ema.adaptation", from: "historyEma", to: "adaptation", statement: "長い期間の気温履歴が、慣れ（適応状態）をつくる（L2 のまとめ方で）", status: "仮説", issues: [ISSUE.modelRebuild] },
  { id: "hyp.short-history.adaptation", from: "shortHistory", to: "adaptation", statement: "当日の数時間の履歴も、慣れをつくる", status: "仮説", issues: [ISSUE.modelRebuild] },
  { id: "hyp.rate.intercept", from: "rate", to: "intercept", statement: "暖かくなっている途中か、寒くなっている途中かで、同じ肌感でも感じ方が偏る", status: "仮説", issues: [ISSUE.modelRebuild] },
  { id: "hyp.long-history.intercept", from: "historyEma", to: "intercept", statement: "適応状態を置かずに、長い期間の気温履歴が直接、感じ方の中心を動かす（上の2段の道と比べる）", status: "仮説", issues: [ISSUE.modelRebuild] },
  { id: "hyp.adaptation.intercept", from: "adaptation", to: "intercept", statement: "慣れは、感じ方の中心（切片）を動かす", status: "仮説", issues: [ISSUE.modelRebuild] },
  { id: "hyp.adaptation.slope", from: "adaptation", to: "slope", statement: "慣れは、肌感の変化への反応の強さ（傾き）も動かす", status: "仮説", issues: [ISSUE.modelRebuild] },
  { id: "hyp.time.intercept", from: "timeOfDay", to: "intercept", statement: "時刻は、慣れを経ずに直接、感じ方の中心を動かす（活動・服装の違いは材料にないので、時刻に混ざる）", status: "仮説", issues: [ISSUE.modelRebuild] },
];

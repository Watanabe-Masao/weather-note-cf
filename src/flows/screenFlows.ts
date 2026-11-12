// The decisions behind three screens, kept out of the components so they can be tested (#86:
// 画面の流れに自動テストがない). The components only draw what these return.
//   - 選好の表示 (PreferenceDay): answers only while learning, then the lean in words and the index.
//   - 通知の勧め (NotifySection): the 時間帯 with few reports and no notification in them yet.
//   - 研究用の分析の比較ボタン (ResearchSheet): pooling the per-person comparison into cells.

import type { PrefLearning, PrefPrediction } from "../beta/preferenceModel";
import { bandOf, LEARNING_RULES, TIME_BANDS, type TimeBand } from "../beta/engine/learning";
import type { Cell } from "../research/analysis";

// ---- 選好の表示 -----------------------------------------------------------------------------

export interface PreferenceKindText {
  title: string;
  plus: string;
  minus: string;
  labels: readonly { id: string; label: string }[];
}

/** The difference from oneself before that is worth saying (index units). */
export const PAST_DIFF_MIN = 0.2;

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * One preference line. No answers: say so. Rules not met (MATH-09): the answers so far and what
 * is missing, never an index. Met: the lean in words (none when the 95% interval holds 0), the
 * index and its interval, the three probabilities, and the change from oneself `pastDays` before.
 */
export function preferenceText(
  k: PreferenceKindText,
  counts: [number, number, number],
  at: PrefPrediction | null,
  learning: PrefLearning,
  past: { index: number; shown: boolean } | null,
  pastDays: number,
): { state: "none" | "learning" | "shown"; text: string } {
  if (counts[0] + counts[1] + counts[2] === 0) return { state: "none", text: `${k.title}：まだ答えがありません（記録画面の任意の質問）。` };
  if (!learning.show || !at)
    return {
      state: "learning",
      text: `${k.title}：これまでの答え ${k.labels.map((l, i) => `${l.label} ${counts[i]}件`).join("・")}。指数はまだ出しません（足りないもの：${learning.missing.join("、")}）。`,
    };
  const [lo, hi] = at.indexInterval;
  const lean = lo <= 0 && hi >= 0 ? "はっきりした傾きはありません" : at.index > 0 ? `${k.plus}寄り` : `${k.minus}寄り`;
  const diff = past?.shown ? at.index - past.index : null;
  const then =
    diff == null
      ? ""
      : Math.abs(diff) >= PAST_DIFF_MIN
        ? `。同じ条件で、${pastDays}日より前の自分と比べて ${diff > 0 ? k.plus : k.minus}を選ぶことが多くなっています（${signed(diff)}）`
        : `。${pastDays}日より前の自分と、ほぼ同じです（${signed(diff)}）`;
  return {
    state: "shown",
    text: `${k.title}：${lean}（指数 ${signed(at.index)}、95%：${signed(lo)}〜${signed(hi)}。${k.labels.map((l, i) => `${l.label} ${pct(at.probs[2 - i])}`).join("・")}）${then}`,
  };
}

// ---- 通知の勧め -----------------------------------------------------------------------------

/** For each learning band, the notification time suggested for it. */
export const NUDGE_TIME: Record<TimeBand, string> = { morning: "07:00", day: "13:00", evening: "16:00", night: "19:00" };
export const MAX_NOTIFY_TIMES = 6;

/**
 * The bands to suggest a notification for: fewer reports than the learning needs in a band and no
 * notification time in it yet (by `day`'s sun at the station). Nothing before the first learning.
 * `full`: the times are at their maximum, so a suggestion cannot be added.
 */
export function nudgeBands(
  counts: Record<TimeBand, number> | null | undefined,
  learningState: string,
  times: string[],
  station: string,
  day: string,
): { few: { id: TimeBand; label: string; reports: number; time: string }[]; full: boolean } | null {
  if (!counts || learningState === "untrained") return null;
  const at = (t: string) => Date.parse(`${day}T${t}:00+09:00`);
  const few = TIME_BANDS.filter((b) => counts[b.id] < LEARNING_RULES.minPerBand && !times.some((t) => bandOf(at(t), station) === b.id)).map((b) => ({
    id: b.id,
    label: b.label,
    reports: counts[b.id],
    time: NUDGE_TIME[b.id],
  }));
  return few.length ? { few, full: times.length >= MAX_NOTIFY_TIMES } : null;
}

// ---- 研究用の分析の比較ボタン -----------------------------------------------------------------

export interface PersonCompare {
  n: number;
  rpsA: number;
  rpsB: number;
  ref: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The comparison's cells: each score pooled two ways — by reports (each person weighted by their
 * number of reports) and by people (each person once). Nothing when no one had reports to compare.
 */
export function compareCells(per: PersonCompare[], names: { a: string; b: string; ref: string }, section: string): Cell[] {
  if (!per.length) return [];
  const n = per.reduce((s, c) => s + c.n, 0);
  const pooled = (k: "rpsA" | "rpsB" | "ref") => round3(per.reduce((s, c) => s + c[k] * c.n, 0) / n);
  const perPerson = (k: "rpsA" | "rpsB" | "ref") => round3(per.reduce((s, c) => s + c[k], 0) / per.length);
  return (
    [
      [names.a, "rpsA"],
      [names.b, "rpsB"],
      [names.ref, "ref"],
    ] as const
  ).flatMap(([item, k]) => [
    { section, item: `${item}・件数で平均`, value: pooled(k), people: per.length, reports: n },
    { section, item: `${item}・人ごとに平均`, value: perPerson(k), people: per.length, reports: n },
  ]);
}

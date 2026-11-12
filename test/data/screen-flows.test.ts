// The decisions behind three screens (src/flows/screenFlows.ts, #86): what the preference line
// says, which 時間帯 the notification settings suggest, and how the research comparison is pooled.

import { describe, expect, it } from "vitest";
import { compareCells, MAX_NOTIFY_TIMES, nudgeBands, preferenceText, PAST_DIFF_MIN } from "../../src/flows/screenFlows";
import { bandOf, LEARNING_RULES } from "../../src/beta/engine/learning";

const K = {
  title: "どう感じたいか",
  plus: "暖かくしたい",
  minus: "涼しくしたい",
  labels: [
    { id: "warmer", label: "もう少し暖かく" },
    { id: "same", label: "このままでよい" },
    { id: "cooler", label: "もう少し涼しく" },
  ],
};
const at = (index: number, lo: number, hi: number) => ({ index, indexInterval: [lo, hi] as [number, number], probs: [0.2, 0.3, 0.5] as [number, number, number] });
const shown = { fit: true, show: true, missing: [] };

describe("選好の表示", () => {
  it("says there are no answers yet", () => {
    const v = preferenceText(K, [0, 0, 0], null, { fit: false, show: false, missing: ["答え"] }, null, 21);
    expect(v.state).toBe("none");
    expect(v.text).toContain("まだ答えがありません");
  });
  it("shows the answers and what is missing while learning, never an index", () => {
    const v = preferenceText(K, [3, 1, 0], at(0.4, 0.1, 0.7), { fit: true, show: false, missing: ["答えの数（今 4、12以上）"] }, null, 21);
    expect(v.state).toBe("learning");
    expect(v.text).toContain("もう少し暖かく 3件");
    expect(v.text).toContain("答えの数（今 4、12以上）");
    expect(v.text).not.toContain("指数 ");
  });
  it("says the lean in words, and no lean when the 95% interval holds 0", () => {
    expect(preferenceText(K, [5, 5, 5], at(0.3, 0.1, 0.5), shown, null, 21).text).toContain("暖かくしたい寄り");
    expect(preferenceText(K, [5, 5, 5], at(-0.3, -0.5, -0.1), shown, null, 21).text).toContain("涼しくしたい寄り");
    const none = preferenceText(K, [5, 5, 5], at(0.2, -0.1, 0.5), shown, null, 21).text;
    expect(none).toContain("はっきりした傾きはありません");
    expect(none).toContain("指数 +0.20");
    // The three probabilities in the labels' order (warmer = probs[2]).
    expect(none).toContain("もう少し暖かく 50%");
  });
  it("compares with oneself before only when that was shown, and only a real change as a change", () => {
    const now = at(0.3, 0.1, 0.5);
    expect(preferenceText(K, [5, 5, 5], now, shown, { index: 0.3 - PAST_DIFF_MIN - 0.01, shown: true }, 21).text).toContain("21日より前の自分と比べて 暖かくしたいを選ぶことが多く");
    expect(preferenceText(K, [5, 5, 5], now, shown, { index: 0.25, shown: true }, 21).text).toContain("ほぼ同じ");
    expect(preferenceText(K, [5, 5, 5], now, shown, { index: -0.5, shown: false }, 21).text).not.toContain("自分");
  });
});

describe("通知の勧め", () => {
  const few = LEARNING_RULES.minPerBand - 1, enough = LEARNING_RULES.minPerBand;
  const counts = { morning: few, day: enough, evening: few, night: enough };
  const DAY = "2026-11-12";
  it("suggests nothing before the first learning", () => {
    expect(nudgeBands(counts, "untrained", [], "47893", DAY)).toBeNull();
    expect(nudgeBands(null, "learning", [], "47893", DAY)).toBeNull();
  });
  it("suggests the bands with few reports and no notification in them, with a time in each", () => {
    const v = nudgeBands(counts, "learning", ["13:00"], "47893", DAY)!;
    expect(v.few.map((b) => b.id)).toEqual(["morning", "evening"]);
    expect(v.few.map((b) => b.time)).toEqual(["07:00", "16:00"]);
    expect(v.few[0].reports).toBe(few);
    // The suggested times fall in their own band (by the sun at Kochi in November).
    for (const b of v.few) expect(bandOf(Date.parse(`${DAY}T${b.time}:00+09:00`), "47893")).toBe(b.id);
    // A notification already in the morning band: the morning is not suggested.
    expect(nudgeBands(counts, "learning", ["07:30"], "47893", DAY)!.few.map((b) => b.id)).toEqual(["evening"]);
    expect(nudgeBands(counts, "learning", ["07:30", "16:30"], "47893", DAY)).toBeNull();
  });
  it("says when the times are full", () => {
    const six = ["12:00", "12:10", "12:20", "12:30", "12:40", "12:50"];
    expect(six.length).toBe(MAX_NOTIFY_TIMES);
    expect(nudgeBands(counts, "learning", six, "47893", DAY)!.full).toBe(true);
    expect(nudgeBands(counts, "learning", ["12:00"], "47893", DAY)!.full).toBe(false);
  });
});

describe("研究用の分析の比較ボタン", () => {
  const names = { a: "A", b: "B", ref: "基準" };
  it("pools by reports and by people", () => {
    const cells = compareCells(
      [
        { n: 10, rpsA: 0.1, rpsB: 0.2, ref: 0.3 },
        { n: 30, rpsA: 0.3, rpsB: 0.2, ref: 0.1 },
      ],
      names,
      "比較",
    );
    const v = (item: string) => cells.find((c) => c.item === item)!.value;
    expect(v("A・件数で平均")).toBe(0.25); // (0.1·10 + 0.3·30) / 40
    expect(v("A・人ごとに平均")).toBe(0.2);
    expect(v("B・件数で平均")).toBe(0.2);
    expect(v("基準・件数で平均")).toBe(0.15);
    expect(cells.every((c) => c.people === 2 && c.reports === 40 && c.section === "比較")).toBe(true);
    expect(cells).toHaveLength(6);
  });
  it("gives nothing when no one could be compared", () => {
    expect(compareCells([], names, "比較")).toEqual([]);
  });
});

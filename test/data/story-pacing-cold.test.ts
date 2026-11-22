import { describe, expect, it } from "vitest";
import { fullMoonInfo } from "../../shared/fullMoonNames";
import { BEAT_REST, beatSeconds, CAP_LEAD, LAST_TAIL, pauseSum, readingTimes, revealTimes, tateNum } from "../../src/ui/MoonStory";
import { COLD_CUES, COLD_LINE_PAUSE } from "../../src/design/story/ColdWorld";

// コールドムーンの間（11/23 レビュー「言葉ごとの間を活かす」）：行の前の間（linePause）と言葉の合図（cues）。
const book = fullMoonInfo("コールドムーン")!.book!;
const lines = book.pages.map((p) => p.lines.join("\n"));
const rests = book.pages.map((p) => p.rest ?? 0);
const pauses = lines.map((_, i) => COLD_LINE_PAUSE[i]);
const secs = beatSeconds(lines, rests, true, pauses);
const at = (i: number) => revealTimes(tateNum(lines[i]), secs[i], undefined, pauses[i]);
/** 言葉の最初の字が出る拍（MoonStory の cueAt と同じ計算）。 */
const cueBeat = (i: number, k: number) => {
  const t = tateNum(lines[i]);
  let from = 0;
  let idx = -1;
  for (let j = 0; j <= k; j++) {
    idx = t.indexOf(COLD_CUES[i][j], from);
    from = idx + COLD_CUES[i][j].length;
  }
  // 行の前の間を持つページは、コマの頭から（MoonStory の capAt）。
  const lead = pauses[i] ? 0 : CAP_LEAD;
  return i - lead + at(i)[[...t.slice(0, idx)].length];
};

describe("コールドムーンの間", () => {
  it("どのページも、字は止まる所より前に出そろう", () => {
    lines.forEach((_, i) => expect(at(i).at(-1)!).toBeLessThan(BEAT_REST));
  });
  it("合図の言葉は、どれも本文の中にある（順に）", () => {
    for (const [p, words] of Object.entries(COLD_CUES)) {
      const t = tateNum(lines[Number(p)]);
      let from = 0;
      for (const w of words) {
        const k = t.indexOf(w, from);
        expect(k, `${Number(p) + 1}ページ「${w}」`).toBeGreaterThanOrEqual(0);
        from = k + w.length;
      }
    }
  });
  it("言葉の合図は、そのページの中（頭から 0.75 まで）で動ける", () => {
    for (const [p, words] of Object.entries(COLD_CUES)) {
      const i = Number(p);
      words.forEach((_, k) => {
        const b = cueBeat(i, k);
        expect(b, `${i + 1}ページ ${k + 1}つ目`).toBeGreaterThan(i - CAP_LEAD);
        expect(b, `${i + 1}ページ ${k + 1}つ目`).toBeLessThan(i + 0.75);
      });
    }
  });
  it("2・3ページは、鳥が出てから1行目（コマの頭より後）", () => {
    expect(cueBeat(1, 0)).toBeGreaterThan(1);
    expect(cueBeat(2, 0)).toBeGreaterThan(2);
  });
  it("6ページは、月の縁が出てから1行目（北東の空が明るむ間がある）", () => {
    expect(cueBeat(5, 0)).toBeGreaterThan(5.12);
  });
  it("9ページは、文が消えてから止まる所まで、絵だけが rest（3 秒）", () => {
    const i = lines.length - 1;
    const fadeEnd = 0.06 + (readingTimes(tateNum(lines[i])).total + pauseSum(pauses[i]) + LAST_TAIL) / secs[i] + 0.06;
    expect((BEAT_REST - fadeEnd) * secs[i]).toBeCloseTo(3, 1);
  });
  it("9ページは、飛び出す → 止まった絵で2行目 → 西へ向く間 → 3行目 → 余白 → 名前、の順", () => {
    const [fly, morning, west, name] = [0, 1, 2, 3].map((k) => cueBeat(8, k));
    expect(fly).toBeGreaterThan(8);
    expect(morning - fly).toBeGreaterThan(0.12);
    expect(west - morning).toBeGreaterThan(0.12);
    expect(name).toBeGreaterThan(west);
  });
});

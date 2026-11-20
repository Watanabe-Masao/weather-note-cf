import { describe, expect, it } from "vitest";
import { fullMoonInfo } from "../../shared/fullMoonNames";
import { BEAT_REST, beatSeconds, LAST_TAIL, readingTimes, revealTimes, tateNum } from "../../src/ui/MoonStory";
import { BEAVER_LINE_AT } from "../../src/design/story/BeaverWorld";

// 絵本の間（11/21 承認C の PR-4a、絵コンテ v0.3）：読み終えてから絵だけを見せる秒（rest）と、行の出し方。
const book = fullMoonInfo("ビーバームーン")!.book!;
const lines = book.pages.map((p) => p.lines.join("\n"));
const rests = book.pages.map((p) => p.rest ?? 0);
const secs = beatSeconds(lines, rests, true);

describe("絵本の間", () => {
  it("どのページも、字は止まる所より前に出そろう", () => {
    lines.forEach((t, i) => {
      const at = revealTimes(tateNum(t), secs[i], BEAVER_LINE_AT[i]);
      expect(at.at(-1)!).toBeLessThan(BEAT_REST);
    });
  });
  it("rest の秒だけ、読み終えてからの間が長くなる（6ページ 月が昇る）", () => {
    const plain = beatSeconds(lines, [], false);
    expect(secs[5] - plain[5]).toBeCloseTo(2.5, 5);
  });
  it("6ページは、2行目を月の縁が出てから（行を出す所）", () => {
    const t = tateNum(lines[5]);
    const at = revealTimes(t, secs[5], BEAVER_LINE_AT[5]);
    const second = [...t].indexOf("\n") + 1;
    expect(at[second]).toBeGreaterThanOrEqual(BEAVER_LINE_AT[5][1]);
    expect(at[0]).toBeCloseTo(BEAVER_LINE_AT[5][0], 5);
  });
  it("9ページは、文が消えてから止まる所まで、絵だけが rest（3 秒）", () => {
    const i = lines.length - 1;
    const fadeEnd = 0.06 + (readingTimes(tateNum(lines[i])).total + LAST_TAIL) / secs[i] + 0.06;
    expect((BEAT_REST - fadeEnd) * secs[i]).toBeCloseTo(3, 1);
  });
});

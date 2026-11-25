import { describe, expect, it } from "vitest";
import { fullMoonInfo } from "../../shared/fullMoonNames";
import { BEAT_REST, beatSeconds, LAST_TAIL, readingTimes, revealTimes, tateNum } from "../../src/ui/MoonStory";
import { COLD_LINE_PAUSE } from "../../src/design/story/ColdWorld";

// 絵本の間（11/21 承認C の PR-4a）：行の数から決める今までの計算（コールドムーン）。秒で決める本（ビーバームーン、
// 第2次品質改善）は story-direction.test.ts。
const book = fullMoonInfo("コールドムーン")!.book!;
const lines = book.pages.map((p) => p.lines.join("\n"));
const rests = book.pages.map((p) => p.rest ?? 0);
const pauses = lines.map((_, i) => COLD_LINE_PAUSE[i]);
const secs = beatSeconds(lines, rests, true, pauses);

describe("絵本の間（今までの計算）", () => {
  it("どのページも、字は止まる所より前に出そろう", () => {
    lines.forEach((t, i) => {
      const at = revealTimes(tateNum(t), secs[i], undefined, pauses[i]);
      expect(at.at(-1)!).toBeLessThan(BEAT_REST);
    });
  });
  it("rest の秒だけ、読み終えてからの間が長くなる", () => {
    const plain = beatSeconds(lines, [], false, pauses);
    expect(secs[5] - plain[5]).toBeCloseTo(rests[5], 5);
  });
  it("9ページは、文が消えてから止まる所まで、絵だけが rest の秒", () => {
    const i = lines.length - 1;
    const read = readingTimes(tateNum(lines[i])).total + (pauses[i] ?? []).reduce((a, b) => a + b, 0);
    const fadeEnd = 0.06 + (read + LAST_TAIL) / secs[i] + 0.06;
    expect((BEAT_REST - fadeEnd) * secs[i]).toBeCloseTo(rests[i], 0);
  });
});

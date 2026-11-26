import { describe, expect, it } from "vitest";
import { BEAT_REST, beatSeconds, LAST_TAIL, readingTimes, revealTimes, tateNum } from "../../src/ui/MoonStory";

// 絵本の間（11/21 承認C の PR-4a）：行の数から決める今までの計算（場面が direction を持たない本）。どの満月の本も秒で決める
// 本になったので（ビーバームーン・コールドムーンは story-direction*.test.ts）、この計算は、以前のコールドムーンの本文と行の前の
// 間を見本にして確かめる（場面を足したばかりの満月は、この計算から始まる）。
const OLD_COLD: { lines: string[]; rest: number }[] = [
  { lines: ["森は、まっ白な雪の中。", "お日さまは、ひくい空を", "そっと通っていきます。"], rest: 1 },
  { lines: ["ちょん、ちょん。", "雪の枝に、小さなコガラ。", "黒いぼうしに、白いほっぺ。"], rest: 1 },
  { lines: ["ひとつぶ、またひとつぶ。", "木の皮のすきまに、", "種をそっと、しまいます。"], rest: 1 },
  { lines: ["まだ、夕方なのに。", "森は、もう青いかげの中。", "ひゅう。つめたい風が吹きます。"], rest: 1 },
  { lines: ["コガラは、木の穴にもぐりこみます。", "羽を、ふっくらふくらませて。", "ながい夜の、はじまりです。"], rest: 1.5 },
  { lines: ["雪の野原が、ほのかに光りはじめて。", "おおきな、まあるいお月さま。"], rest: 2.5 },
  { lines: ["月は、ゆっくりのぼっていきます。", "高く、もっと高く。", "雪の森は、青白い光の中。"], rest: 1.5 },
  { lines: ["ながい、ながい夜。", "コガラは、まあるくなって眠ります。", "月の光が、ゆっくり移っていきます。"], rest: 2.5 },
  { lines: ["フィーチー、フィーチー。", "朝の森に、コガラの声。", "西の空には、白い月が まだ のこっています。", "コールドムーン。"], rest: 3 },
];
const OLD_PAUSE: Record<number, number[]> = { 1: [0.8], 2: [0.8], 5: [2.4, 1.4], 8: [2.0, 2.0, 3.2, 1.2] };
const lines = OLD_COLD.map((p) => p.lines.join("\n"));
const rests = OLD_COLD.map((p) => p.rest);
const pauses = lines.map((_, i) => OLD_PAUSE[i]);
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

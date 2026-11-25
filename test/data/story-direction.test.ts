import { describe, expect, it } from "vitest";
import { fullMoonInfo } from "../../shared/fullMoonNames";
import { beaverDirection } from "../../src/design/story/beaverDirection";
import { BEAVER_CUES } from "../../src/design/story/BeaverWorld";
import { pageTimes, plainText } from "../../src/design/story/direction";
import { STORY_SCENES } from "../../src/design/story/scenes";
import { directedPlan } from "../../src/ui/MoonStory";
import { glideFrac } from "../../src/ui/storyPager";

// 文の出し方と時間を秒で決める本（第2次品質改善、11/25 23:24 承認・11/26 本文確定）：ビーバームーン。
const book = fullMoonInfo("ビーバームーン")!.book!;
const pages = book.pages.map((p) => p.lines);
const dir = beaverDirection(pages, book.titleEnd);
const plan = directedPlan(dir);

/** 11/25 承認の「全文が出てからの保持時間」の初期候補（秒）。 */
const HOLD = [[2, 3], [2, 3], [1.5, 2.5], [2, 3], [2.5, 3.5], [3, 4], [2, 3], [3, 4], [2, 3]];

describe("秒で決める本（ビーバームーン）", () => {
  it("場面が演出を持ち、ページの数と同じだけ決める", () => {
    expect(STORY_SCENES["ビーバームーン"]?.direction).toBe(beaverDirection);
    expect(dir.pages.length).toBe(9);
    // コールドムーンは今までの計算のまま（共通の処理を変えても、既存の演出は変えない）。
    expect(STORY_SCENES["コールドムーン"]?.direction).toBeUndefined();
  });
  it("字の時刻は、組版の印（改行・背の低い画面だけで折る \"/\"）を除いた字の数だけ", () => {
    pages.forEach((lines, i) => expect(plan.times[i].chars.length).toBe([...plainText(lines.join("\n"))].length));
  });
  it("背の低い画面で折っても、時間は変わらない（組版と演出を分ける）", () => {
    const flat = beaverDirection(pages.map((l) => l.map((x) => x.replace(/\//g, ""))), book.titleEnd);
    expect(directedPlan(flat).secs).toEqual(plan.secs);
  });
  it("全文が出てからの読む時間は、承認の候補の中", () => {
    dir.pages.forEach((d, i) => {
      expect(d.readHold).toBeGreaterThanOrEqual(HOLD[i][0]);
      expect(d.readHold).toBeLessThanOrEqual(HOLD[i][1]);
      const t = plan.times[i];
      expect(t.fadeStart - t.textFull).toBeCloseTo(d.readHold, 5);
    });
  });
  it("最後の字が浮かびきってから消えはじめる（どのページも区間の中で出そろう）", () => {
    plan.times.forEach((t, i) => {
      expect(t.chars.every((c) => c.at + c.fade <= t.textFull + 1e-9)).toBe(true);
      expect(t.textFull).toBeLessThan(t.total + 1e-9);
      expect(t.textStart).toBeGreaterThan(0 + (i === 0 ? 0.5 : 1)); // 絵が先（前の文が消えてから）
    });
  });
  it("緩急：後半（6〜9）は絵が先・絵だけの時間が前半より長い。6（月の出）と 8（初雪）はとくに", () => {
    const early = dir.pages.slice(0, 4);
    const late = dir.pages.slice(5);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(late.map((d) => d.intro))).toBeGreaterThan(avg(early.map((d) => d.intro)));
    expect(Math.min(...late.map((d) => d.picture))).toBeGreaterThan(Math.max(...early.map((d) => d.picture)));
    expect(dir.pages[5].intro).toBe(Math.max(...dir.pages.map((d) => d.intro)));
    expect(dir.pages[5].picture).toBe(Math.max(...dir.pages.map((d) => d.picture)));
    expect(dir.pages[7].picture).toBeGreaterThan(dir.pages[6].picture);
  });
  it("5ページの「もう、いっぽん。」は、独立した間のあと一文まるごと", () => {
    const u = dir.pages[4].units.at(-1)!;
    expect(u.text).toBe("もう、いっぽん。");
    expect(u.mode).toBe("line");
    expect(u.pauseBefore).toBeGreaterThanOrEqual(1);
  });
  it("最終ページ（E4）：読む → 文が消えきる → 文字の無い風景 → 作品名 → 消えきってから額縁 → 絵だけ。文が出てから 13〜15 秒", () => {
    const i = 8;
    const t = plan.times[i];
    const d = dir.pages[i];
    const title = dir.title!;
    const gone = t.fadeStart + d.fadeOut;
    const titleGone = gone + title.gap + title.fadeIn + title.hold + title.fadeOut;
    expect(title.gap).toBeGreaterThanOrEqual(1);
    expect(titleGone + dir.frame + d.picture).toBeCloseTo(t.total, 5);
    expect(t.total - t.textStart).toBeGreaterThanOrEqual(13);
    expect(t.total - t.textStart).toBeLessThanOrEqual(15);
  });
  it("絵の動きの合図の言葉は、どれも本文にある（本文を直しても合図が消えない）", () => {
    for (const [p, words] of Object.entries(BEAVER_CUES)) {
      const text = plainText(pages[Number(p)].join(""));
      let from = 0;
      for (const w of words) {
        const k = text.indexOf(w, from);
        expect(k, `${Number(p) + 1}ページ「${w}」`).toBeGreaterThanOrEqual(0);
        from = k + w.length;
      }
    }
  });
  it("自動で運ぶ速さの形（初め加速・終わり減速・間は一定）は、0 から 1 まで止まらずに進む", () => {
    const T = 12;
    let prev = -1;
    for (let k = 0; k <= 120; k++) {
      const f = glideFrac((k / 120) * T, T, 0.4, 0.8);
      expect(f).toBeGreaterThan(prev - 1e-12);
      prev = f;
    }
    expect(glideFrac(0, T, 0.4, 0.8)).toBe(0);
    expect(glideFrac(T, T, 0.4, 0.8)).toBeCloseTo(1, 9);
    expect(glideFrac(T, T, 0, 0.8)).toBeCloseTo(1, 9);
  });
  it("pageTimes：最後でないページは、読む時間が終わる所で区間が終わる（消えるのは次の区間の頭）", () => {
    const t = pageTimes(dir.pages[0], 0);
    expect(t.total).toBeCloseTo(t.fadeStart, 9);
  });
});

// 満月の物語の絵本の場面（src/design/story/scenes.ts）の決まり（11/20 渡辺さん「このクオリティーを横展開」、
// docs/moon-story.md）。どの満月の場面を足しても、ここが同じ品質の決まりを確かめる。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BLUE_MOON, fullMoonInfo } from "../../shared/fullMoonNames";
import { STORY_SCENES } from "../../src/design/story/scenes";

const tale = (name: string) => (name === "ブルームーン" ? BLUE_MOON.tale : fullMoonInfo(name)?.tale);

describe("満月の物語の場面", () => {
  for (const [name, scene] of Object.entries(STORY_SCENES)) {
    describe(name, () => {
      const world = renderToStaticMarkup(createElement(scene.World));
      const win = renderToStaticMarkup(createElement(scene.Window));

      it("呼び名に物語があり、場面（コマ）の数は物語の文の数と同じ（一文が一コマ）", () => {
        expect(tale(name)?.lines.length).toBe(scene.beats);
      });
      it("場面の満月は一つで、今夜の情報の月へ引き継ぐ目印がある（StoryMoon）", () => {
        expect(world.match(/data-story-moon/g)?.length).toBe(1);
        expect(world.match(/data-story-disc/g)?.length).toBe(1);
      });
      it("絵に文字を描き込まない（文は画面の側で重ねる）", () => {
        expect(world).not.toMatch(/<text[\s>]/);
        expect(win).not.toMatch(/<text[\s>]/);
      });
      it("絵は 400×860 の縦長で画面を覆い、読み上げない", () => {
        expect(world).toMatch(/viewBox="0 0 400 860"/);
        expect(world).toMatch(/preserveAspectRatio="xMidYMid slice"/);
        expect(world).toMatch(/aria-hidden="true"/);
      });
      it("本のページの窓の絵と、窓から場面へつなぐ空の色がある", () => {
        expect(win).toMatch(/^<svg/);
        expect(scene.sky).toMatch(/^linear-gradient\(/);
      });
    });
  }
});

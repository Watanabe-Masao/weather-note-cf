import { describe, expect, it } from "vitest";
import { FULL_MOON_NAMES, fullMoonInfo } from "../../shared/fullMoonNames";

// 絵本の形（11/21、承認C の PR-1）：データの形だけ変え、見た目は変えない。
describe("絵本の形（book）", () => {
  it("book を持つのはビーバームーンだけ（ほかの満月は tale のまま）", () => {
    expect(FULL_MOON_NAMES.filter((n) => n.book).map((n) => n.name)).toEqual(["ビーバームーン"]);
  });
  it("PR-1 では、ビーバームーンの book はいまの文と同じ（字幕・あとがき・自然と科学）", () => {
    const b = fullMoonInfo("ビーバームーン")!;
    expect(b.book!.pages.map((p) => p.lines.join(""))).toEqual(b.tale!.lines);
    expect(b.book!.afterword.paragraphs).toEqual(b.origin);
    expect(b.book!.science.sections.map((s) => s.text)).toEqual(b.nature);
  });
  it("ページの数は場面のコマの数と同じ（1ページ＝1コマ）", () => {
    const b = fullMoonInfo("ビーバームーン")!;
    expect(b.book!.pages.length).toBe(9);
  });
});

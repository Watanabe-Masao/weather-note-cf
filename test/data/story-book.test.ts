import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FULL_MOON_NAMES, fullMoonInfo } from "../../shared/fullMoonNames";

// 絵本の形（11/21、承認C）：PR-1 でデータの形、PR-2 で本文（Project「ビーバームーン_絵コンテと本文」v0.3）。
describe("絵本の形（book）", () => {
  it("book を持つのはビーバームーンだけ（ほかの満月は tale のまま）", () => {
    expect(FULL_MOON_NAMES.filter((n) => n.book).map((n) => n.name)).toEqual(["ビーバームーン"]);
  });
  it("絵本の本文には由来や生態の説明を入れない（あとがき・自然と科学へ）", () => {
    const b = fullMoonInfo("ビーバームーン")!.book!;
    const text = b.pages.flatMap((p) => p.lines).join("");
    for (const w of ["北米", "冬眠", "罠", "毛皮"]) expect(text).not.toContain(w);
    expect(b.afterword.paragraphs.join("")).toMatch(/北米[\s\S]*罠/);
    expect(b.science.sections.map((s) => s.text).join("")).toContain("冬眠しません");
  });
  it("6ページ（月が昇る）は2行で、絵だけの間がいちばん長い組（9ページの最後の一枚が最長）", () => {
    const p = fullMoonInfo("ビーバームーン")!.book!.pages;
    expect(p[5].lines.length).toBe(2);
    expect(p[5].rest).toBe(2.5);
    expect(p[8].rest).toBe(3);
    expect(p[6].lines).toContain("あと一本。");
  });
  it("物語の文の字は、物語の書体（絞った woff2）にすべて入っている", () => {
    const have = new Set(readFileSync(join(__dirname, "../../public/event/story/fonts/chars.txt"), "utf8"));
    const b = fullMoonInfo("ビーバームーン")!.book!;
    const all = [...b.pages.flatMap((p) => p.lines), b.afterword.title, ...b.afterword.paragraphs, b.science.title, ...b.science.sections.flatMap((s) => [s.heading ?? "", s.text]), "物語のあとがき"].join("");
    expect([...new Set(all)].filter((c) => !have.has(c))).toEqual([]);
  });
  it("ページの数は場面のコマの数と同じ（1ページ＝1コマ）", () => {
    const b = fullMoonInfo("ビーバームーン")!;
    expect(b.book!.pages.length).toBe(9);
  });
});

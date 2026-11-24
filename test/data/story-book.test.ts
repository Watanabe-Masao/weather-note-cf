import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FULL_MOON_NAMES, fullMoonInfo } from "../../shared/fullMoonNames";

// 絵本の形（11/21、承認C）：PR-1 でデータの形、PR-2 で本文（Project「ビーバームーン_絵コンテと本文」v0.3）。
describe("絵本の形（book）", () => {
  it("book を持つのはビーバームーンとコールドムーンだけ（ほかの満月は tale のまま。全作品を同時に変えない）", () => {
    expect(FULL_MOON_NAMES.filter((n) => n.book).map((n) => n.name)).toEqual(["ビーバームーン", "コールドムーン"]);
  });
  // 層ごとに書いてよいこと（docs/moon-story.md、11/21）：作品をまたいで見張る。
  const books = FULL_MOON_NAMES.filter((n) => n.book);
  for (const n of books) {
    const b = n.book!;
    it(`${n.name}：絵本の層に説明の言葉を入れない`, () => {
      const text = b.pages.flatMap((p) => p.lines).join("");
      for (const w of ["北米", "冬至", "冬眠", "体温", "見守", "罠", "毛皮"]) expect(text).not.toContain(w);
    });
    it(`${n.name}：自然と科学に、その年・その場所の数値を書かない（今夜の月で計算する）`, () => {
      const sci = b.science.sections.map((s) => `${s.heading ?? ""}${s.text}`).join("");
      expect(sci).not.toMatch(/\d{4}年|\d{4}\/|\d+時|\d+:\d\d|\d+°|高知/);
    });
    it(`${n.name}：副題は本文の繰り返しの一行（教訓を書かない）`, () => {
      const lines = b.pages.flatMap((p) => p.lines);
      expect(lines.some((l) => l.startsWith(n.tale!.tagline))).toBe(true);
    });
    it(`${n.name}：9ページで、最後のページの最後の行は名前だけ`, () => {
      expect(b.pages.length).toBe(9);
      expect(b.pages[8].lines.at(-1)).toBe(`${n.name}。`);
    });
  }
  it("コールドムーン：8・9ページは作品テーマのとおり（月を見守り役にしない、夜と戦う言い方をしない）", () => {
    const p = fullMoonInfo("コールドムーン")!.book!.pages;
    expect(p[7].lines).toEqual(["ながい、ながい夜。", "コガラは、まあるくなって眠ります。", "月の光が、ゆっくり移っていきます。"]);
    expect(p[8].lines[2]).toBe("西の空には、白い月が まだ のこっています。");
    expect(p.flatMap((x) => x.lines).join("")).not.toMatch(/それでも|負けず/);
    expect(p.map((x) => x.rest)).toEqual([1, 1, 1, 1, 1.5, 2.5, 1.5, 2.5, 3]);
  });
  it("コールドムーン：呼び名の表記は出典の形（ロングナイトムーン）にそろえる", () => {
    const c = fullMoonInfo("コールドムーン")!;
    const all = [...c.origin, ...c.book!.afterword.paragraphs].join("");
    expect(all).toContain("ロングナイトムーン");
    expect(all).not.toContain("ナイツ");
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
    for (const n of books) {
      const b = n.book!;
      const all = [n.tale!.tagline, ...b.pages.flatMap((p) => p.lines), b.afterword.title, ...b.afterword.paragraphs, b.science.title, ...b.science.sections.flatMap((s) => [s.heading ?? "", s.text]), "物語のあとがき"].join("").replace(/\s/g, "");
      expect([...new Set(all)].filter((c) => !have.has(c)), n.name).toEqual([]);
    }
  });
  it("ページの数は場面のコマの数と同じ（1ページ＝1コマ）", () => {
    const b = fullMoonInfo("ビーバームーン")!;
    expect(b.book!.pages.length).toBe(9);
  });
});

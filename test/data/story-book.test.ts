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
      const lines = b.pages.flatMap((p) => p.lines).map((l) => l.replace(/\//g, "")); // "/" は組版の印
      expect(lines.some((l) => l.startsWith(n.tale!.tagline))).toBe(true);
    });
    it(`${n.name}：9ページで、結末は名前だけ（最後のページの最後の行、または独立した作品名）`, () => {
      expect(b.pages.length).toBe(9);
      // 結末の作品名を独立して出す本（titleEnd）は、それが名前だけ。
      expect(b.titleEnd ?? b.pages[8].lines.at(-1)).toBe(`${n.name}。`);
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
  it("ビーバームーンの本文は第2次品質改善の確定稿（11/26：5P 候補B、6P C 案、8P D 案、結末 E4）", () => {
    const b = fullMoonInfo("ビーバームーン")!.book!;
    // "/" は背の低い画面だけで折る所（組版の印）。文そのものは印を除いて比べる。
    const pages = b.pages.map((p) => p.lines.map((l) => l.replace(/\//g, "")));
    expect(pages).toEqual([
      ["はらり、はらり。", "木の葉が、川に落ちていきます。", "森は、もうすぐ冬を迎えます。"],
      ["ちゃぷん。", "小さなビーバーが", "枝をくわえて泳いでいます。", "赤い葉が、一枚。"],
      ["いっぽん。また、いっぽん。", "川をわたって、", "枝をかさねて。", "また、いっぽん。"],
      ["枝と枝のすきまに、", "泥を、ぺたぺた。", "さっきまでのすきまが、", "ひとつ、なくなりました。"],
      ["空に、ひとつ、", "星がまたたきました。", "ビーバーは、住みかをちらり。", "もう、いっぽん。"],
      ["森の向こうから、", "やわらかな光。", "水の上に、光の道。"],
      ["月の光を横切って、", "さいごの、いっぽん。", "そっと、枝を置きました。"],
      ["ひらり、ひらり。", "白い雪が舞い降ります。", "ちゃぷん。", "水の輪が、広がります。"],
      ["赤い葉にも、", "白い雪。"],
    ]);
    expect(b.titleEnd).toBe("ビーバームーン。");
    // 時間は場面の演出（beaverDirection）が持つ。本文の側に rest を書かない（二か所で決めない）。
    expect(b.pages.every((p) => p.rest === undefined)).toBe(true);
    // 折る印は、行の中の意味のまとまりの間だけ（行の頭・終わりや、続けて二つは置かない）。
    for (const l of b.pages.flatMap((p) => p.lines)) expect(l).not.toMatch(/^\/|\/$|\/\//);
  });
  it("物語の文の字は、物語の書体（絞った woff2）にすべて入っている", () => {
    const have = new Set(readFileSync(join(__dirname, "../../public/event/story/fonts/chars.txt"), "utf8"));
    for (const n of books) {
      const b = n.book!;
      const all = [n.tale!.tagline, ...b.pages.flatMap((p) => p.lines), b.titleEnd ?? "", b.afterword.title, ...b.afterword.paragraphs, b.science.title, ...b.science.sections.flatMap((s) => [s.heading ?? "", s.text]), "物語のあとがき"].join("").replace(/\s/g, "");
      expect([...new Set(all)].filter((c) => !have.has(c)), n.name).toEqual([]);
    }
  });
  it("ページの数は場面のコマの数と同じ（1ページ＝1コマ）", () => {
    const b = fullMoonInfo("ビーバームーン")!;
    expect(b.book!.pages.length).toBe(9);
  });
});

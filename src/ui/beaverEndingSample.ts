// 見本（マージしない、2026-11-25）：URL に ?beaverEnd=A・B・C を付けると、ビーバームーンの本文を推敲案（渡辺さんの共有した
// 「文学性を高める7つの工夫」の全9ページ）に差し替え、9ページだけ A・B・C の結末にする。付けなければ今のまま。
// 余白は外部レビューの試験値（1・1.5・1・1・2・3・2.5・2.5・4）。行の出る時刻は、振り返り・月・光の道・見上げる動きに合わせ直す。
import type { FullMoonNameInfo } from "../../shared/fullMoonNames";
import { BEAVER_LINE_AT } from "../design/story/BeaverWorld";
import { STORY_SCENES } from "../design/story/scenes";
import { LAST_TAIL } from "./MoonStory";

type Page = { lines: string[]; rest?: number };
const BASE: Page[] = [
  { lines: ["はらり、はらり。", "木の葉が、川に落ちていきます。", "森は、もうすぐ冬を迎えます。"], rest: 1 },
  { lines: ["ちゃぷん。", "小さなビーバーが", "枝をくわえて泳いでいます。", "赤い葉が、一枚。"], rest: 1.5 },
  { lines: ["いっぽん。また、いっぽん。", "川をわたって、", "枝をかさねて。", "また、いっぽん。"], rest: 1 },
  { lines: ["枝と枝のすきまに、", "泥を、ぺたぺた。", "さっきまでのすきまが、", "ひとつ、なくなりました。"], rest: 1 },
  { lines: ["木々の影が、", "川の上に長くのびていきます。", "ビーバーは、住みかをちらり。", "もう、いっぽん。"], rest: 2 },
  { lines: ["森の向こうが、", "ほのかに明るくなりました。", "水の上に、光の道。", "ビーバーが、顔をあげました。"], rest: 3 },
  { lines: ["月の光を横切って、", "さいごの、いっぽん。", "そっと、枝を置きました。"], rest: 2.5 },
  { lines: ["ひらり、ひらり。", "白い雪が舞い降ります。", "ちゃぷん。", "水の輪が、広がっていきます。"], rest: 2.5 },
];
const END: Record<string, Page> = {
  A: { lines: ["赤い葉にも、", "白い雪。", "ビーバームーン。"], rest: 4 },
  B: { lines: ["雪は、しずかに", "降りつづけます。", "ビーバームーン。"], rest: 4 },
  C: { lines: ["ビーバームーン。"], rest: 4 },
  // 第2次（11/25 22:57 承認）：E1 は今の4行（物語の9ページのまま）、E2 は赤い葉と雪、E3 は名前だけ。
  E2: { lines: ["赤い葉にも、", "白い雪。", "ビーバームーン。"], rest: 3 },
  E3: { lines: ["ビーバームーン。"], rest: 3 },
};
/** 第2次の5ページ（挿絵は変えず、文を直す）：A 空の色、B ひとつの星。 */
const P5: Record<string, string[]> = {
  A: ["空が、少しずつ", "夜の色に染まっていきます。", "ビーバーは、住みかをちらり。", "もう、いっぽん。"],
  B: ["空に、ひとつ、", "星がまたたきました。", "ビーバーは、住みかをちらり。", "もう、いっぽん。"],
};
/** 第2次の段階1（本文と文字組みだけ）：余白は原版のまま（時間は段階2で見直す）。 */
const ORIGINAL_RESTS = [1, 1, 1, 1, 1.5, 2.5, 1.5, 1.5, 3];

export function beaverEnding<T extends FullMoonNameInfo | null>(story: T): T {
  const v = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("beaverEnd");
  if (!story?.book || story.name !== "ビーバームーン") return story;
  if (v === "E1" || v === "E2" || v === "E3" || v === "E4") return stage1(story, v);
  if (!v || !END[v]) return story;
  // 5ページ：「住みかをちらり。」を振り返る所（コマの 0.46）で、「もう、いっぽん。」を前を向き直した所（0.6）で。
  BEAVER_LINE_AT[4] = [0, 0, 0.46, 0.6];
  // 6ページ：明るみ（0.12）→ 月が出たあと、光の道（0.5）→ 見上げる姿（0.56）。「月」の字は出さない（推敲案）。
  BEAVER_LINE_AT[5] = [0.12, 0.12, 0.5, 0.56];
  // 9ページ C：絵だけの時間のあと、名前だけ（コマの半ば）。
  if (v === "C") BEAVER_LINE_AT[8] = [0.5];
  return { ...story, book: { ...story.book, pages: [...BASE, END[v]] } };
}

/** 見本（BM-R03）：?type=T1・T2 で文字組みを替える（ビーバームーンの物語の字幕だけ）。T0（付けない）は今のまま。 */
export function typeSample(): string {
  const v = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("type");
  return v === "T1" ? "ty-t1" : v === "T2" ? "ty-t2" : v === "T1c" ? "ty-t1c" : "";
}

/** 第2次の段階1：推敲案の本文（5ページは ?p5=A・B）、結末 E1・E2・E3、余白は原版のまま。 */
function stage1<T extends FullMoonNameInfo | null>(story: T, v: "E1" | "E2" | "E3" | "E4"): T {
  const p5 = new URLSearchParams(location.search).get("p5") === "A" ? "A" : "B";
  const book = story!.book!;
  const pages = BASE.map((pg, i) => ({ lines: i === 4 ? P5[p5] : pg.lines, rest: ORIGINAL_RESTS[i] }));
  const end = v === "E1" ? { lines: book.pages[8].lines, rest: ORIGINAL_RESTS[8] } : { ...END[v], rest: ORIGINAL_RESTS[8] };
  // 5ページ：B は一番星が灯る所（コマの 0.24）に「空に、ひとつ、」。「住みかをちらり。」は振り返る所（0.46）、「もう、いっぽん。」は前を向き直した所（0.6）。
  BEAVER_LINE_AT[4] = p5 === "B" ? [0.16, 0.16, 0.46, 0.6] : [0, 0, 0.46, 0.6];
  BEAVER_LINE_AT[5] = [0.12, 0.12, 0.5, 0.56];
  // 第2次では、どの結末も額縁は文が消えてから（11/25 渡辺さん「文字の消去完了後に額装を開始することを必須」）。
  const sc = STORY_SCENES["ビーバームーン"];
  if (sc) sc.frameAfterText = true;
  if (v === "E4") {
    // E4（11/25 渡辺さん、第一候補）：「赤い葉にも、白い雪。」を読んで、ゆっくり消し、文字の無い風景 1.2 秒、作品名を一文まるごと 1 秒で
    // 浮かべて残し、消えきってから額縁。最終ページ全体は約 15 秒（読む約 2.8 秒＋下の合計 12.1 秒）。
    const te = { text: "ビーバームーン。", readHold: 2.5, textFade: 1.2, gap: 1.2, fadeIn: 1.0, hold: 2.5, fadeOut: 1.0, picture: 1.5 };
    const after = te.readHold + te.textFade + te.gap + te.fadeIn + te.hold + te.fadeOut + 1.2 + te.picture;
    const last = { lines: ["赤い葉にも、", "白い雪。"], rest: Math.max(0, after - LAST_TAIL) };
    return { ...story, book: { ...book, pages: [...pages, last], titleEnd: te } } as T;
  }
  return { ...story, book: { ...book, pages: [...pages, end] } } as T;
}

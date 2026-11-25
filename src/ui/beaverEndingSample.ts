// 見本（マージしない、2026-11-25）：URL に ?beaverEnd=A・B・C を付けると、ビーバームーンの本文を推敲案（渡辺さんの共有した
// 「文学性を高める7つの工夫」の全9ページ）に差し替え、9ページだけ A・B・C の結末にする。付けなければ今のまま。
// 余白は外部レビューの試験値（1・1.5・1・1・2・3・2.5・2.5・4）。行の出る時刻は、振り返り・月・光の道・見上げる動きに合わせ直す。
import type { FullMoonNameInfo } from "../../shared/fullMoonNames";
import { BEAVER_LINE_AT } from "../design/story/BeaverWorld";

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
};

export function beaverEnding<T extends FullMoonNameInfo | null>(story: T): T {
  const v = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("beaverEnd");
  if (!story?.book || story.name !== "ビーバームーン" || !v || !END[v]) return story;
  // 5ページ：「住みかをちらり。」を振り返る所（コマの 0.46）で、「もう、いっぽん。」を前を向き直した所（0.6）で。
  BEAVER_LINE_AT[4] = [0, 0, 0.46, 0.6];
  // 6ページ：明るみ（0.12）→ 月が出たあと、光の道（0.5）→ 見上げる姿（0.56）。「月」の字は出さない（推敲案）。
  BEAVER_LINE_AT[5] = [0.12, 0.12, 0.5, 0.56];
  // 9ページ C：絵だけの時間のあと、名前だけ（コマの半ば）。
  if (v === "C") BEAVER_LINE_AT[8] = [0.5];
  return { ...story, book: { ...story.book, pages: [...BASE, END[v]] } };
}

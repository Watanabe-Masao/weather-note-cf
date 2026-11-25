// 見本（マージしない、2026-11-26 CM-R02・R03）：URL に ?cold2=1 を付けると、コールドムーンを秒で決める本（仮の演出）にし、
// 字幕をビーバームーンと同じ文字組み（19〜22px・500・字間 0.08em・行間 1.9）にする。?coldText=R で推敲候補の本文に。
// 付けなければ今のまま。本文の "/" は、列に収まらない画面だけで折る所（意味のまとまり）。
import type { FullMoonNameInfo } from "../../shared/fullMoonNames";
import { coldDirection } from "../design/story/coldDirection";
import { STORY_SCENES } from "../design/story/scenes";

/** 今の本文（承認B）に、折る所だけ入れたもの。 */
const NOW: string[][] = [
  ["森は、まっ白な雪の中。", "お日さまは、ひくい空を", "そっと通っていきます。"],
  ["ちょん、ちょん。", "雪の枝に、/小さなコガラ。", "黒いぼうしに、/白いほっぺ。"],
  ["ひとつぶ、/またひとつぶ。", "木の皮のすきまに、", "種をそっと、/しまいます。"],
  ["まだ、夕方なのに。", "森は、/もう青いかげの中。", "ひゅう。/つめたい風が吹きます。"],
  ["コガラは、/木の穴にもぐりこみます。", "羽を、/ふっくらふくらませて。", "ながい夜の、/はじまりです。"],
  ["雪の野原が、/ほのかに光りはじめて。", "おおきな、/まあるいお月さま。"],
  ["月は、/ゆっくりのぼっていきます。", "高く、もっと高く。", "雪の森は、/青白い光の中。"],
  ["ながい、ながい夜。", "コガラは、/まあるくなって眠ります。", "月の光が、/ゆっくり移っていきます。"],
  ["フィーチー、/フィーチー。", "朝の森に、/コガラの声。", "西の空には、/白い月が まだ のこっています。", "コールドムーン。"],
];
/** 推敲候補（R）：1・3・5・6 を直す。2・4・7 は今のまま、8・9 は本文を変えない（11/26 方針）。 */
const R: string[][] = [
  ["森は、まっ白な雪の中。", "ひくいお日さまに、", "木のかげが、/ながく のびます。"],
  NOW[1],
  ["ひとつぶ、/またひとつぶ。", "木の皮のすきまに、", "種を/しまっておきます。"],
  NOW[3],
  ["木の穴に、/もぐりこんで。", "羽を、ふっくら。", "ながい夜の、/はじまりです。"],
  ["雪の野原が、/ほのかに光って。", "まあるい、お月さま。"],
  NOW[6],
  NOW[7],
  NOW[8],
];

export function coldSample<T extends FullMoonNameInfo | null>(story: T): T {
  if (typeof location === "undefined" || !story?.book || story.name !== "コールドムーン") return story;
  const q = new URLSearchParams(location.search);
  if (q.get("cold2") !== "1") return story;
  if (q.get("coldVeil") === "1") document.documentElement.classList.add("cold-veil");
  const sc = STORY_SCENES["コールドムーン"];
  if (sc) {
    sc.direction = coldDirection;
    sc.pictureFirst = [5, 8];
  }
  const pages = q.get("coldText") === "R" ? R : NOW;
  return { ...story, book: { ...story.book, pages: pages.map((lines) => ({ lines })) } } as T;
}

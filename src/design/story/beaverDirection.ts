// ビーバームーンの演出（第2次の段階2、2026-11-25 23:24 渡辺さん承認）。秒はどれも試作の初期値。
//
// 緩急：前半（1〜4 ページ、作業の場面）は字の間隔を短く、余白も短く、軽やかに。5 で日が暮れて一度止まり
// （「もう、いっぽん。」の前に独立した間）、後半（6〜9、月夜）は字をゆっくり、絵が先に見える時間と余白を長く。
// 全文が出てからの読む時間は、承認の初期候補（1P 2.0〜3.0 … 9P 2.0〜3.0 秒）の中で決める。
import { type PageDirection, type TextUnit, unitsOf } from "./direction";

/** ページごとの時間（秒）。intro＝絵が先、readHold＝出そろってから読む、picture＝文が消えたあと絵だけ。 */
const PAGE: Pick<PageDirection, "intro" | "readHold" | "fadeOut" | "picture">[] = [
  { intro: 1.0, readHold: 2.5, fadeOut: 0.6, picture: 0.6 }, // 1 落ち葉：風景から始める
  { intro: 0.6, readHold: 2.5, fadeOut: 0.6, picture: 0.5 }, // 2 ちゃぷん：登場
  { intro: 0.4, readHold: 2.0, fadeOut: 0.6, picture: 0.4 }, // 3 枝を運ぶ：軽快に
  { intro: 0.4, readHold: 2.5, fadeOut: 0.6, picture: 0.6 }, // 4 泥を、ぺたぺた
  { intro: 1.0, readHold: 3.0, fadeOut: 0.7, picture: 1.0 }, // 5 夕暮れ：転換点
  { intro: 2.2, readHold: 3.5, fadeOut: 0.8, picture: 1.6 }, // 6 月の出：絵が先、鑑賞の時間を長く
  { intro: 0.8, readHold: 2.5, fadeOut: 0.8, picture: 1.2 }, // 7 さいごの、いっぽん
  { intro: 1.6, readHold: 3.5, fadeOut: 0.9, picture: 1.4 }, // 8 初雪：雪が先
  { intro: 1.5, readHold: 2.5, fadeOut: 1.2, picture: 1.5 }, // 9 最後の風景
];

/** 擬音・反復の行（一字ずつ、少し速く）。 */
const ONOMATOPOEIA = /^(はらり|ひらり|ちゃぷん|いっぽん。また|また、いっぽん)/;

function rule(page: number) {
  const late = page >= 5; // 月夜（6 ページから）は字をゆっくり
  return (line: string, index: number): Omit<TextUnit, "text"> => {
    if (ONOMATOPOEIA.test(line)) return { mode: "char", pauseBefore: index ? 0.3 : 0, charInterval: late ? 0.17 : 0.14, fadeIn: 0.22 };
    // 5 ページ：「もう、いっぽん。」は独立した間のあと、一文まるごと（文学的な転換点）。
    if (page === 4 && /^もう、いっぽん/.test(line)) return { mode: "line", pauseBefore: 1.3, fadeIn: 0.6 };
    // 7 ページ：「さいごの、いっぽん。」は一字ずつ、ゆっくり（最後の仕事）。
    if (page === 6 && /^さいごの/.test(line)) return { mode: "char", pauseBefore: 0.5, charInterval: 0.22, fadeIn: 0.35 };
    // 9 ページの作品名（E1〜E3 の最後の行）は一文まるごと。
    if (/^ビーバームーン。$/.test(line)) return { mode: "line", pauseBefore: 1.0, fadeIn: 1.0 };
    // ほかは文節のまとまりで。後半は区切りの前に少し長い間。
    return { mode: "phrase", pauseBefore: index ? (late ? 0.5 : 0.3) : 0, fadeIn: late ? 0.45 : 0.38 };
  };
}

/** 本文（ページごとに組版の印つきの行）から、ページごとの演出。 */
export function beaverDirection(pages: string[][]): PageDirection[] {
  return pages.map((lines, i) => ({ ...PAGE[Math.min(i, PAGE.length - 1)], units: unitsOf(lines.join("\n"), rule(i)) }));
}

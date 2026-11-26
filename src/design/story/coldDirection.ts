// コールドムーンの演出（第3次品質改善、2026-11-27 承認）：文の出し方と時間を秒で決める（direction.ts の共通の機構に、この
// 作品の値を渡す）。テーマ：言葉と言葉の間、光と影の移ろい、静寂によって時間を表現する。物語が進むにつれて言葉が少なくなり、
// 沈黙が意味を持つ（8P は「ながい、ながい夜。」の一文と、字のない時間）。夜が深くなるほど言葉の間と絵だけの時間を長くし、
// 朝で解き放つ。ビーバームーンの秒は使わない（終幕の形も同じにしない）。
// 経緯と比較は Project「コールドムーン_第3次品質改善_段階3_文章と終幕の案」「…_最終品質保証」。
import { type BookDirection, type PageDirection, type TextUnit, unitsOf } from "./direction";

/**
 * 8P→9P の秒：8P の文が消える秒・8P の絵だけの秒（字のない約 7 秒、月の光の移りで時間を見せる）・9P の絵が先の秒（夜明けへの
 * 移り）。場面（ColdWorld の 8P の光と 9P の夜明け）も同じ値で置く。
 */
export const SLEEP_TIMES = { fade8: 0.8, picture8: 7.2, intro9: 4.4 } as const;

const PAGE: Pick<PageDirection, "intro" | "readHold" | "fadeOut" | "picture">[] = [
  { intro: 1.6, readHold: 2.5, fadeOut: 0.8, picture: 1.0 }, // 1 冬の静かな導入（影がのびるのを先に）
  { intro: 0.4, readHold: 1.8, fadeOut: 0.6, picture: 0.6 }, // 2 コガラの軽やかな動き
  { intro: 0.6, readHold: 2.0, fadeOut: 0.6, picture: 0.8 }, // 3 種をしまう営み
  { intro: 1.2, readHold: 2.5, fadeOut: 0.8, picture: 1.2 }, // 4 昼から夜へ
  { intro: 1.0, readHold: 3.0, fadeOut: 1.0, picture: 1.8 }, // 5 静寂への移行
  { intro: 3.2, readHold: 3.5, fadeOut: 1.0, picture: 2.6 }, // 6 月の出：光が先、眺める時間
  { intro: 1.4, readHold: 3.0, fadeOut: 1.0, picture: 1.8 }, // 7 月が高く
  // 8 ながい夜：寝顔へ寄る 2 秒 →「ながい、」…「ながい夜。」→ 4 秒残す → 消える → 絵と月の光だけ（全体 18 秒ほど）。
  { intro: 2.0, readHold: 4.0, fadeOut: SLEEP_TIMES.fade8, picture: SLEEP_TIMES.picture8 },
  // 9 朝と終幕：夜明けへの移り（intro）→ 本文 → 作品名を 2.5 秒残して 0.7 秒で消す → 額縁。
  { intro: SLEEP_TIMES.intro9, readHold: 2.5, fadeOut: 0.7, picture: 1.6 },
];
const ONOMATOPOEIA = /^(ちょん|フィーチー)/;

function rule(page: number) {
  return (line: string, index: number): Omit<TextUnit, "text"> => {
    const late = page >= 4; // 夜へ向かうほど、間を長く
    const night = page === 5;
    if (ONOMATOPOEIA.test(line)) return { mode: "char", pauseBefore: index ? 0.4 : 0, charInterval: page === 8 ? 0.2 : 0.15, fadeIn: 0.25 };
    // 5P：「ながい夜の、はじまりです。」の前に、物語の時間が変わる間。
    if (page === 4 && /^ながい夜の/.test(line)) return { mode: "line", pauseBefore: 1.5, fadeIn: 0.8 };
    // 6P：雪原が明るむ → 1・2 行 → 月の縁が山の向こうに出て昇りはじめる間 →「山のむこうから、」→ 昇りきって「まあるい、冬の月。」
    if (page === 5 && /^山のむこう/.test(line)) return { mode: "phrase", pauseBefore: 1.6, fadeIn: 0.6 };
    // 8P：「ながい、」→ 約 3 秒の沈黙 →「ながい夜。」（読みやすさのための間ではなく、言葉の意味を体験させる間）。
    if (page === 7) return { mode: "phrase", pauseBefore: 0, fadeIn: 1.0, phraseGap: 2.3 };
    if (page === 8) {
      // 9P 第2節「西の空には、／まだ、白い月。」：前の節を読んで消し、西へ視線を移す 1 秒をおいて。
      if (/^西の空/.test(line)) return { mode: "phrase", pauseBefore: 0, fadeIn: 0.5, clearBefore: { fadeOut: 0.6, gap: 1.0, hold: 1.5 } };
      // 作品名：本文が消えて、朝の世界を絵だけで 2 秒眺めてから、独立した文学的な終止として。
      if (/^コールドムーン。$/.test(line)) return { mode: "line", pauseBefore: 0, fadeIn: 1.2, clearBefore: { fadeOut: 0.6, gap: 2.0, hold: 2.0 } };
      return { mode: "phrase", pauseBefore: index > 1 ? 0.4 : 0.5, fadeIn: index > 1 ? 0.5 : 0.6 };
    }
    return { mode: "phrase", pauseBefore: index ? (night ? 0.9 : late ? 0.7 : 0.4) : 0, fadeIn: late ? 0.55 : 0.4 };
  };
}

export function coldDirection(pages: string[][], title?: string): BookDirection {
  return {
    pages: pages.map((lines, i) => ({ ...PAGE[Math.min(i, PAGE.length - 1)], units: unitsOf(lines.join("\n"), rule(i)) })),
    title: title ? { gap: 1.4, fadeIn: 1.0, hold: 2.5, fadeOut: 1.0 } : undefined,
    // 額縁への移りと余韻（作品名が消えきってから）。
    frame: 2.0,
  };
}

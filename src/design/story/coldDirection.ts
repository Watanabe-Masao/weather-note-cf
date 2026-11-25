// 見本（マージしない、2026-11-26 CM-R03）：コールドムーンを秒で決める本にした仮の演出。文字組みの試作のための初期値で、
// 時間はまだ決めていない（CM-R05 で、夜が深くなるほど言葉の間と絵だけの時間を長くする緩急を設計する）。
import { type BookDirection, type PageDirection, type TextUnit, unitsOf } from "./direction";

const PAGE: Pick<PageDirection, "intro" | "readHold" | "fadeOut" | "picture">[] = [
  { intro: 1.5, readHold: 2.5, fadeOut: 0.7, picture: 1.0 }, // 1 冬の静かな導入
  { intro: 0.8, readHold: 2.0, fadeOut: 0.6, picture: 0.6 }, // 2 コガラの軽やかな動き
  { intro: 0.8, readHold: 2.0, fadeOut: 0.6, picture: 0.8 }, // 3 種を蓄える反復
  { intro: 1.2, readHold: 2.5, fadeOut: 0.8, picture: 1.2 }, // 4 昼から夜へ
  { intro: 1.2, readHold: 3.0, fadeOut: 0.9, picture: 1.6 }, // 5 静寂への移行
  { intro: 3.0, readHold: 3.5, fadeOut: 1.0, picture: 2.5 }, // 6 月の出を眺める
  { intro: 1.6, readHold: 3.0, fadeOut: 1.0, picture: 2.0 }, // 7 月が高く
  { intro: 2.5, readHold: 4.0, fadeOut: 1.2, picture: 3.5 }, // 8 長い夜（いちばん長く）
  { intro: 2.0, readHold: 3.0, fadeOut: 1.2, picture: 2.0 }, // 9 朝と終幕
];
const ONOMATOPOEIA = /^(ちょん|ひとつぶ|フィーチー|ひゅう)/;

function rule(page: number) {
  const late = page >= 4;
  return (line: string, index: number): Omit<TextUnit, "text"> => {
    if (ONOMATOPOEIA.test(line)) return { mode: "char", pauseBefore: index ? 0.4 : 0, charInterval: late ? 0.2 : 0.15, fadeIn: 0.25 };
    if (/^コールドムーン。$/.test(line)) return { mode: "line", pauseBefore: 1.2, fadeIn: 1.0 };
    return { mode: "phrase", pauseBefore: index ? (late ? 0.7 : 0.4) : 0, fadeIn: late ? 0.5 : 0.4 };
  };
}

export function coldDirection(pages: string[][], title?: string): BookDirection {
  return {
    pages: pages.map((lines, i) => ({ ...PAGE[Math.min(i, PAGE.length - 1)], units: unitsOf(lines.join("\n"), rule(i)) })),
    title: title ? { gap: 1.2, fadeIn: 1.0, hold: 2.5, fadeOut: 1.0 } : undefined,
    frame: 1.2,
  };
}

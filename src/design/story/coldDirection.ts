// 見本（マージしない、2026-11-26 CM-R03〜R08）：コールドムーンを秒で決める本にした試作の演出。
// 制作テーマ（11/26）：言葉と言葉の間、光と影の移ろい、静寂によって時間を表現する。夜が深くなるほど、言葉の間と絵だけの
// 時間を長くし（8 ページがいちばん長い）、朝で解き放つ。ページの区間の目安（レビュー 11/26）：1P 11〜13、2P 9〜11、3P 10〜12、
// 4P 11〜13、5P 12〜15、6P 15〜18、7P 13〜16、8P 18〜22、9P 14〜17 秒。ビーバームーンの秒は使わない。
import { type BookDirection, type PageDirection, type TextUnit, unitsOf } from "./direction";

const PAGE: Pick<PageDirection, "intro" | "readHold" | "fadeOut" | "picture">[] = [
  { intro: 1.6, readHold: 2.5, fadeOut: 0.8, picture: 1.0 }, // 1 冬の静かな導入（影がのびるのを先に）
  { intro: 0.4, readHold: 1.8, fadeOut: 0.6, picture: 0.6 }, // 2 コガラの軽やかな動き
  { intro: 0.6, readHold: 2.0, fadeOut: 0.6, picture: 0.8 }, // 3 種を蓄える反復
  { intro: 1.2, readHold: 2.5, fadeOut: 0.8, picture: 1.2 }, // 4 昼から夜へ
  { intro: 1.0, readHold: 3.0, fadeOut: 1.0, picture: 1.8 }, // 5 静寂への移行
  { intro: 3.2, readHold: 3.5, fadeOut: 1.0, picture: 2.6 }, // 6 月の出：光が先、眺める時間
  { intro: 1.4, readHold: 3.0, fadeOut: 1.0, picture: 1.8 }, // 7 月が高く
  { intro: 2.6, readHold: 4.0, fadeOut: 1.4, picture: 3.6 }, // 8 ながい夜（いちばん長い）
  { intro: 1.6, readHold: 3.0, fadeOut: 1.2, picture: 1.6 }, // 9 朝と終幕
];
const ONOMATOPOEIA = /^(ちょん|ひとつぶ|フィーチー)/;

/** 終幕の案（見本の切り替え）：A いまの4行、B 名前を独立、C 段階的に言葉を減らす。 */
export const COLD_END = { v: "A" as "A" | "B" | "C" | "C2" };
/** 見本の切り替え：view＝ページごとの視点（3P 近景、8P 遠景から近景へ）、dawn＝9P は朝の光を先に長く。 */
/** 見本（?coldSleep=1）の 8P→9P の秒：8P の文が消える秒・8P の絵だけの秒・9P の絵が先の秒。 */
export const SLEEP_TIMES = { fade8: 1.4, picture8: 5.2, intro9: 4.4 };
export const COLD_OPT: { view: boolean; dawn: boolean; cu?: [number, number]; split8?: boolean; sleep?: boolean; p67?: boolean; art3?: boolean; comp?: boolean; p3?: "A" | "B"; stars?: boolean; moon7?: number; bg?: "A" | "B" | "C" | "C2" } = { view: false, dawn: false };

function rule(page: number) {
  return (line: string, index: number): Omit<TextUnit, "text"> => {
    const late = page >= 4; // 夜へ向かうほど、間を長く
    const night = page === 5;
    if (ONOMATOPOEIA.test(line)) return { mode: "char", pauseBefore: index ? 0.4 : 0, charInterval: page === 8 ? 0.2 : 0.15, fadeIn: 0.25 };
    // 5 ページ：「ながい夜の、はじまりです。」の前に、物語の時間が変わる間（レビュー 1.2〜1.8 秒）。
    if (page === 4 && /^ながい夜の/.test(line)) return { mode: "line", pauseBefore: 1.5, fadeIn: 0.8 };
    // 8 ページ：一行ずつ、行の間をいちばん長く。
    // split8（試作）：一行ずつの節にして、前の行を消してから次の行（字が幹と穴にかからない。11/26）。
    if (page === 7 && COLD_OPT.split8) return { mode: "line", pauseBefore: 0, fadeIn: 0.9, ...(index ? { clearBefore: { fadeOut: 0.8, gap: 0.8, hold: 2.2 } } : {}) };
    if (page === 7) return { mode: "line", pauseBefore: index ? 1.6 : 0, fadeIn: 0.9 };
    // 9 ページ
    if (page === 8 && COLD_END.v === "C2") {
      // C2（11/26 レビュー）：節ごとに出して消す。第1節 → 消去 0.6・間 0.8 → 第2節 → 消去 0.6・風景だけ 1.2 → 作品名。
      if (/^西の空/.test(line)) return { mode: "phrase", pauseBefore: 0, fadeIn: 0.5, clearBefore: { fadeOut: 0.6, gap: 0.8, hold: 2.3 } };
      if (/^コールドムーン。$/.test(line)) return { mode: "line", pauseBefore: 0, fadeIn: 1.0, clearBefore: { fadeOut: 0.6, gap: 1.2, hold: 2.8 } };
    }
    if (page === 8) {
      if (/^コールドムーン。$/.test(line))
        return COLD_END.v === "C"
          ? { mode: "line", pauseBefore: 0.6, fadeIn: 1.0, clearBefore: { fadeOut: 1.2, gap: 1.2 } }
          : { mode: "line", pauseBefore: 1.2, fadeIn: 1.0 };
      if (COLD_END.v === "C" && /^西の空/.test(line)) return { mode: "phrase", pauseBefore: 0.6, fadeIn: 0.5, clearBefore: { fadeOut: 1.0, gap: 1.0 } };
    }
    return { mode: "phrase", pauseBefore: index ? (night ? 0.9 : late ? 0.7 : 0.4) : 0, fadeIn: late ? 0.55 : 0.4 };
  };
}

export function coldDirection(pages: string[][], title?: string): BookDirection {
  return {
    pages: pages.map((lines, i) => {
      const d = { ...PAGE[Math.min(i, PAGE.length - 1)], units: unitsOf(lines.join("\n"), rule(i)) };
      // C2 の作品名：2.5 秒残して 0.8 秒で消す（そのあと額縁）。
      // sleep：夜明けへの移りを順に（9P の intro 4.4、11/26 14:36）。8P の絵だけの時間は 5.2 秒（文が消えてから夜明けが
      // 始まるまで約6秒、11/26 14:16 採用）。ColdWorld の SLEEP_TIMES と同じ値。
      const d8 = i === 7 && COLD_OPT.sleep ? { ...d, picture: SLEEP_TIMES.picture8 } : d;
      const d9 = i === 8 && COLD_OPT.dawn ? { ...d8, intro: COLD_OPT.sleep ? SLEEP_TIMES.intro9 : 3.4 } : d8;
      return i === 8 && COLD_END.v === "C2" ? { ...d9, readHold: 2.5, fadeOut: 0.8 } : d9;
    }),
    title: title ? { gap: 1.4, fadeIn: 1.0, hold: 2.5, fadeOut: 1.0 } : undefined,
    frame: 1.2,
  };
}

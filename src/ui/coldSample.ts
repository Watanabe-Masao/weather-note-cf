// 見本（マージしない、2026-11-26 CM-R02〜R08）：コールドムーンの第2次品質改善の比べる案。URL の切り替え：
//   ?cold2=1          秒で決める本（試作の演出、coldDirection）と、ビーバームーンと同じ文字組み（19〜22px・500・0.08em・1.9）
//   &coldText=R|W     本文：R＝こちらの推敲候補（1・3・5・6P）、W＝レビューの追加案（1・3・6P、5P は R）。無ければ今の本文
//   &coldCap=PQBDS    字幕：P＝領域（列を長く、幹を避けて右へ）、Q＝幹の右の空に収める（右の余白・列の間を詰める）、B＝字の後ろだけ局所的に沈める、D＝昼・朝は濃い藍の字、S＝影を少し強く
//   &coldEnd=A|B|C    終幕：A いまの4行、B 名前を独立、C 段階的に言葉を減らす
//   &coldVeil=1       字幕の後ろ全体の沈めを濃く（前回の比べる案）
// 本文の "/" は、列に収まらない画面だけで折る所（意味のまとまり）。
import type { FullMoonNameInfo } from "../../shared/fullMoonNames";
import { COLD_CUES } from "../design/story/ColdWorld";
import { COLD_END, coldDirection } from "../design/story/coldDirection";
import { STORY_SCENES } from "../design/story/scenes";

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
const P1R = ["森は、まっ白な雪の中。", "ひくいお日さまに、", "木のかげが、/ながく のびます。"];
const P1W = ["森は、まっ白な雪の中。", "ひくい空に、お日さま。", "木のかげが、/ながくのびます。"];
const P3R = ["ひとつぶ、/またひとつぶ。", "木の皮のすきまに、", "種を/しまっておきます。"];
const P3W = ["木の皮のすきまに、", "小さな種を、ひとつ。", "もうひとつ、/べつのすきまに。"];
const P5R = ["木の穴に、/もぐりこんで。", "羽を、ふっくら。", "ながい夜の、/はじまりです。"];
const P6R = ["雪の野原が、/ほのかに光って。", "まあるい、お月さま。"];
const P6W = ["雪の野原が、", "ほのかに光ります。", "まあるい、お月さま。"];

const DAY = [0, 1, 2, 8]; // 明るい昼と朝（1〜3・9P）

export function coldSample<T extends FullMoonNameInfo | null>(story: T): T {
  if (typeof location === "undefined" || !story?.book || story.name !== "コールドムーン") return story;
  const q = new URLSearchParams(location.search);
  if (q.get("cold2") !== "1") return story;
  if (q.get("coldVeil") === "1") document.documentElement.classList.add("cold-veil");
  const cap = q.get("coldCap") ?? "";
  if (cap.includes("S")) document.documentElement.classList.add("cold-shadow");
  const text = q.get("coldText");
  const end = (q.get("coldEnd") ?? "A") as "A" | "B" | "C";
  COLD_END.v = end === "B" || end === "C" ? end : "A";
  const pages = NOW.map((p, i) => {
    if (text === "R") return [P1R, p, P3R, p, P5R, P6R][i] ?? p;
    if (text === "W") return [P1W, p, P3W, p, P5R, P6W][i] ?? p;
    return p;
  });
  // 終幕 B：9P は3行、名前は独立して浮かぶ（titleEnd）。
  if (COLD_END.v === "B") pages[8] = pages[8].slice(0, 3);
  const sc = STORY_SCENES["コールドムーン"];
  if (sc) {
    sc.direction = coldDirection;
    // 合図の言葉（本文の案に合わせる）：1P「ながく」で幹の影、3P 種、6P 雪原と月。
    const cues: Record<number, string[]> = { ...COLD_CUES };
    if (text) {
      cues[0] = ["なが"];
      cues[5] = ["雪の野原", "まあるい"];
    }
    if (text === "W") cues[2] = ["ひとつ", "もうひとつ"];
    sc.cues = cues;
    const caps: NonNullable<typeof sc.captions> = {};
    for (const i of DAY)
      caps[i] = {
        ...(cap.includes("P") ? { area: "tall" as const } : cap.includes("Q") ? { area: "sky" as const } : {}),
        ...(cap.includes("B") ? { backdrop: 0.9 } : {}),
        ...(cap.includes("D") ? { tone: "dark" as const } : {}),
      };
    // 夜のページは、字の後ろの沈めを控えめに（月の光を暗くしない）。8P は幹の明るい所にかかる字がある。
    if (cap.includes("B")) for (const i of [3, 4, 7]) caps[i] = { ...caps[i], backdrop: 0.5 };
    if (cap.includes("P")) for (const i of [3, 4, 6, 7]) caps[i] = { ...caps[i], area: "tall" as const };
    sc.captions = caps;
  }
  return {
    ...story,
    book: { ...story.book, pages: pages.map((lines) => ({ lines })), titleEnd: COLD_END.v === "B" ? "コールドムーン。" : undefined },
  } as T;
}

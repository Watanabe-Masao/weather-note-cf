// 見本（マージしない、2026-11-26 CM-R02〜R08）：コールドムーンの第2次品質改善の比べる案。URL の切り替え：
//   ?cold2=1          秒で決める本（試作の演出、coldDirection）と、ビーバームーンと同じ文字組み（19〜22px・500・0.08em・1.9）
//   &coldText=R|W     本文：R＝こちらの推敲候補（1・3・5・6P）、W＝レビューの追加案（1・3・6P、5P は R）。無ければ今の本文
//   &coldCap=PQBDS    字幕：P＝領域（列を長く、幹を避けて右へ）、Q＝幹の右の空に収める（右の余白・列の間を詰める）、B＝字の後ろだけ局所的に沈める、D＝昼・朝は濃い藍の字、S＝影を少し強く
//   &coldEnd=A|B|C|C2 終幕：A いまの4行、B 名前を独立、C 段階的に言葉を減らす、C2 意味のまとまり（節）ごとに同じ起点から
//   &coldSplit=1      1〜3P を意味のまとまり（節）ごとに時間で分ける
//   &coldCompose=1    小さな画面（374px 以下）だけ、絵を少し大きくして右を起点に（幹が左へ寄る）
//   &coldVeil=1       字幕の後ろ全体の沈めを濃く（前回の比べる案）
//   &coldView=1       ページごとの視点（3P を近景に、8P は遠景から木の穴の近景へゆっくり）
//   &coldDawn=1       9P は朝の光を先に長く（声の前に空が明るむ）
// 本文の "/" は、列に収まらない画面だけで折る所（意味のまとまり）。
import type { FullMoonNameInfo } from "../../shared/fullMoonNames";
import { COLD_CUES } from "../design/story/ColdWorld";
import { COLD_END, COLD_OPT, coldDirection } from "../design/story/coldDirection";
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
  const end = q.get("coldEnd") ?? "A";
  COLD_END.v = end === "B" || end === "C" || end === "C2" ? end : "A";
  if (q.get("coldCompose") === "1") document.documentElement.classList.add("cold-compose");
  const split = q.get("coldSplit") === "1";
  COLD_OPT.view = q.get("coldView") === "1";
  COLD_OPT.dawn = q.get("coldDawn") === "1";
  // 8P の寄りの行き先（穴からの横のずれ、倍率）。試作：?coldCU=40,1.9
  const cu = q.get("coldCU")?.split(",").map(Number);
  COLD_OPT.cu = cu && cu.length === 2 && cu.every(Number.isFinite) ? [cu[0], cu[1]] : undefined;
  COLD_OPT.split8 = q.get("cold8Split") === "1";
  COLD_OPT.sleep = q.get("coldSleep") === "1"; // 8P の寄りで A-11（穴の口と眠るコガラ）に入れ替える
  const pages = NOW.map((p, i) => {
    if (text === "R") return [P1R, p, P3R, p, P5R, P6R][i] ?? p;
    if (text === "W") return [P1W, p, P3W, p, P5R, P6W][i] ?? p;
    return p;
  });
  // 終幕 B：9P は3行、名前は独立して浮かぶ（titleEnd）。C2：3つの節（空の行で区切る）。
  if (COLD_END.v === "B") pages[8] = pages[8].slice(0, 3);
  if (COLD_END.v === "C2") pages[8] = [pages[8][0], pages[8][1], "", pages[8][2], "", pages[8][3]];
  // 時間で分ける（?coldSplit=1、1〜3P）：意味のまとまりごとの節にして、同じ起点から出す。
  if (split) {
    const at = (i: number, k: number) => [...pages[i].slice(0, k), "", ...pages[i].slice(k)];
    pages[0] = at(0, 1); // 森の情景 ／ 低い日と影
    pages[1] = at(1, 2); // 小さなコガラ ／ 帽子と頬
    pages[2] = at(2, text === "W" ? 2 : 1); // W：一つ目 ／ もう一つ、R：反復 ／ 隠す
  }
  // 8P を一行ずつの節に（?cold8Split=1）。言葉は変えない。
  if (COLD_OPT.split8) pages[7] = [pages[7][0], "", pages[7][1], "", pages[7][2]];
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
    // 9P（夜明け）：縦に長い画面では、字の出はじめを 8svh 下げる（空の上の暗い青を避ける。11/26）。
    if (cap.includes("D")) caps[8] = { ...caps[8], drop: 8 };
    sc.captions = caps;
  }
  return {
    ...story,
    book: { ...story.book, pages: pages.map((lines) => ({ lines })), titleEnd: COLD_END.v === "B" ? "コールドムーン。" : undefined },
  } as T;
}

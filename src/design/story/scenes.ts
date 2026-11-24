// 絵本の場面がある満月（呼び名 → 世界の絵と動き）。場面の数は、その満月の物語の文（shared/fullMoonNames.ts の
// tale.lines）の数と同じ（一文が一コマ）。まだ場面の無い満月は、本の表紙と文だけで見せる。
// 2026-11-20：まずビーバームーン（見本）。渡辺さんの OK のあと、ほかの 12 の満月とブルームーンを足す。
import type { ReactElement } from "react";
import { storyAsset } from "./storyAssets";
import {
  BEAVER_BEATS,
  BEAVER_LINE_AT,
  BEAVER_SKY,
  BeaverCoverArt,
  BeaverPaperArt,
  BeaverWindow,
  BeaverWorld,
  buildBeaverScene,
} from "./BeaverWorld";
import { COLD_BEATS, COLD_CUES, COLD_LINE_PAUSE, COLD_SKY, ColdCoverArt, ColdPaperArt, ColdWindow, ColdWorld, buildColdScene } from "./ColdWorld";
import { BOOK } from "./palette";

export type StoryScene = {
  /** 場面（コマ）の数。 */
  beats: number;
  World: () => ReactElement;
  /** 本のページの窓の絵（場面の最初のコマの小さな絵）。 */
  Window: () => ReactElement;
  /** 場面の最初の空の色（窓から場面へつなぐ CSS の背景）。 */
  sky: string;
  /** 表紙の真ん中の絵（渡辺さんの素材を重ねた小さな場面。文字は画面の側で、絵に入れない）。 */
  CoverArt?: () => ReactElement;
  /** 本棚の背の、型押しの月と紋の絵（素材）。 */
  spineArt?: { moon: string; emblem: string };
  /** 知識の紙のページの下の淡い絵（セピア）。名前の由来と自然との関係で別の絵。 */
  PaperArt?: (p: { kind: "origin" | "nature" }) => ReactElement;
  /** 表紙の上の二隅に置く飾りの枝（素材。左は返して使う）。 */
  coverCorner?: string;
  /** 閉じた本の表の真ん中の型押しの絵（素材）。無ければ、表紙の裏の絵を光の効果で型押しにして見せる。 */
  closedArt?: string;
  /**
   * 場面の動き。cueAt は、cues の言葉の最初の字が出る拍（ページごと、言葉の順）。動きを言葉に合わせる場面だけが使う。
   */
  build: (gsap: never, root: Element, tl: never, loops?: boolean, cueAt?: Record<number, number[]>) => { play: () => unknown; pause: () => unknown } | null;
  /**
   * 言葉の合図（11/23 レビュー「跳躍や種は、言葉ごとの間に合わせる」）：ページ（0 から）→ 動きを合わせる言葉（本文に出る順）。
   * 物語の画面がその言葉の最初の字が出る拍を計算して、build の cueAt に渡す。
   */
  cues?: Record<number, string[]>;
  /**
   * 行の前の間（秒）：ページ（0 から）→ 行ごとに、その行を出す前に絵の動きを見せる秒。読む時間に足すので、コマがそのぶん
   * 長くなる（lineAt と違い、読み終えてからの rest や、ほかの行の速さを削らない）。
   */
  linePause?: Record<number, number[]>;
  /**
   * 一枚の絵の金の枠を、最後のページの文が消えてから出す（11/23 渡辺さん「枠が現れるタイミングはこれが適切？」：文を読んで
   * いる間に枠が出ていた）。無ければ、いままでどおり最後のページの 0.25 から。
   */
  frameAfterText?: boolean;
  /**
   * 字の後ろを少しだけ沈める（11/23：コールドムーンは白いシラカバの幹が字の後ろに来て読みにくかった）。字の列の後ろの
   * 影（.ms-caps-veil）を少し濃く広く、字のまわりのにじみ（text-shadow）を一段足す。濃くはせず、背景から字をわずかに分ける。
   */
  capShade?: boolean;
  /**
   * 行を出しはじめる所（コマの中の 0〜1、行ごと）。絵の動きに合わせて行を出すページだけ（11/21 絵コンテ v0.3：6ページは
   * 丘が明るむと1行目、月の縁が出ると2行目）。無いページは、行を続けて朗読の速さで出す。
   */
  lineAt?: Record<number, number[]>;
  /**
   * 動きを減らす設定で見せる一枚の絵の位置（拍）。無ければ最後から 1.5 拍前（ビーバームーンは月が昇ったあと）。
   * コールドムーンは7ページ（高い月と、穴の中のコガラ）で止まった所。
   */
  still?: number;
  /**
   * 物語のページの地の空の流れ（.moon-story の --sky-0 / --sky-1、上・下）：表紙のあたり → 場面の終わり → あとがきから先。
   * 無ければ、夕方 → 夜 → 深夜（palette.ts の BOOK.dusk / night / deep）。コールドムーンは 昼 → 夕 → 夜 → 夜明け（PR-3）。
   */
  bookSky?: { start: [string, string]; end: [string, string]; after: [string, string] };
};

export const STORY_SCENES: Record<string, StoryScene> = {
  ビーバームーン: {
    beats: BEAVER_BEATS,
    World: BeaverWorld,
    Window: BeaverWindow,
    sky: BEAVER_SKY,
    CoverArt: BeaverCoverArt,
    spineArt: {
      moon: storyAsset("beaver", "emboss"),
      emblem: storyAsset("beaver", "beaver"),
    },
    coverCorner: storyAsset("beaver", "branch"),
    closedArt: storyAsset("beaver", "emboss-medal"),
    PaperArt: BeaverPaperArt,
    build: buildBeaverScene,
    lineAt: BEAVER_LINE_AT,
  },
  // 11/22 PR-2（実装計画 v0.2）：場面の寄り・引きと主役の出入り。11/23 PR-3：言葉との同期（lineAt）と夜明けの空（bookSky）。
  コールドムーン: {
    beats: COLD_BEATS,
    World: ColdWorld,
    Window: ColdWindow,
    sky: COLD_SKY,
    CoverArt: ColdCoverArt,
    spineArt: {
      moon: storyAsset("cold", "emboss"),
      emblem: storyAsset("cold", "perch"),
    },
    coverCorner: storyAsset("cold", "branch-berry"),
    closedArt: storyAsset("cold", "emboss-medal"),
    PaperArt: ColdPaperArt,
    build: buildColdScene,
    linePause: COLD_LINE_PAUSE,
    cues: COLD_CUES,
    frameAfterText: true,
    capShade: true,
    still: 6.78,
    bookSky: { start: BOOK.coldStart, end: BOOK.coldDawn, after: BOOK.coldAfter },
  },
};

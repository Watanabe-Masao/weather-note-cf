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
  build: typeof buildBeaverScene;
  /**
   * 行を出しはじめる所（コマの中の 0〜1、行ごと）。絵の動きに合わせて行を出すページだけ（11/21 絵コンテ v0.3：6ページは
   * 丘が明るむと1行目、月の縁が出ると2行目）。無いページは、行を続けて朗読の速さで出す。
   */
  lineAt?: Record<number, number[]>;
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
};

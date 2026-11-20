// 絵本の場面がある満月（呼び名 → 世界の絵と動き）。場面の数は、その満月の物語の文（shared/fullMoonNames.ts の
// tale.lines）の数と同じ（一文が一コマ）。まだ場面の無い満月は、本の表紙と文だけで見せる。
// 2026-11-20：まずビーバームーン（見本）。渡辺さんの OK のあと、ほかの 12 の満月とブルームーンを足す。
import type { ReactElement } from "react";
import { storyAsset } from "./storyAssets";
import { BEAVER_BEATS, BEAVER_SKY, BeaverCoverArt, BeaverWindow, BeaverWorld, buildBeaverScene } from "./BeaverWorld";

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
  /** 表紙の上の二隅に置く飾りの枝（素材。左は返して使う）。 */
  coverCorner?: string;
  build: typeof buildBeaverScene;
};

export const STORY_SCENES: Record<string, StoryScene> = {
  ビーバームーン: { beats: BEAVER_BEATS, World: BeaverWorld, Window: BeaverWindow, sky: BEAVER_SKY, CoverArt: BeaverCoverArt, spineArt: { moon: storyAsset("beaver", "emboss"), emblem: storyAsset("beaver", "beaver") }, coverCorner: storyAsset("beaver", "branch"), build: buildBeaverScene },
};

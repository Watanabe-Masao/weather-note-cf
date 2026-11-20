// 絵本の場面がある満月（呼び名 → 世界の絵と動き）。場面の数は、その満月の物語の文（shared/fullMoonNames.ts の
// tale.lines）の数と同じ（一文が一コマ）。まだ場面の無い満月は、本の表紙と文だけで見せる。
// 2026-11-20：まずビーバームーン（見本）。渡辺さんの OK のあと、ほかの 12 の満月とブルームーンを足す。
import type { ReactElement } from "react";
import { BEAVER_BEATS, BeaverWorld, buildBeaverScene } from "./BeaverWorld";

export type StoryScene = {
  /** 場面（コマ）の数。 */
  beats: number;
  World: () => ReactElement;
  build: typeof buildBeaverScene;
};

export const STORY_SCENES: Record<string, StoryScene> = {
  ビーバームーン: { beats: BEAVER_BEATS, World: BeaverWorld, build: buildBeaverScene },
};

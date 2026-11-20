// 満月の物語の絵の素材（11/20 18:42 渡辺さんの素材「ビーバームーン 素材セット」）の台帳。
// 元は design-src/story/<満月>/sheet.png（素材を並べた一枚の絵）。scripts/story-assets.ts が、ここの枠で切り出し、
// 背景の紺を透かして（key）、public/event/story/<満月>/<名前>.webp に置く（/event/ の下なので、版つきの URL で
// 一度読んだら取っておかれる。docs/event-banner.md と同じ扱い）。
// 一枚の絵から切るので解像度は低い（月で約130px）。渡辺さんの zip（weather_note_beaver_separated）の切り抜きは、ラベルと
// 周りの絵が入り背景も透けていない（同梱の README のとおり）ので、同じ元の絵からここの枠で切り直す。渡辺さんから素材を一つずつの高解像度の PNG でもらえたら、同じ名前で
// 差し替える（そのときは sheet の枠ではなく、ファイルをそのまま縮める）。
export type StoryAsset = {
  /** 元の一枚の絵の中の枠（x, y, 幅, 高さ、px）。file のときは無し。 */
  rect?: [number, number, number, number];
  /** 一枚で届いた素材（design-src/story/ の下のファイル、透けている PNG）。 */
  file?: string;
  /** 背景の紺を透かす（明るい素材だけ。暗い素材は透かすと欠けるので四角のまま）。 */
  key?: boolean;
  /** 書き出す幅（px、元より大きくしない）。 */
  width?: number;
  /** webp の質（既定 0.9）。 */
  quality?: number;
};

export const STORY_ASSET_VERSION = 2;

export const STORY_ASSETS: Record<string, Record<string, StoryAsset>> = {
  // どの満月にも使う物。本棚（11/20 18:50 渡辺さんの絵、1199×1312、外は透けている）。
  common: {
    shelf: { file: "design-src/story/shelf.png", width: 720, quality: 0.8 },
  },
  beaver: {
    // 11/20 19:41 渡辺さんの素材（weather_note_beaver_assets_cleaned：透けている一枚ずつの PNG、要求書の名前）。
    moon: { file: "design-src/story/common/moon.png", width: 512 },
    emboss: { file: "design-src/story/common/emboss.png", width: 160 },
    "beaver-branch": { file: "design-src/story/beaver/pack/hero-act.png", width: 480 },
    beaver: { file: "design-src/story/beaver/pack/hero-look.png", width: 480 },
    "beaver-swim": { file: "design-src/story/beaver/pack/hero-move.png", width: 400 },
    "beaver-nest": { file: "design-src/story/beaver/pack/prop.png", width: 480 },
    nest: { file: "design-src/story/beaver/pack/prop.png", width: 480 },
    "leaf-large": { file: "design-src/story/beaver/pack/float-1.png", width: 96 },
    "leaf-small": { file: "design-src/story/beaver/pack/float-2.png", width: 96 },
    "leaf-tiny": { file: "design-src/story/beaver/pack/float-3.png", width: 96 },
    tree: { file: "design-src/story/beaver/pack/tree-secondary.png", width: 360 },
    "tree-big": { file: "design-src/story/beaver/pack/tree.png", width: 400 },
    branch: { file: "design-src/story/beaver/pack/branch.png", width: 480 },
    reflection: { file: "design-src/story/beaver/pack/reflection.png", width: 400 },
    reed: { file: "design-src/story/beaver/pack/grass.png", width: 300 },
    foreground: { file: "design-src/story/beaver/pack/foreground.png", width: 600 },
    pines: { rect: [1424, 732, 84, 64], key: true },
  },
};

/**
 * 本棚の絵を枠として伸ばすときの切り方（border-image-slice、書き出した 720px 幅の絵の px）：上の飾り・左右の柱・下の台。
 * 元の絵（1199px 幅）で上 300・右 131・下 244・左 140。中（二段の棚）は伸びる。中の棚板は、中の高さの 45〜52%。
 */
export const SHELF_SLICE = [180, 79, 147, 84] as const;

/** 素材の URL（版つき）。 */
export const storyAsset = (moon: string, name: string) => `/event/story/${moon}/${name}.webp?v=${STORY_ASSET_VERSION}`;

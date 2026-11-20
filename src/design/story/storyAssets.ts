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

export const STORY_ASSET_VERSION = 1;

export const STORY_ASSETS: Record<string, Record<string, StoryAsset>> = {
  // どの満月にも使う物。本棚（11/20 18:50 渡辺さんの絵、1199×1312、外は透けている）。
  common: {
    shelf: { file: "design-src/story/shelf.png", width: 720, quality: 0.8 },
  },
  beaver: {
    moon: { rect: [678, 108, 128, 128], key: true },
    emboss: { rect: [522, 112, 126, 126], key: true },
    // ビーバー：枝を持つ（巣の上）・巣の上・月を見上げる。
    "beaver-branch": { rect: [512, 448, 128, 94], key: true },
    "beaver-nest": { rect: [654, 446, 144, 96], key: true },
    beaver: { rect: [820, 450, 82, 92], key: true },
    "leaf-large": { rect: [758, 614, 58, 56], key: true },
    "leaf-small": { rect: [828, 622, 46, 44], key: true },
    "leaf-tiny": { rect: [892, 630, 30, 30], key: true },
    pines: { rect: [1424, 732, 84, 64], key: true },
    nest: { rect: [918, 472, 146, 68], key: true },
    tree: { rect: [1096, 452, 122, 90], key: true },
    branch: { rect: [516, 608, 110, 68], key: true },
    reflection: { rect: [1270, 320, 98, 70], key: true },
    reed: { rect: [1434, 452, 76, 90], key: true },
  },
};

/**
 * 本棚の絵を枠として伸ばすときの切り方（border-image-slice、書き出した 720px 幅の絵の px）：上の飾り・左右の柱・下の台。
 * 元の絵（1199px 幅）で上 300・右 131・下 244・左 140。中（二段の棚）は伸びる。中の棚板は、中の高さの 45〜52%。
 */
export const SHELF_SLICE = [180, 79, 147, 84] as const;

/** 素材の URL（版つき）。 */
export const storyAsset = (moon: string, name: string) => `/event/story/${moon}/${name}.webp?v=${STORY_ASSET_VERSION}`;

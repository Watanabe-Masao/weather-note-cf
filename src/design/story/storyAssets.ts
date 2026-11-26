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
    // 本の背の型押しの月（どの満月の本にも。11/20 19:52 渡辺さんの見本の背）。
    emboss: { file: "design-src/story/common/emboss.png", width: 160 },
  },
  beaver: {
    // 11/20 19:41 渡辺さんの素材（weather_note_beaver_assets_cleaned：透けている一枚ずつの PNG、要求書の名前）。
    moon: { file: "design-src/story/common/moon.png", width: 512 },
    emboss: { file: "design-src/story/common/emboss.png", width: 160 },
    "beaver-branch": {
      file: "design-src/story/beaver/pack/hero-act.png",
      width: 480,
    },
    beaver: { file: "design-src/story/beaver/pack/hero-look.png", width: 480 },
    "beaver-swim": {
      file: "design-src/story/beaver/pack/hero-move.png",
      width: 400,
    },
    // A-01（11/21 渡辺さんの素材、承認済み）：泳ぎながら細い枝をくわえた姿。beaver-swim は置き換えず、別に足す。
    // 絵本の2・3・7ページ（Project「ビーバームーン_絵コンテと本文」v0.3）。尾と枝が入るぶん、beaver-swim より横に広い。
    "beaver-swim-branch": {
      file: "design-src/story/beaver/pack/hero-move-branch.png",
      width: 480,
    },
    // 11/21 02:22 渡辺さんの追加素材（絵コンテ v0.3「追加で欲しい素材」A-02〜A-08）。白・市松の地は透かし、光のにじみは
    // 落として design-src/story/beaver/pack2/ に置いた。どの場面で使うかは場面の PR（PR-4b・4c）で決める。
    twig: { file: "design-src/story/beaver/pack2/a02-twig.png", width: 240 },
    "nest-snow": { file: "design-src/story/beaver/pack2/a03-snow-lodge.png", width: 480 },
    "beaver-dive": { file: "design-src/story/beaver/pack2/a04-dive.png", width: 360 },
    "beaver-mud": { file: "design-src/story/beaver/pack2/a05-mud-lodge.png", width: 520 },
    "beaver-mud-pile": { file: "design-src/story/beaver/pack2/a05-mud-pile.png", width: 520 },
    "beaver-pat": { file: "design-src/story/beaver/pack2/a05-pat-sticks.png", width: 520 },
    "beaver-mudball": { file: "design-src/story/beaver/pack2/a05-mudball.png", width: 520 },
    "pile-small": { file: "design-src/story/beaver/pack2/a06-pile-small.png", width: 480 },
    "pile-mid": { file: "design-src/story/beaver/pack2/a06-pile-mid.png", width: 480 },
    "pile-large": { file: "design-src/story/beaver/pack2/a06-pile-large.png", width: 480 },
    "beaver-swim-branch-blue": { file: "design-src/story/beaver/pack2/a08-swim-branch-blue.png", width: 480 },
    // 11/21 17:35・17:45 渡辺さんの追加素材（Project「ビーバームーン_素材の依頼_追加」v0.2 の B-01〜B-07）。いまの姿に
    // 毛の明るさを合わせて（0.88 倍）、うすいもやを落とし、透けていない所で切り詰めて design-src/story/beaver/pack3/ に置いた。
    "beaver-turn": { file: "design-src/story/beaver/pack3/b01-turn.png", width: 480 },
    "beaver-ahead": { file: "design-src/story/beaver/pack3/b02-ahead.png", width: 480 },
    "beaver-mud2": { file: "design-src/story/beaver/pack3/b06-mud.png", width: 520 },
    "first-branch": { file: "design-src/story/beaver/pack3/b03a-first-branch.png", width: 360 },
    "first-branch-snow": { file: "design-src/story/beaver/pack3/b03b-first-branch-snow.png", width: 360 },
    "beaver-swim-first": { file: "design-src/story/beaver/pack3/b04-swim-first.png", width: 520 },
    "beaver-down": { file: "design-src/story/beaver/pack3/b05-down.png", width: 480 },
    "beaver-peek": { file: "design-src/story/beaver/pack3/b07-peek.png", width: 480 },
    // 閉じた本の表の型押し（11/21 渡辺さんの素材：紺の革に金で押した月とビーバー。丸く切り抜き、まわりは透明）。
    "emboss-medal": { file: "design-src/story/beaver/pack3/b08-emboss-medal.png", width: 520 },
    "beaver-nest": {
      file: "design-src/story/beaver/pack/prop.png",
      width: 480,
    },
    nest: { file: "design-src/story/beaver/pack/prop.png", width: 480 },
    "leaf-large": {
      file: "design-src/story/beaver/pack/float-1.png",
      width: 96,
    },
    "leaf-small": {
      file: "design-src/story/beaver/pack/float-2.png",
      width: 96,
    },
    "leaf-tiny": {
      file: "design-src/story/beaver/pack/float-3.png",
      width: 96,
    },
    tree: {
      file: "design-src/story/beaver/pack/tree-secondary.png",
      width: 360,
    },
    "tree-big": { file: "design-src/story/beaver/pack/tree.png", width: 400 },
    branch: { file: "design-src/story/beaver/pack/branch.png", width: 480 },
    reflection: {
      file: "design-src/story/beaver/pack/reflection.png",
      width: 400,
    },
    reed: { file: "design-src/story/beaver/pack/grass.png", width: 300 },
    foreground: {
      file: "design-src/story/beaver/pack/foreground.png",
      width: 600,
    },
    pines: { rect: [1424, 732, 84, 64], key: true },
  },
  // コールドムーン（11/22 渡辺さんの素材、検収済み。design-src/story/cold/pack/README.md）。幅は「納品の決まり」の
  // 画素の目安（画面で表示する最大の大きさの3倍）と元の大きさの小さい方。背景の3枚は寄るとぼけてよい（遠いので）。
  cold: {
    moon: { file: "design-src/story/common/moon.png", width: 512 },
    emboss: { file: "design-src/story/common/emboss.png", width: 160 },
    perch: { file: "design-src/story/cold/pack/c01-perch.png", width: 640 },
    "perch-berry": { file: "design-src/story/cold/pack/c01b-perch-berry.png", width: 520 },
    "seed-trunk": { file: "design-src/story/cold/pack/c03-seed-trunk.png", width: 900, quality: 0.8 },
    "trunk-empty": { file: "design-src/story/cold/pack/c03b-trunk-empty.png", width: 900, quality: 0.8 },
    seed: { file: "design-src/story/cold/pack/c04-seed.png", width: 240 },
    "trunk-hole": { file: "design-src/story/cold/pack/c05-trunk-hole.png", width: 1024, quality: 0.8 },
    "trunk-plain": { file: "design-src/story/cold/pack/c05b-trunk-plain.png", width: 1024, quality: 0.8 },
    "trunk-dawn": { file: "design-src/story/cold/pack/c05c-trunk-dawn.png", width: 1024, quality: 0.8 },
    "trunk-fork": { file: "design-src/story/cold/pack/c05d-trunk-fork.png", width: 1024, quality: 0.8 },
    cling: { file: "design-src/story/cold/pack/c03c-cling.png", width: 480 },
    bough: { file: "design-src/story/cold/pack/c09c-bough.png", width: 900, quality: 0.8 },
    air: { file: "design-src/story/cold/pack/c12-air.png", width: 512, quality: 0.8 },
    "moon-air": { file: "design-src/story/cold/pack/c12b-moon-air.png", width: 512, quality: 0.8 },
    mist: { file: "design-src/story/cold/pack/c12c-mist.png", width: 1000, quality: 0.8 },
    "fluff-open": { file: "design-src/story/cold/pack/c06-fluff-open.png", width: 720 },
    "fluff-closed": { file: "design-src/story/cold/pack/c06-fluff-closed.png", width: 720 },
    song: { file: "design-src/story/cold/pack/c07-song.png", width: 560 },
    fly: { file: "design-src/story/cold/pack/c11-fly.png", width: 560 },
    far: { file: "design-src/story/cold/pack/c08-far.png", width: 1400, quality: 0.8 },
    middle: { file: "design-src/story/cold/pack/c08-middle.png", width: 1400, quality: 0.8 },
    // 第3次品質改善（2026-11-27 承認）。7P の月の明暗だけを戻すための、月の濃淡（灰色、明暗を強めた版。かけ算で重ねる）。
    "moon-relief": { file: "design-src/story/cold/pack/moon-relief.png", width: 512 },
    // 上へのびる二本の枝の樹皮（c05b の幹を縦に3つ、つなぎ目をぼかして重ねた）。
    limb: { file: "design-src/story/cold/pack/c05e-limb.png", width: 240, quality: 0.8 },
    // いちばん手前の雪と枯れ草の、下の端と左右の端を雪へぼかした版（引いた構図で切り口を見せない）。
    "near-c3": { file: "design-src/story/cold/pack/c08-near-c3.png", width: 1400, quality: 0.8 },
    // 背景 C2 の中景。c08-middle の彩度・明暗差・鮮明さを抑えた版（遠くなるほど情報が減る）。
    "middle-c2": { file: "design-src/story/cold/pack/c08-middle-c2.png", width: 1400, quality: 0.8 },
    near: { file: "design-src/story/cold/pack/c08-near.png", width: 1400, quality: 0.8 },
    branch: { file: "design-src/story/cold/pack/c09-branch.png", width: 1000, quality: 0.8 },
    "branch-berry": { file: "design-src/story/cold/pack/c09b-branch-berry.png", width: 520 },
    "emboss-medal": { file: "design-src/story/cold/pack/c10-emboss-medal.png", width: 520 },
    // A-11（11/26 届いた2枚目の案）：穴の口と、中で眠るコガラ。8P の寄りで幹の穴に溶けるように入れ替える（口の中心 675,616、横の半径 203）。
    "hole-sleep": { file: "design-src/story/cold/pack/a11-hole-sleep.png", width: 1024 },
    // 動きを減らす設定の 8P の止まった絵（月の光が届いたあとの寝顔。A-11 に月の光と穴の縁の霜を重ねた 8P の画面から切り出した 720px 角。元は 8P の画面なので、場面を変えたら撮り直す）。
    "sleep-still": { file: "design-src/story/cold/pack/a11s-sleep-still.png", width: 720 },
  },
};

/**
 * 本棚の絵を枠として伸ばすときの切り方（border-image-slice、書き出した 720px 幅の絵の px）：上の飾り・左右の柱・下の台。
 * 元の絵（1199px 幅）で上 300・右 131・下 244・左 140。中（二段の棚）は伸びる。中の棚板は、中の高さの 45〜52%。
 */
export const SHELF_SLICE = [180, 79, 147, 84] as const;

/** 素材の URL（版つき）。 */
export const storyAsset = (moon: string, name: string) =>
  `/event/story/${moon}/${name}.webp?v=${STORY_ASSET_VERSION}`;

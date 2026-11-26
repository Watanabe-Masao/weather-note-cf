// コールドムーンの絵本の世界（PR-2：場面。Project「コールドムーン_絵コンテと本文」v0.5・「実装計画」v0.2）。
// 一枚の続いた雪の森を、絵本の1ページごとに場面（コマ）として見せる：
//   1 雪の森（遠景）→ 2 雪の枝の小さなコガラ → 3 幹のすきまに種をかくす → 4 はやい夕暮れ（引く）→ 5 木の穴へ →
//   6 引いて、北東の地平線から月が昇る（穴の口のコガラが月を見る）→ 7 見上げる（月が高く）→ 8 穴の口に寄る（眠る）→
//   9 夜明けの森の一枚の絵（西の空に白い月、枝でさえずるコガラ）。
// 描き方はビーバームーンにそろえる（11/22 渡辺さん「テイストを揃えましょう」）：山・林・雪原は平たい色の面で描き、
// 描き込んだ素材は、ビーバーの紅葉の枝・住みか・手前の草と同じ置き方で「アクセント」にだけ使う
// （左上の雪の枝 c09、主役のシラカバの穴のあたり c05、いちばん手前の雪と枯れ草 c08-near）。水平の層（空・山・林・雪原・手前の雪）はどのページも同じ高さで、
// 主役はどのページも画面の下の方に、同じくらいの大きさで居る。夜は地上を紺に沈め、月の金を主役にする。
// この PR は、コマごとの寄り・引きと主役の出入りまで。言葉に合わせた細かい動き（跳ねる・種・ひゅう・月明かりの帯・
// 夜明けの順）は PR-3。色はここ（デザインの層）にだけ書く。素材は design-src/story/cold/pack/（11/22 検収）。
import type { ReactElement } from "react";
import { storyAsset } from "./storyAssets";
import { COLD_OPT } from "./coldDirection";
import {
  cssSky,
  MoonDefs,
  pine,
  rand,
  SkyGradient as Sky,
  STORY_H as H,
  STORY_W as W,
  StoryMoon,
  stars as starField,
} from "./parts";

/** 物語の一文の数（場面の数）。 */
export const COLD_BEATS = 9;

/**
 * 言葉の合図（11/23 レビュー「跳躍や種は、言葉ごとの間に合わせる」）：動きを合わせる言葉。物語の画面がその言葉の最初の字が
 * 出る拍を計算して、buildColdScene に渡す（cueAt）。
 *   2「ちょん」「ちょん」で跳ねる。3「ひとつぶ」「またひとつぶ」で種が一つずつ消える。4「ひゅう」で枝が揺れる。
 *   5「ふっくら」で羽をふくらませる。7「高く」で月がぐっと昇る。6 1行目「雪の野原」と同時に雪原の月明かり、2行目「おおきな」で月が見えきる。
 *   8「月の光」で光の帯が穴の縁を移る。9「フィーチー」で飛び出す →「朝の森」は止まった絵で →「西の空」の前に西へ向く。
 */
export const COLD_CUES: Record<number, string[]> = {
  1: ["ちょん", "ちょん"],
  2: ["ひとつぶ", "またひとつぶ"],
  3: ["ひゅう"],
  4: ["ふっくら"],
  5: ["雪の野原", "おおきな"],
  6: ["高く"],
  7: ["月の光"],
  8: ["フィーチー", "朝の森", "西の空", "コールドムーン"],
};
/**
 * 行の前の間（秒）：その行を出す前に、絵の動きを見せる。2・3 は鳥が出てから1行目。6 は北東の空が明るみ月の縁が出てから
 * 1行目、月が昇ってから2行目。9 は朝の光 →1行目、飛び出してとまる → 2行目、止まって西へ向く → 3行目、短い余白 → 名前。
 * 間を持つページの文は、前のページから先回りして出さず、コマの頭から（MoonStory の capAt）。
 */
export const COLD_LINE_PAUSE: Record<number, number[]> = {
  1: [0.8],
  2: [0.8],
  5: [2.4, 1.4],
  8: [2.0, 2.0, 3.2, 1.2],
};

/** 渡辺さんの素材（src/design/story/storyAssets.ts の cold）。 */
const A = (name: string) => storyAsset("cold", name);

const SKY = {
  /** 昼の冬の空（1〜3ページ）：低い日の、淡い青と雪の白。 */
  day: ["#7f9fcf", "#a9c1e2", "#d6e1ef", "#efe9e2"],
  /** はやい夕暮れ（4・5ページ）：青いかげ。 */
  dusk: ["#26366e", "#46518e", "#8d78a3", "#d6a497"],
  /** 夜（6〜8ページ）：ビーバームーンの夜と同じ色。 */
  night: ["#060d26", "#0c1a42", "#16295a", "#223a6e"],
  /** 夜明け（9ページ）。 */
  dawn: ["#2f4a86", "#7891c4", "#dcb8b0", "#f2d3b6"],
};
/** 平たい面の色（昼の色。夕方・夜は .cw-shade を重ねて沈める）。 */
const C = {
  ridge: "#8796c4",
  ridgeSnow: "#e4e8f4",
  hill: "#a9b6da",
  pines: "#41527f",
  pineSnow: "#eef1f8",
  birchFar: "#d9dfec",
  birchMark: "#3a3f52",
  snow: ["#f4f6fb", "#dfe6f2", "#c8d3e8"] as const,
  shadow: "#b6c3de",
  bark: "#f3e9e4",
};

// 置く位置（世界の座標 400×860）。主役のシラカバは右寄りに一本。素材の目印は design-src/story/cold/pack/anchors.json。
/** 主役のシラカバ：根元の中心、幅。太い幹は描き込んだ素材（下から c05b → c05d の二股）で、二股の枝は画面の外まで伸ばす。 */
const BIRCH = { x: 215, base: 690, w: 64 };
/** 二股の幹（c05d、1024×1536。下の端の幹は画像の x 457〜697）：下の端を穴のない幹の上に重ねる。 */
const FORK_IMG = (() => {
  const s = BIRCH.w / 240;
  return { s, x: BIRCH.x - 577 * s, y: 430 - 1536 * s, w: 1024 * s, h: 1536 * s };
})();
/** 二股の枝の上の端（絵の上の端）の位置：左の枝は画像の x≈225、右は x≈800。そこから上は平たい面でのばす。 */
const LIMB = {
  y: FORK_IMG.y + 24,
  l: FORK_IMG.x + 225 * FORK_IMG.s,
  r: FORK_IMG.x + 800 * FORK_IMG.s,
};
/** 主役の幹の形（素材の下地の太い幹＋画面の外へ伸びる二本の枝）。夜に沈める色の切り抜きにも使う。 */
const TRUNK_D = [
  `M${BIRCH.x - BIRCH.w / 2} ${BIRCH.base} L${BIRCH.x - 29} 420 L${BIRCH.x + 29} 420 L${BIRCH.x + BIRCH.w / 2} ${BIRCH.base} Z`,
  `M${LIMB.l - 11} ${LIMB.y + 20} L${LIMB.l - 7 - 72} -300 L${LIMB.l + 7 - 72} -300 L${LIMB.l + 11} ${LIMB.y + 20} Z`,
  `M${LIMB.r - 13} ${LIMB.y + 20} L${LIMB.r - 8 + 33} -300 L${LIMB.r + 8 + 33} -300 L${LIMB.r + 13} ${LIMB.y + 20} Z`,
].join(" ");
/** 木の穴（キツツキの古い穴）。描き込んだ幹（c05）の穴の口に合わせる。 */
const HOLE = { x: BIRCH.x + 2, y: 548, rx: 13, ry: 14 };
/** 描き込んだ幹（c05、1024×1536）：穴の口の中心は画像の (510, 671)、幹の幅は画像の約 620。幹の幅を BIRCH.w にそろえる。 */
const TRUNK_IMG = (() => {
  const s = BIRCH.w / 620;
  return { x: HOLE.x - 510 * s, y: HOLE.y - 671 * s, w: 1024 * s, h: 1536 * s };
})();
/** 描き込んだ穴のない幹（c05b、1024×1536。幹は画像の x 347〜678）：根元から、二股の下まで。 */
const PLAIN_IMG = (() => {
  const s = BIRCH.w / 331;
  return { x: BIRCH.x - 512 * s, y: BIRCH.base - 1536 * s, w: 1024 * s, h: 1536 * s };
})();
/** 夜明けの光を受けた穴のない幹（c05c、1024×1536。幹は画像の x 500〜830）：穴のない幹と同じ所に重ねる。 */
const DAWN_IMG = (() => {
  const s = BIRCH.w / 330;
  return { x: BIRCH.x - 667 * s, y: BIRCH.base - 1536 * s, w: 1024 * s, h: 1536 * s };
})();
/** 左上の雪の枝（c09、1774×887。左の端が幹）。ビーバームーンの紅葉の枝と同じ、1・2ページの額縁。 */
const BRANCH = { x: -46, y: 92, w: 310, h: (310 * 887) / 1774 };
/** いちばん手前の雪と枯れ草（c08-near、2172×724。上の縁は画像の y≈260〜570）。 */
const NEAR = { x: -110, y: 700, w: 620, h: (620 * 724) / 2172 };
/** 雪の枝（c09c、1536×1024。右の端 x≈1500 が幹に付く切り口、切り口の木の真ん中は画像の y≈640）：幹の左の縁から左へ。
 * 切り口は幹の絵の後ろに隠す。 */
const BOUGH = (() => {
  const s = 118 / 1457;
  return { x: BIRCH.x - BIRCH.w / 2 + 8 - 1500 * s, y: 600 - 640 * s, w: 1536 * s, h: 1024 * s };
})();
/** 枝のコガラ（c01、1536×1024。足が枝に触れる点は画像の (965, 975)）。足は雪の枝の上の雪（画像の x≈900、上の縁 y≈545）。 */
const PERCH = { w: 76, foot: [965, 975] as const, at: [BOUGH.x + 900 * (BOUGH.w / 1536), BOUGH.y + 547 * (BOUGH.w / 1536)] as const };
/** 幹にしがみついて種をくわえるコガラ（c03c、1024×1536、幹なし）：つめ（画像の x≈940）を幹の左の縁に、下の足（y≈1000）を枝の下に。 */
const CLING = (() => {
  const s = 0.07;
  return { x: BIRCH.x - BIRCH.w / 2 + 2 - 940 * s, y: 650 - 1000 * s, w: 1024 * s, h: 1536 * s };
})();
/** 隠す種（c04、1536×1024。種の真ん中は画像の (787, 517)、長さは約 1075）：くちばしの種（c03c の (900, 355)）の所から、幹のすきまへ。 */
const SEED = (() => {
  const s = 11 / 1075;
  const at = [CLING.x + 900 * 0.07, CLING.y + 355 * 0.07] as const;
  return { x: at[0] - 787 * s, y: at[1] - 517 * s, w: 1536 * s, h: 1024 * s, at };
})();
/** 穴から飛び出すコガラ（c11、1536×1024。鳥の真ん中は画像の (885, 577)）：穴の口から、さえずる枝へ。 */
const FLY = (() => {
  const s = 64 / 1536;
  return { x: HOLE.x - 885 * s, y: HOLE.y - 577 * s, w: 64, h: 1024 * s };
})();
/** 穴の中のふくらんだコガラ（c06、1536×1024。鳥の幅は画像の約 6 割）。 */
const FLUFF = { w: 46, h: (46 * 1024) / 1536 };
/** 夜明けの枝でさえずるコガラ（c07、1536×1024、枝つき）。 */
const SONG = { w: 92, h: (92 * 1024) / 1536, x: 140 - (292 - BIRCH.x), y: 546 };

/** 場面の最初の空（本のページの窓から場面へつなぐ色。CSS の背景）。 */
export const COLD_SKY = cssSky(SKY.day);

/**
 * カメラ（.cw-camera、拡大の中心は世界の (200, 430) ＝画面の真ん中。svgOrigin で決める）：世界の点 (px, py) を画面の真ん中に、倍率 s で。
 */
const cam = (px: number, py: number, s: number) => ({ scale: s, x: -s * (px - 200), y: -s * (py - 430) });

/** 雪をかぶった針葉樹（平たい面。白い帽子を重ねる）。 */
function snowPine(x: number, y: number, h: number, key: string): ReactElement {
  const w = h * 0.42;
  return (
    <g key={key}>
      {pine(x, y, h, C.pines, `${key}p`)}
      <path d={`M${x} ${y - h} L${x + w * 0.42} ${y - h + h * 0.24} L${x - w * 0.42} ${y - h + h * 0.24} Z`} fill={C.pineSnow} />
      <path d={`M${x - w * 0.62} ${y - h * 0.38} q ${w * 0.62} -${h * 0.08} ${w * 1.24} 0`} stroke={C.pineSnow} strokeWidth={2} fill="none" />
    </g>
  );
}

/** 遠くのシラカバ（細い白い幹と黒い節、平たい面）。 */
function farBirch(x: number, y: number, h: number, key: string, r: () => number): ReactElement {
  const w = 3 + h * 0.03;
  return (
    <g key={key}>
      <rect x={x - w / 2} y={y - h} width={w} height={h} fill={C.birchFar} />
      {Array.from({ length: 4 }, (_, i) => (
        <rect key={i} x={x - w / 2} y={y - h + (i + 0.5) * (h / 4.5) + r() * 6} width={w * (0.5 + r() * 0.5)} height={1.4} fill={C.birchMark} opacity={0.7} />
      ))}
      <path d={`M${x} ${y - h * 0.75} l -${h * 0.18} -${h * 0.16} M${x} ${y - h * 0.62} l ${h * 0.16} -${h * 0.14}`} stroke={C.birchFar} strokeWidth={1.2} />
    </g>
  );
}

/** 主役のシラカバ：太い幹は描き込んだ素材（c05b、穴のあたりは c05）、上で分かれる細い枝は平たい面。左へ伸びる雪の枝。 */
function MainBirch(): ReactElement {
  return (
    <g>
      {/* 幹の形（素材の下地と、画面の外へ伸びる二本の枝） */}
      <path className="cw-trunk" d={TRUNK_D} fill={C.bark} />
      {/* 二本の枝の黒い節 */}
      {[-260, -150, -40].map((y, i) => {
        const t = (LIMB.y + 20 - y) / (LIMB.y + 320);
        return (
          <g key={i}>
            <rect x={LIMB.l - 72 * t - 6 + (i % 2) * 4} y={y} width={7} height={1.6} fill={C.birchMark} opacity={0.6} />
            <rect x={LIMB.r + 33 * t - 4 - (i % 2) * 3} y={y + 40} width={7} height={1.6} fill={C.birchMark} opacity={0.6} />
          </g>
        );
      })}
      {/* 雪の枝（切り口は幹の絵の後ろ） */}
      <image className="cw-sway" href={A("bough")} x={BOUGH.x} y={BOUGH.y} width={BOUGH.w} height={BOUGH.h} />
      {/* 描き込んだ幹：穴のない幹（夜明けは光を受けた幹に入れ替える）、二股、穴のあたり */}
      <image href={A("trunk-plain")} x={PLAIN_IMG.x} y={PLAIN_IMG.y} width={PLAIN_IMG.w} height={PLAIN_IMG.h} />
      <image className="cw-trunk-dawn" href={A("trunk-dawn")} x={DAWN_IMG.x} y={DAWN_IMG.y} width={DAWN_IMG.w} height={DAWN_IMG.h} opacity={0} />
      <image href={A("trunk-fork")} x={FORK_IMG.x} y={FORK_IMG.y} width={FORK_IMG.w} height={FORK_IMG.h} mask="url(#cw-fork-mask)" />
      {/* 穴のあたりは c05。上下は穴のない幹へぼかしてつなぐ（ビーバームーンの住みかと同じ、主役の場所のアクセント）。 */}
      <image href={A("trunk-hole")} x={TRUNK_IMG.x} y={TRUNK_IMG.y} width={TRUNK_IMG.w} height={TRUNK_IMG.h} mask="url(#cw-trunk-mask)" />
    </g>
  );
}

/** 雪原と手前の雪の盛り上がり、枯れ草（平たい面）。 */
function SnowField({ front }: { front?: boolean }): ReactElement {
  if (front)
    return (
      <g>
        <path d="M-300 760 C -120 730 40 752 150 742 C 250 732 330 752 700 738 L 700 1300 L -300 1300 Z" fill={C.snow[1]} />
        <path d="M-300 800 C -80 784 80 798 200 790 C 320 782 460 796 700 786 L 700 1300 L -300 1300 Z" fill={C.snow[0]} />
        {/* いちばん手前の雪と枯れ草（描き込んだ素材。ビーバームーンの手前の草と同じ置き方） */}
        <image href={A("near")} x={NEAR.x} y={NEAR.y} width={NEAR.w} height={NEAR.h} />
      </g>
    );
  return (
    <g>
      <path d="M-300 640 C -100 628 60 642 200 636 C 340 630 480 640 700 632 L 700 1300 L -300 1300 Z" fill={C.snow[2]} />
      <path d="M-300 662 C -80 652 90 668 220 660 C 360 652 500 664 700 656 L 700 1300 L -300 1300 Z" fill={C.snow[1]} />
      <path d="M-300 700 C -60 688 120 708 260 698 C 400 690 520 702 700 694 L 700 1300 L -300 1300 Z" fill={C.snow[0]} />
      {/* 雪原の淡い影（低い日の長い影） */}
      <path d="M150 700 C 210 704 250 708 330 716" stroke={C.shadow} strokeWidth={6} strokeLinecap="round" opacity={0.6} fill="none" />
    </g>
  );
}

/** 遠い山と林（平たい面）。 */
function Distance(): ReactElement {
  const r = rand(29);
  const farPines = Array.from({ length: 26 }, (_, i) => snowPine(-40 + i * 19 + r() * 8, 642 + r() * 6, 26 + r() * 16, `fp${i}`));
  const birches = Array.from({ length: 9 }, (_, i) => farBirch(-20 + i * 52 + r() * 18, 646, 70 + r() * 40, `fb${i}`, r));
  return (
    <g>
      <path d="M-300 560 L -200 500 L -120 540 L -20 470 L 60 520 L 130 462 L 210 516 L 290 474 L 370 522 L 450 482 L 540 530 L 700 500 L 700 660 L -300 660 Z" fill={C.ridge} />
      {/* 尾根の雪 */}
      <path d="M-20 470 L 10 492 L -8 490 L -30 478 Z M130 462 L 162 486 L 140 484 L 118 472 Z M290 474 L 318 496 L 298 494 L 278 484 Z" fill={C.ridgeSnow} />
      <path d="M-300 600 C -120 572 40 590 200 578 C 360 566 480 584 700 574 L 700 660 L -300 660 Z" fill={C.hill} />
      <g>{farPines}</g>
      <g>{birches}</g>
    </g>
  );
}

/** 表紙の真ん中の絵：大きな満月、雪の丘とシラカバの林、雪の枝にとまるコガラ。文字は表紙の側（HTML）で重ねる。 */
export function ColdCoverArt(): ReactElement {
  const r = rand(19);
  return (
    <svg className="bca" viewBox="0 0 300 260" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <MoonDefs p="cca" />
        <radialGradient id="cca-fade" cx="0.5" cy="0.5" r="0.62">
          <stop offset="0.72" stopColor="#ffffff" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <mask id="cca-mask">
          <rect width={300} height={260} fill="url(#cca-fade)" />
        </mask>
      </defs>
      <g mask="url(#cca-mask)">
        <circle cx={150} cy={96} r={150} fill="url(#cca-moon-glow)" />
        <image href={A("moon")} x={92} y={38} width={116} height={116} />
        <path d="M-10 172 L 30 140 L 64 160 L 108 128 L 150 158 L 196 130 L 240 158 L 274 136 L 310 160 L 310 200 L -10 200 Z" fill="#2a3a6e" />
        <path d="M-10 182 C 50 166 110 178 160 170 C 210 162 260 174 310 168 L 310 210 L -10 210 Z" fill="#22305e" />
        {Array.from({ length: 20 }, (_, i) => pine(i * 16 + r() * 6 - 8, 192 + r() * 4, 16 + r() * 14, "#16224a", `cp${i}`))}
        <path d="M-10 196 C 60 190 130 200 200 194 C 250 190 280 196 310 194 L 310 270 L -10 270 Z" fill="#8f9fc8" />
        <path d="M-10 214 C 70 208 150 218 230 212 C 270 208 290 212 310 210 L 310 270 L -10 270 Z" fill="#b4c1e0" />
        {/* 雪の枝と、とまるコガラ（表紙の主役） */}
        <path d="M310 196 C 270 190 230 192 176 200" stroke="#6b5240" strokeWidth={3.4} strokeLinecap="round" fill="none" />
        <path d="M310 192 C 270 186 230 188 180 196 L 182 192 C 230 184 270 182 310 188 Z" fill="#eef1f8" stroke="#eef1f8" strokeWidth={2} strokeLinejoin="round" />
        <image href={A("perch")} x={170} y={128} width={110} height={73} />
      </g>
    </svg>
  );
}

/** 紙のページの下の淡い絵（セピアの一色の濃淡）：名前の由来は雪の丘と林、自然との関係は木の穴で眠るコガラ。 */
export function ColdPaperArt({ kind }: { kind: "origin" | "nature" }): ReactElement {
  const r = rand(kind === "nature" ? 37 : 23);
  const ink = "#6b4a2a";
  const pines = Array.from({ length: 16 }, (_, i) => pine(i * 26 + r() * 8, 108 + r() * 3, 14 + r() * 12, ink, `pp${i}`));
  return (
    <svg className="bpa" viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="cpa-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" />
          <stop offset="0.4" stopColor="#ffffff" />
        </linearGradient>
        <mask id="cpa-mask">
          <rect width={400} height={160} fill="url(#cpa-fade)" />
        </mask>
      </defs>
      <g mask="url(#cpa-mask)">
        <path d="M0 100 L 60 76 L 110 92 L 170 66 L 230 94 L 300 72 L 400 98 L 400 112 L 0 112 Z" fill={ink} opacity={0.14} />
        <g opacity={0.24}>{pines}</g>
        <path d="M0 114 C 120 108 260 118 400 110" stroke={ink} strokeWidth={0.8} opacity={0.3} fill="none" />
        {kind === "nature" ? (
          <>
            <rect x={252} y={20} width={22} height={124} fill={ink} opacity={0.16} />
            <ellipse cx={263} cy={82} rx={8} ry={9} fill={ink} opacity={0.4} />
            <image className="bpa-ink" href={A("fluff-closed")} x={249} y={72} width={30} height={20} opacity={0.6} />
          </>
        ) : (
          <image className="bpa-ink" href={A("perch")} x={150} y={76} width={70} height={47} opacity={0.6} />
        )}
      </g>
    </svg>
  );
}

/** 本のページの窓の絵（場面の最初のコマの小さな絵：冬の昼の空、雪の丘、針葉樹、雪原）。 */
export function ColdWindow(): ReactElement {
  const r = rand(7);
  return (
    <svg className="bk-window-art" viewBox="0 0 200 240" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <Sky id="ckw-sky" c={SKY.day} />
      </defs>
      <rect width={200} height={240} fill="url(#ckw-sky)" />
      <path d="M-10 168 L 30 132 L 60 150 L 100 114 L 140 146 L 175 122 L 210 150 L 210 200 L -10 200 Z" fill={C.ridge} />
      {Array.from({ length: 14 }, (_, i) => snowPine(i * 15 + r() * 6 - 4, 194 + r() * 4, 22 + r() * 14, `w${i}`))}
      <rect x={-10} y={194} width={220} height={50} fill={C.snow[1]} />
      <path d="M-10 214 C 60 208 140 218 210 212 L 210 250 L -10 250 Z" fill={C.snow[0]} />
    </svg>
  );
}

/** 絵本の世界の SVG（スクロールの場面は buildColdScene が動かす）。 */
export function ColdWorld(): ReactElement {
  const r = rand(53);
  const stars = starField("cw", 90, 53, 440);
  const flakes = Array.from({ length: 60 }, (_, i) => (
    <circle key={i} className="cw-flake" r={1 + r() * 1.8} cx={(r() * W).toFixed(0)} cy={-10} fill="#ffffff" opacity={0.85} />
  ));
  const sky = (k: keyof typeof SKY, first = false) => (
    <rect className={`cw-sky-${k}`} x={-700} y={-400} width={W + 1100} height={H + 860} fill={`url(#cw-sky-${k})`} opacity={first ? 1 : 0} />
  );
  /** 地上の形（山の稜線から下）：夕方・夜に地上だけを沈める色の重ね（.cw-shade）の切り抜き。 */
  const land =
    "M-700 560 L -200 500 L -120 540 L -20 470 L 60 520 L 130 462 L 210 516 L 290 474 L 370 522 L 450 482 L 540 530 L 1100 500 L 1100 1400 L -700 1400 Z";
  return (
    <svg className="cw" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <Sky id="cw-sky-day" c={SKY.day} />
        <Sky id="cw-sky-dusk" c={SKY.dusk} />
        <Sky id="cw-sky-night" c={SKY.night} />
        <Sky id="cw-sky-dawn" c={SKY.dawn} />
        <MoonDefs p="cw" />
        {/* 夕方・夜に沈める所：地上（山の稜線から下）と、山より上に出る主役の幹（描き込んだ幹の皮のめくれも含む）。 */}
        <filter id="cw-white" x="0" y="0" width="1" height="1">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
        </filter>
        <mask id="cw-land" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <path d={land} fill="#ffffff" />
          <path d={TRUNK_D} fill="#ffffff" />
          <image href={A("trunk-plain")} x={PLAIN_IMG.x} y={PLAIN_IMG.y} width={PLAIN_IMG.w} height={PLAIN_IMG.h} filter="url(#cw-white)" />
          <image href={A("trunk-hole")} x={TRUNK_IMG.x} y={TRUNK_IMG.y} width={TRUNK_IMG.w} height={TRUNK_IMG.h} filter="url(#cw-white)" />
          <image href={A("trunk-fork")} x={FORK_IMG.x} y={FORK_IMG.y} width={FORK_IMG.w} height={FORK_IMG.h} filter="url(#cw-white)" />
        </mask>
        {/* 穴の口（穴の中のコガラは口の形に切る）。 */}
        {/* 試作（?coldSleep=1）：月の光が届いた眠るコガラ（顔の所が明るく、外へやわらかく消える。青白い月の色）。 */}
        <radialGradient id="cw-birdlight-g" cx="0.5" cy="0.45" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity={0.75} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <mask id="cw-birdlight-mask" maskUnits="userSpaceOnUse" x={HOLE.x - 40} y={HOLE.y - 40} width={80} height={80}>
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx * 1.05} ry={HOLE.ry * 1.05} fill="url(#cw-birdlight-g)" />
        </mask>
        <filter id="cw-moonbird" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.70 0 0 0 0.02  0 0.76 0 0 0.04  0 0 0.92 0 0.10  0 0 0 1 0" />
        </filter>
        <clipPath id="cw-hole">
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx} ry={HOLE.ry} />
        </clipPath>
        {/* 描き込んだ幹の上下を平たい幹へぼかす。 */}
        <linearGradient id="cw-trunk-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" />
          <stop offset="0.2" stopColor="#ffffff" />
          <stop offset="0.84" stopColor="#ffffff" />
          <stop offset="1" stopColor="#000000" />
        </linearGradient>
        <mask id="cw-trunk-mask" maskContentUnits="objectBoundingBox">
          <rect width={1} height={1} fill="url(#cw-trunk-fade)" />
        </mask>
        {/* 二股の幹の上の端（平たい枝へ）と下の端（穴のない幹へ）をぼかしてつなぐ。 */}
        <linearGradient id="cw-fork-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.01" stopColor="#000000" />
          <stop offset="0.05" stopColor="#ffffff" />
          <stop offset="0.93" stopColor="#ffffff" />
          <stop offset="1" stopColor="#000000" />
        </linearGradient>
        <mask id="cw-fork-mask" maskContentUnits="objectBoundingBox">
          <rect width={1} height={1} fill="url(#cw-fork-fade)" />
        </mask>
        {/* 雪の上の月明かり（ビーバームーンの水面の月の道にあたる）。 */}
        <radialGradient id="cw-moonlit-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff1c4" stopOpacity={0.9} />
          <stop offset="0.55" stopColor="#f6dc9a" stopOpacity={0.35} />
          <stop offset="1" stopColor="#f6dc9a" stopOpacity={0} />
        </radialGradient>
        {/* 8ページの月の光の帯（縦の細い光）と、照らす所（穴のまわりの幹。穴の口は抜く）。 */}
        <linearGradient id="cw-band-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#dfe8ff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#dfe8ff" stopOpacity={0.9} />
          <stop offset="1" stopColor="#dfe8ff" stopOpacity={0} />
        </linearGradient>
        <mask id="cw-band-area" maskUnits="userSpaceOnUse" x={HOLE.x - 80} y={HOLE.y - 80} width={160} height={160}>
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx + 14} ry={HOLE.ry + 16} fill="#ffffff" />
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx - 1} ry={HOLE.ry - 1} fill="#000000" />
        </mask>
        <radialGradient id="cw-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000000" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.45} />
        </radialGradient>
      </defs>
      <g className="cw-camera">
        {sky("day", true)}
        {sky("dusk")}
        {sky("night")}
        {sky("dawn")}
        <g className="cw-stars" opacity={0}>
          {stars}
        </g>
        {/* 満月（6ページで北東の地平線＝山の向こうから昇る。昇る前は見せない）。 */}
        <ellipse className="cw-moonrise" cx={110} cy={520} rx={170} ry={90} fill="url(#cw-moon-glow)" opacity={0} />
        <g className="cw-moon-show" opacity={0}>
          <StoryMoon p="cw" at="translate(110 600)" img={storyAsset("cold", "moon")} tint="#eef2fb" />
        </g>
        <Distance />
        <SnowField />
        {/* 見本（CM-R02、マージしない）：1ページの「木のかげが、ながく のびます。」のための、幹の長い影（低い日）。 */}
        <defs>
          <linearGradient id="cw-longshadow-g" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6e80b0" stopOpacity={0.95} />
            <stop offset="0.6" stopColor="#7889b6" stopOpacity={0.55} />
            <stop offset="1" stopColor="#8293bf" stopOpacity={0} />
          </linearGradient>
        </defs>
        <filter id="cw-longshadow-soft" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <path className="cw-longshadow" d={`M${BIRCH.x - 24} ${BIRCH.base} L${BIRCH.x + 24} ${BIRCH.base} L640 ${BIRCH.base + 46} L600 ${BIRCH.base + 92} Z`} fill="url(#cw-longshadow-g)" filter="url(#cw-longshadow-soft)" opacity={0} />
        <MainBirch />
        {/* 穴の中で丸くなるコガラ（5・8ページは目を閉じ、6ページは開く）。穴の口の形に切る。 */}
        <g clipPath="url(#cw-hole)">
          <g className="cw-fluff-closed cw-breath" opacity={0}>
            <image className="cw-puff" href={A("fluff-closed")} x={HOLE.x - FLUFF.w / 2} y={HOLE.y - FLUFF.h * 0.36} width={FLUFF.w} height={FLUFF.h} />
          </g>
          <g className="cw-fluff-open cw-breath" opacity={0}>
            <image href={A("fluff-open")} x={HOLE.x - FLUFF.w / 2} y={HOLE.y - FLUFF.h * 0.36} width={FLUFF.w} height={FLUFF.h} />
          </g>
        </g>
        {/* 試作（?coldSleep=1）：8P の寄りで、穴の口と中で眠るコガラの絵（A-11、11/26 届いた）に溶けるように入れ替える。
            A-11 の穴の口（画素で中心 675,616、横の半径 203。2枚目の案、11/26 採用）を、幹の穴（HOLE）に合わせて置く。 */}
        {COLD_OPT.sleep && (
          <image
            className="cw-hole-sleep"
            href={A("hole-sleep")}
            x={HOLE.x - 675 * (HOLE.rx / 203)}
            y={HOLE.y - 616 * (HOLE.rx / 203)}
            width={1254 * (HOLE.rx / 203)}
            height={1254 * (HOLE.rx / 203)}
            opacity={0}
          />
        )}
        {/* 枝にとまるコガラ（2ページ） */}
        <g className="cw-perch cw-breath" opacity={0}>
          <image
            className="cw-hop"
            href={A("perch")}
            x={PERCH.at[0] - (PERCH.w * PERCH.foot[0]) / 1536}
            y={PERCH.at[1] - ((PERCH.w * 1024) / 1536) * (PERCH.foot[1] / 1024)}
            width={PERCH.w}
            height={(PERCH.w * 1024) / 1536}
          />
        </g>
        {/* 幹のすきまに種をかくすコガラ（3ページ、c03c）：幹の左の縁につかまる。 */}
        <g className="cw-seed cw-breath" opacity={0}>
          <image href={A("cling")} x={CLING.x} y={CLING.y} width={CLING.w} height={CLING.h} />
        </g>
        {/* 「ひとつぶ、またひとつぶ。」：くちばしの所から、種が一つずつ幹のすきまへ消える（2粒だけ）。 */}
        {[1, 2].map((k) => (
          <image key={k} className={`cw-seed${k}`} href={A("seed")} x={SEED.x} y={SEED.y} width={SEED.w} height={SEED.h} opacity={0} />
        ))}
        {/* 夜明けの枝でさえずるコガラ（9ページ、c07）。 */}
        <g className="cw-song cw-breath" opacity={0}>
          <image href={A("song")} x={SONG.x} y={SONG.y} width={SONG.w} height={SONG.h} />
        </g>
        {/* 「フィーチー、フィーチー。」で穴から飛び出し、枝へ（9ページ、c11）。 */}
        <image className="cw-fly" href={A("fly")} x={FLY.x} y={FLY.y} width={FLY.w} height={FLY.h} opacity={0} />
        {/* 地面をはう朝もや（c12c、かけ算）：9ページの雪原の表面を低く流れる薄い層。コガラの足元・樹皮・月にはかけない（11/23 レビュー）。 */}
        <image className="cw-mist" href={A("mist")} x={-160} y={650} width={720} height={200} preserveAspectRatio="none" opacity={0} style={{ visibility: "hidden", mixBlendMode: "multiply" }} />
        <SnowField front />
        {/* 地上を沈める色（夕方は青いかげ、夜は紺）。地上の形で切り、空と月にはかからない。 */}
        <g mask="url(#cw-land)">
          <rect className="cw-shade-dusk" x={-700} y={-400} width={1800} height={2000} fill="#2a3876" opacity={0} />
          <rect className="cw-shade-night" x={-700} y={-400} width={1800} height={2000} fill="#071131" opacity={0} />
        </g>
        {/* 雪の上の月明かり（6〜8ページ。夜明けで消える）。紺に沈めた地上の上に重ねる。 */}
        <g className="cw-moonlit" opacity={0}>
          <ellipse cx={130} cy={716} rx={300} ry={44} fill="url(#cw-moonlit-g)" opacity={0.5} />
          <ellipse cx={HOLE.x - 10} cy={HOLE.y + 10} rx={40} ry={70} fill="url(#cw-moonlit-g)" opacity={0.35} />
        </g>
        {/* 8ページ：月の光の帯が穴の縁と木の内側を、ゆっくり移る（鳥の顔＝穴の口は照らさない）。霜が付く。 */}
        <g mask="url(#cw-band-area)">
          <rect className="cw-band" x={HOLE.x - 60} y={HOLE.y - 50} width={22} height={100} fill="url(#cw-band-g)" opacity={0} style={{ visibility: "hidden", mixBlendMode: "screen" }} />
        </g>
        <g className="cw-frost" opacity={0}>
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            return <circle key={i} cx={HOLE.x + Math.cos(a) * (HOLE.rx + 4)} cy={HOLE.y + Math.sin(a) * (HOLE.ry + 4)} r={0.5 + (i % 3) * 0.3} fill="#eef4ff" />;
          })}
        </g>
        {/* 試作（?coldSleep=1、11/26 渡辺さん「光のマスク」）：光のマスクの2つ目。「月の光が、ゆっくり移っていきます。」の
            終わりに向けて、月の光が穴の中まで届き、眠るコガラの顔と胸をやわらかく照らす。夜の暗さの上に、暗くしていない
            A-11 を、青白い月の色にして、顔の所だけ（やわらかい楕円のマスク、穴の口で切る）重ねる。縁は1つ目（光の帯）が照らす。 */}
        {COLD_OPT.sleep && (
          <g clipPath="url(#cw-hole)">
            <g className="cw-birdlight" mask="url(#cw-birdlight-mask)" opacity={0}>
              <image
                href={A("hole-sleep")}
                x={HOLE.x - 675 * (HOLE.rx / 203)}
                y={HOLE.y - 616 * (HOLE.rx / 203)}
                width={1254 * (HOLE.rx / 203)}
                height={1254 * (HOLE.rx / 203)}
                filter="url(#cw-moonbird)"
              />
            </g>
          </g>
        )}
        {/* 上の雪の枝（1・2ページの前景）。後半のページには残さない。 */}
        <g className="cw-bough">
          <image href={A("branch")} x={BRANCH.x} y={BRANCH.y} width={BRANCH.w} height={BRANCH.h} />
        </g>
      </g>
      {/* 空気感の光（c12。黒い背景のまま足し算で重ねる）：はやい夕暮れと夜明けに、斜めにさす薄い光。 */}
      <image className="cw-air" href={A("air")} x={-110} y={-30} width={620} height={930} preserveAspectRatio="none" opacity={0} style={{ visibility: "hidden", mixBlendMode: "screen" }} />
      {/* 月明かりのもや（c12b、足し算）：6〜8ページ。月のある左上から穴の方へ下りる向きに、左右を反転して置く。 */}
      <image className="cw-moon-air" href={A("moon-air")} x={-110} y={-30} width={620} height={930} preserveAspectRatio="none" transform="matrix(-1 0 0 1 400 0)" opacity={0} style={{ visibility: "hidden", mixBlendMode: "screen" }} />
      <g className="cw-snow">{flakes}</g>
      <rect width={W} height={H} fill="url(#cw-vignette)" pointerEvents="none" />
    </svg>
  );
}

// ---- 動き（GSAP、型は最小限。BeaverWorld.tsx と同じ形） ---------------------------------------------

type Tween = {
  to: (...a: unknown[]) => Tween;
  fromTo: (...a: unknown[]) => Tween;
  set: (...a: unknown[]) => Tween;
};
type Loop = Tween & {
  play: () => unknown;
  pause: () => unknown;
  time: (t: number) => unknown;
};
type Gsap = {
  timeline: (o?: unknown) => Tween;
  utils: { toArray: <T>(s: string, el: Element) => T[] };
};

/** 場面の動き（tl は COLD_BEATS 拍、スクロールに合わせる）と、くり返す動き（雪・呼吸・月の光）。 */
export function buildColdScene(gsap: Gsap, root: Element, tl: Tween, loops = true, cueAt: Record<number, number[]> = {}): Loop | null {
  buildBeats(tl, cueAt);
  return loops ? startLoops(gsap, root) : null;
}

function startLoops(gsap: Gsap, root: Element): Loop {
  const loop = gsap.timeline({ paused: true }) as Loop;
  const flakes = gsap.utils.toArray<Element>(".cw-flake", root);
  // 雪：まっすぐ静かに。
  loop.to(
    flakes,
    {
      y: 900,
      x: (i: number) => `+=${((i % 3) - 1) * 8}`,
      duration: (i: number) => 11 + (i % 7),
      ease: "none",
      stagger: { each: 0.5, repeat: -1 },
    },
    0,
  );
  // 呼吸（docs/moon-story.md「動き」）：止まっている姿は、数秒に一度、ごくわずかにふくらんで戻る。
  loop.to(
    ".cw-breath",
    { scaleY: 1.015, scaleX: 1.005, transformOrigin: "50% 100%", duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: -1, repeatDelay: 1.8 },
    0,
  );
  loop.to(".cw-moon-glow", { opacity: 0.75, duration: 2.6, yoyo: true, repeat: -1, ease: "sine.inOut" }, 0);
  loop.time(40);
  return loop;
}

/** 各コマの動きは、そのコマの頭から 0.75 までに終える（docs/moon-story.md「動きの決まり」）。 */
function buildBeats(tl: Tween, cueAt: Record<number, number[]>) {
  const move = (at: number, c: ReturnType<typeof cam>, duration = 0.75) => tl.to(".cw-camera", { ...c, duration, ease: "power2.inOut" }, at);
  /** 言葉の合図の拍（無いとき＝動きを減らす設定などは、決めた拍）。動きはそのコマの中（頭から 0.75 まで）に収める。 */
  const cue = (page: number, k: number, fallback: number) => {
    const v = cueAt[page]?.[k];
    return Math.min(page + 0.74, Math.max(page, v != null && Number.isFinite(v) ? v : fallback));
  };
  // 1 雪の森：少し寄った所から、森全体へ。
  tl.fromTo(".cw-camera", { ...cam(200, 520, 1.3), svgOrigin: "200 430" }, { ...cam(200, 480, 1.1), duration: 0.75, ease: "power2.inOut" }, 0);
  // 見本（CM-R02、11/26 レビュー「低い冬の日による自然な影、淡い青灰色、柔らかく、原則静止、絵を先に」）：「ながく」の合図が
  // ある本文のときだけ、文より先に、幹の長い影が雪の上に静かに現れる（伸ばさない）。夕暮れで消える。
  const longAt = cueAt[0]?.[0];
  if (longAt != null && Number.isFinite(longAt))
    tl.fromTo(".cw-longshadow", { opacity: 0 }, { opacity: 0.9, duration: 0.15, ease: "sine.inOut" }, 0.02).to(".cw-longshadow", { opacity: 0, duration: 0.3 }, 3.05);
  // 2 「ちょん、」「ちょん。」：雪の枝に寄り、コガラが出て、言葉の字が出るのに合わせて二回跳ねて枝の上へ。
  const hop = [cue(1, 0, 1.08), cue(1, 1, 1.2)];
  move(1, cam(225, 545, 1.6))
    .set(".cw-hop", { x: -18, y: 0 }, 1)
    .to(".cw-perch", { opacity: 1, duration: 0.03 }, Math.max(1.01, hop[0] - 0.05));
  hop.forEach((t, k) =>
    tl
      .to(".cw-hop", { x: k === 0 ? -9 : 0, duration: 0.06, ease: "none" }, t)
      .to(".cw-hop", { keyframes: { y: [0, -7, 0] }, duration: 0.06, ease: "none" }, t),
  );
  // 3 「ひとつぶ、」「またひとつぶ。」：幹につかまるコガラ。言葉に合わせて、種が一つずつ幹のすきまへ消える。
  const seeds = [cue(2, 0, 2.14), cue(2, 1, 2.3)];
  move(2, COLD_OPT.view ? cam(BIRCH.x + 5, 610, 1.6) : cam(BIRCH.x + 5, 600, 1.4))
    .to(".cw-perch", { opacity: 0, duration: 0.04 }, 2.01)
    .to(".cw-seed", { opacity: 1, duration: 0.06 }, Math.max(2.02, seeds[0] - 0.08));
  seeds.forEach((t, k) =>
    tl
      .fromTo(`.cw-seed${k + 1}`, { opacity: 0, x: 0, scale: 1 }, { opacity: 1, duration: 0.02 }, t)
      .to(`.cw-seed${k + 1}`, { x: 5, scale: 0.55, svgOrigin: `${SEED.at[0]} ${SEED.at[1]}`, duration: 0.07, ease: "power1.in" }, t + 0.02)
      .to(`.cw-seed${k + 1}`, { opacity: 0, duration: 0.03 }, t + 0.07),
  );
  // 4 はやい夕暮れ：引いて空を広く。空と雪が青いかげへ。「ひゅう、」で枝が揺れ、雪が流れる。
  const gust = cue(3, 0, 3.46);
  move(3, cam(200, 470, 1.0))
    .to(".cw-seed", { opacity: 0, duration: 0.05 }, 3.0)
    .to(".cw-sky-dusk", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 3.05)
    .to(".cw-shade-dusk", { opacity: 0.5, duration: 0.6, ease: "sine.inOut" }, 3.05)
    .to(".cw-bough", { opacity: 0, duration: 0.4 }, 3.1)
    .to(".cw-air", { autoAlpha: 0.3, duration: 0.6, ease: "sine.inOut" }, 3.1)
    .to(".cw-sway", { keyframes: { rotate: [0, -3, 1.5, -0.8, 0] }, svgOrigin: `${BIRCH.x - BIRCH.w / 2 + 8} 600`, duration: 0.26, ease: "sine.inOut" }, gust)
    .to(".cw-snow", { keyframes: { x: [0, -26, 0] }, duration: 0.26, ease: "sine.inOut" }, gust);
  // 5 木の穴へ：穴に寄る。穴の中で丸くなり、「ふっくら」で羽をふくらませる。
  move(4, cam(HOLE.x + 10, HOLE.y + 30, 2.1))
    .to(".cw-fluff-closed", { opacity: 1, duration: 0.08 }, 4.05)
    .to(".cw-puff", { keyframes: { scale: [0.9, 1.06, 1] }, svgOrigin: `${HOLE.x} ${HOLE.y + 10}`, duration: 0.22, ease: "sine.out" }, cue(4, 0, 4.36));
  // 6 月が昇る：引いて、北東の地平線（山の向こう）の空だけがわずかに明るむ → 月の縁（1行目の前の間）→ 1行目「雪の野原」と
  // 同時に雪原の月明かりが手前へ広がる → 月が昇り、2行目「おおきな」で見えきる。月が出る前に雪原を照らさない。
  const lit = cue(5, 0, 5.26);
  const full = Math.max(lit + 0.1, cue(5, 1, 5.5));
  move(5, cam(200, 480, 1.0))
    .to(".cw-sky-night", { opacity: 1, duration: 0.4, ease: "sine.inOut" }, 5)
    .to(".cw-shade-night", { opacity: 0.8, duration: 0.4, ease: "sine.inOut" }, 5)
    .to(".cw-shade-dusk", { opacity: 0, duration: 0.4 }, 5.05)
    .to(".cw-air", { autoAlpha: 0, duration: 0.3 }, 5)
    .to(".cw-stars", { opacity: 1, duration: 0.4 }, 5.1)
    .to(".cw-moonrise", { opacity: 1, duration: 0.14, ease: "sine.in" }, 5.02)
    .to(".cw-moon-show", { opacity: 1, duration: 0.03 }, lit - 0.09)
    .to(".cw-moon", { attr: { transform: "translate(110 420)" }, duration: full - (lit - 0.08), ease: "power1.out" }, lit - 0.08)
    .fromTo(".cw-moonlit", { opacity: 0, scaleY: 0.3, svgOrigin: "130 690" }, { opacity: 0.8, scaleY: 1, duration: 0.3, ease: "sine.out" }, lit)
    .to(".cw-moon-air", { autoAlpha: 0.45, duration: 0.3, ease: "sine.in" }, lit + 0.12)
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.05 }, lit - 0.08)
    .to(".cw-fluff-open", { opacity: 1, duration: 0.05 }, lit - 0.06);
  // 7 「高く、もっと高く。」：見上げる（世界が下へ流れ、月は東から南の高い所へ。真上にはしない）。月は「高く」の字に合わせて
  // ぐっと昇る（6ページでも昇るので、7ページは「高く、もっと高く」に動きを集める）。
  const high = Math.min(6.5, Math.max(6.12, cue(6, 0, 6.3)));
  move(6, cam(200, 400, 1.0))
    .to(".cw-moonrise", { opacity: 0, duration: 0.3 }, 6.02)
    .to(".cw-moon", { attr: { transform: "translate(95 290)" }, duration: high - 6.02, ease: "sine.inOut" }, 6.02)
    .to(".cw-moon", { attr: { transform: "translate(78 150)" }, duration: 6.74 - high, ease: "power2.out" }, high)
    .to(".cw-fluff-open", { opacity: 0, duration: 0.05 }, 6.1)
    .to(".cw-fluff-closed", { opacity: 1, duration: 0.05 }, 6.12);
  // 8 ながい夜：穴の口に寄る。月は西南西へ（円盤は画面の外、光だけ）。「月の光」で光の帯が穴の縁を東から西へ移る（鳥の顔は
  // 照らさない）。穴の縁に霜が付く。
  const band = cue(7, 0, 7.42);
  // 見本（11/26 レビュー「8P は遠景から近景へ。急なズームを避ける」）：雪の森を遠くに見たまま「ながい、ながい夜。」を読み、
  // ゆっくり（区間の半分ほどかけて）木の穴の眠るコガラへ寄る。
  if (COLD_OPT.sleep) tl.to(".cw-hole-sleep", { opacity: 1, duration: 0.3, ease: "sine.inOut" }, 7.4).to(".cw-hole-sleep", { opacity: 0, duration: 0.05 }, 7.97);
  // 光のマスクの2つ目：光の帯が縁を移りはじめてから、ページの終わりに向けて穴の中のコガラへ届く。9P の前に消す。
  if (COLD_OPT.sleep) {
    const lit = cue(7, 0, 7.42) + 0.08;
    tl.fromTo(".cw-birdlight", { opacity: 0 }, { opacity: 0.85, duration: Math.max(0.1, 7.9 - lit), ease: "sine.inOut" }, lit).to(".cw-birdlight", { opacity: 0, duration: 0.05 }, 7.97);
  }
  (COLD_OPT.view ? move(7, cam(200, 440, 1.0), 0.2).to(".cw-camera", { ...cam(HOLE.x + (COLD_OPT.cu?.[0] ?? 12), HOLE.y + 30, COLD_OPT.cu?.[1] ?? 2.3), duration: 0.5, ease: "sine.inOut" }, 7.22) : move(7, cam(HOLE.x + 12, HOLE.y + 30, 2.3)))
    .to(".cw-moon", { attr: { transform: "translate(-120 300)" }, duration: 0.6 }, 7.05)
    .fromTo(".cw-band", { x: 100, autoAlpha: 0 }, { x: 0, autoAlpha: 0.55, duration: Math.min(0.3, 7.75 - band), ease: "sine.inOut" }, band)
    .to(".cw-frost", { opacity: 0.9, duration: Math.min(0.3, 7.75 - band) }, band);
  // 9 コールドムーン：朝の光（木が桃色に照らされる）→「フィーチー」でコガラが穴から出て枝へ →「朝の森」は止まった絵で →
  // 西へ向く（カメラが左へ。月が動いたのでなく見る向きが変わった）→ 白い月 →「西の空」→ 余白 → 名前。月は最後まで消さない。
  const fly = cue(8, 0, 8.14);
  const west = cue(8, 2, 8.74);
  const turn = Math.max(fly + 0.17, west - 0.11);
  move(8, cam(270, 540, 1.3), 0.1)
    .set(".cw-moon", { attr: { transform: "translate(64 400) scale(0.5)" } }, 8.02)
    .set(".cw-moon-tint", { opacity: 0.62 }, 8.02)
    .to(".cw-sky-dawn", { opacity: 1, duration: 0.25, ease: "sine.inOut" }, 8)
    .to(".cw-sky-night", { opacity: 0, duration: 0.25, ease: "sine.inOut" }, 8.02)
    .to(".cw-stars", { opacity: 0, duration: 0.25 }, 8.02)
    .to(".cw-moonlit", { opacity: 0, duration: 0.25 }, 8.02)
    .to(".cw-band", { autoAlpha: 0, duration: 0.12 }, 8)
    .to(".cw-frost", { opacity: 0.4, duration: 0.25 }, 8.02)
    .to(".cw-moon-air", { autoAlpha: 0, duration: 0.25 }, 8.02)
    .to(".cw-trunk-dawn", { opacity: 1, duration: 0.25, ease: "sine.inOut" }, 8.02)
    .to(".cw-air", { autoAlpha: 0.5, duration: 0.35, ease: "sine.inOut" }, 8.04)
    .to(".cw-mist", { autoAlpha: 0.45, duration: 0.4, ease: "sine.inOut" }, 8.08)
    .to(".cw-shade-night", { opacity: 0.2, duration: 0.3, ease: "sine.inOut" }, 8.02)
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.02 }, fly)
    .to(".cw-fly", { opacity: 1, duration: 0.02 }, fly)
    .to(".cw-fly", { x: -108, duration: 0.12, ease: "sine.inOut" }, fly + 0.01)
    .to(".cw-fly", { keyframes: { y: [0, -22, 30] }, duration: 0.12, ease: "sine.inOut" }, fly + 0.01)
    .to(".cw-song", { opacity: 1, duration: 0.03 }, fly + 0.12)
    .to(".cw-fly", { opacity: 0, duration: 0.03 }, fly + 0.14);
  // 枝にとまったら少し止まり（「朝の森に、コガラの声。」を止まった絵で読む）、「西の空」の前に西へ向く（11/23 レビュー：
  // 一つの続いた動きにせず、短い静止で余韻を作る）。
  move(turn, cam(175, 480, 0.96), Math.min(0.1, 8.75 - turn));
}

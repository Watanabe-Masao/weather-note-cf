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
import { COLD_OPT, SLEEP_TIMES } from "./coldDirection";
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
  /** 第3次（?cold3=1）の夕方：4P はまだ夕方（上は青紫でも少し明るく、下は残照）。5P は夜の色を重ねて深い藍へ。 */
  dusk3: ["#34467e", "#56609c", "#9b86ad", "#e2ae96"],
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
  /** 第3次 C2：稜線の内側の縁を寄せる色（空と山の間）。 */
  ridgeSoft: "#b3bfdf",
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
/** 第3次 段階2 仕上げ（11/26 22:36「枝の先へわずかに細く、輪郭の小さな不規則性、接続部の太さの変化」）：上へのびる枝の形。
 * 根元は二股の絵の太さ、先へ細く（約 4 割）、外へわずかに反り、輪郭に小さなゆらぎ。 */
function limbShape(b: readonly [number, number], t: readonly [number, number], wb: number, wt: number, bend: number, seed: number): string {
  const r = rand(seed);
  const dx = t[0] - b[0], dy = t[1] - b[1], len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len; // 枝に直角
  const L: string[] = [], R: string[] = [];
  const N = 14;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const c = [b[0] + dx * u + nx * bend * Math.sin(Math.PI * u), b[1] + dy * u + ny * bend * Math.sin(Math.PI * u)];
    const w = (wb * (1 - u) ** 1.3 + wt * (1 - (1 - u) ** 1.3)) / 2;
    const jl = k === 0 ? 0 : (r() - 0.5) * 1.4, jr = k === 0 ? 0 : (r() - 0.5) * 1.4;
    L.push(`${(c[0] - nx * (w + jl)).toFixed(2)} ${(c[1] - ny * (w + jl)).toFixed(2)}`);
    R.push(`${(c[0] + nx * (w + jr)).toFixed(2)} ${(c[1] + ny * (w + jr)).toFixed(2)}`);
  }
  return `M${L.join(" L")} L${R.reverse().join(" L")} Z`;
}
const LIMB3 = [
  limbShape([LIMB.l, LIMB.y + 20], [LIMB.l - 72, -300], 24, 9, -3, 61),
  limbShape([LIMB.r, LIMB.y + 20], [LIMB.r + 33, -300], 28, 10, 3, 67),
];
/** 第3次の幹の形（上へのびる枝を LIMB3 に）。 */
const TRUNK3_D = [TRUNK_D.split(" M")[0], ...LIMB3].join(" ");
const trunkD = () => (COLD_OPT.art3 ? TRUNK3_D : TRUNK_D);
/** 第3次 段階2：上へのびる二本の枝（TRUNK_D の2本目・3本目）に貼る樹皮の絵の置き方（根元の中心・傾き・幅・長さ）と切り抜き。 */
const LIMBS = [
  { b: [LIMB.l, LIMB.y + 40], t: [LIMB.l - 72, -300], clip: `M${LIMB.l - 11} ${LIMB.y + 20} L${LIMB.l - 7 - 72} -300 L${LIMB.l + 7 - 72} -300 L${LIMB.l + 11} ${LIMB.y + 20} Z` },
  { b: [LIMB.r, LIMB.y + 40], t: [LIMB.r + 33, -300], clip: `M${LIMB.r - 13} ${LIMB.y + 20} L${LIMB.r - 8 + 33} -300 L${LIMB.r + 8 + 33} -300 L${LIMB.r + 13} ${LIMB.y + 20} Z` },
].map(({ b, t }, i) => {
  const clip = LIMB3[i];
  const dx = t[0] - b[0], dy = t[1] - b[1];
  const len = Math.hypot(dx, dy);
  const w = 34;
  return { bx: b[0], by: b[1], deg: (Math.atan2(dx, -dy) * 180) / Math.PI, w, h: Math.max(len + 30, (w * 4088) / 346), clip };
});
/** 第3次 段階2：控えめな星（明るい星 b は少し）。月の通り道（6P の昇る所・7P の高い所）のまわりは空ける。 */
const STARS3 = (() => {
  const r = rand(313);
  const away = (x: number, y: number) =>
    Math.hypot(x - 110, y - 420) > 150 && Math.hypot(x - 128, y - 230) > 130 && Math.hypot(x - 194, y + 26) > 130;
  const out: { x: number; y: number; r: number; o: number; b: boolean }[] = [];
  while (out.length < 34) {
    const x = -360 + r() * 1120, y = -440 + r() * 900;
    if (!away(x, y)) continue;
    const b = out.length < 7;
    out.push({ x: Math.round(x), y: Math.round(y), r: b ? 1.1 + r() * 0.5 : 0.45 + r() * 0.5, o: b ? 0.9 : 0.45 + r() * 0.35, b });
  }
  return out;
})();
/** 木の穴（キツツキの古い穴）。描き込んだ幹（c05）の穴の口に合わせる。 */
const HOLE = { x: BIRCH.x + 2, y: 548, rx: 13, ry: 14 };
/** 第3次：穴の縁の霜（角度・縁からの距離・半径・月の側か）。上の縁に寄せ、間隔も大きさもそろえない。 */
const FROST3: [number, number, number, boolean][] = (() => {
  const r = rand(71);
  return Array.from({ length: 11 }, (_, i) => {
    const a = Math.PI * (1.05 + r() * 0.95); // 左（π）から上（1.5π）を通って右上（2π）まで
    const lit = a < Math.PI * 1.55 || r() < 0.25;
    return [a, 1.5 + r() * 3.2, 0.25 + r() * (i % 4 === 0 ? 0.6 : 0.3), lit] as [number, number, number, boolean];
  });
})();
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
/** 枝のコガラの絵の置き場所（世界の座標）。 */
const PERCH_IMG = {
  x: PERCH.at[0] - (PERCH.w * PERCH.foot[0]) / 1536,
  y: PERCH.at[1] - ((PERCH.w * 1024) / 1536) * (PERCH.foot[1] / 1024),
  w: PERCH.w,
  h: (PERCH.w * 1024) / 1536,
};
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
      <path className="cw-trunk" d={trunkD()} fill={C.bark} />
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
      {/* 第3次 段階2（11/26 21:41「枝の上部が直線的で、樹皮の質感が突然なくなる」）：上へのびる二本の枝にも描き込んだ樹皮を
          （c05b の幹を縦につないだ絵を、枝の向きに傾けて、枝の形で切る）。二股の絵の上の端は、この樹皮へぼけてつながる。 */}
      {COLD_OPT.art3 &&
        LIMBS.map((l, i) => (
          <g key={i} clipPath={`url(#cw-limb-clip${i})`}>
            <image href={A("limb")} x={-l.w / 2} y={-l.h} width={l.w} height={l.h} transform={`translate(${l.bx.toFixed(2)} ${l.by.toFixed(2)}) rotate(${l.deg.toFixed(2)})`} preserveAspectRatio="none" />
          </g>
        ))}
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

/** 2回目（11/26 22:36「規則性を少し崩す、稜の明暗に強弱、わずかに斜め、遠景は明暗差を抑える、夜は描かない所を残す」）：
 * 起伏ごとの強さ（面・稜の月明かり）。 */
const DRIFT_FILL_O = [0.45, 0.9, 0.7, 1, 0.65];
const DRIFT_CREST_O = [0.2, 0.85, 0.3, 0.55, 0.12];
/** 第3次 段階2（11/26 21:41「雪原の水平な色の帯を、緩やかな起伏と連続した陰影へ」）：雪原の起伏の稜（上の縁）。
 * 帯を全幅の水平線にしない（高さと長さを変え、端は下がって地面に溶ける）。面は上が明るく、下へ透けて下地の連続した陰影へ。 */
const DRIFTS_BACK = [
  "M-300 676 C -220 668 -150 666 -70 672 C 0 677 50 669 120 666 C 180 663 230 670 270 676 C 330 684 380 674 450 670 C 540 665 620 672 700 668",
  "M-300 716 C -230 706 -170 700 -110 705 C -50 710 -10 718 40 716 C 90 714 120 705 160 708",
  "M250 738 C 300 724 350 717 410 719 C 480 722 520 729 580 725 C 630 721 670 713 700 707",
];
const DRIFTS_FRONT = [
  "M-300 788 C -220 772 -140 763 -60 767 C 0 770 60 778 130 773 C 200 768 250 756 330 757 C 420 759 520 762 700 744",
  "M-300 852 C -200 846 -100 836 0 838 C 100 840 180 834 260 825 C 360 814 480 812 700 798",
];
const driftFill = (d: string, depth: number) => `${d} L 700 ${depth} L -300 ${depth} Z`;

function SnowField3({ front }: { front?: boolean }): ReactElement {
  if (front)
    return (
      <g>
        {DRIFTS_FRONT.map((d, i) => (
          <path key={i} d={driftFill(d, 1300)} fill="url(#cw-drift-g)" opacity={DRIFT_FILL_O[3 + i]} />
        ))}
        {/* いちばん手前の雪と枯れ草（下の端と左右の端を雪へぼかした版。引いた構図でも切り口を見せない）。倒木の下に薄い接触影。 */}
        <ellipse cx={NEAR.x + NEAR.w * 0.72} cy={NEAR.y + NEAR.h * 0.86} rx={NEAR.w * 0.2} ry={7} fill="url(#cw-contact-g)" opacity={0.6} />
        <image href={A("near-c3")} x={NEAR.x} y={NEAR.y} width={NEAR.w} height={NEAR.h} />
      </g>
    );
  return (
    <g>
      <path d="M-300 640 C -100 628 60 642 200 636 C 340 630 480 640 700 632 L 700 1300 L -300 1300 Z" fill="url(#cw-snowbase-g)" />
      {DRIFTS_BACK.map((d, i) => (
        <path key={i} d={driftFill(d, i === 0 ? 760 : 800)} fill="url(#cw-drift-g)" opacity={DRIFT_FILL_O[i]} />
      ))}
    </g>
  );
}

/** 雪原と手前の雪の盛り上がり、枯れ草（平たい面）。 */
function SnowField({ front }: { front?: boolean }): ReactElement {
  if (COLD_OPT.art3) return <SnowField3 front={front} />;
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
/** 第3次の背景3案（?coldBg）：描き込んだ遠景（c08-far）・中景（c08-middle）の置き場所（世界の座標）。 */
const BG_FAR = { x: -110, y: 452, w: 620, h: (620 * 724) / 2172 };
const BG_MID = { x: -110, y: 496, w: 620, h: (620 * 724) / 2172 };
const RIDGE_D = "M-300 560 L -200 500 L -120 540 L -20 470 L 60 520 L 130 462 L 210 516 L 290 474 L 370 522 L 450 482 L 540 530 L 700 500 L 700 660 L -300 660 Z";
const HILL_D = "M-300 600 C -120 572 40 590 200 578 C 360 566 480 584 700 574 L 700 660 L -300 660 Z";

function Distance(): ReactElement {
  // B：描き込んだ遠景と中景（平たい面は使わない）。
  if (COLD_OPT.bg === "B")
    return (
      <g>
        <image href={A("far")} x={BG_FAR.x} y={BG_FAR.y} width={BG_FAR.w} height={BG_FAR.h} />
        <image href={A("middle")} x={BG_MID.x} y={BG_MID.y} width={BG_MID.w} height={BG_MID.h} />
      </g>
    );
  const r = rand(29);
  const farPines = Array.from({ length: 26 }, (_, i) => snowPine(-40 + i * 19 + r() * 8, 642 + r() * 6, 26 + r() * 16, `fp${i}`));
  const birches = Array.from({ length: 9 }, (_, i) => farBirch(-20 + i * 52 + r() * 18, 646, 70 + r() * 40, `fb${i}`, r));
  return (
    <g>
      <path d={RIDGE_D} fill={C.ridge} />
      {/* 尾根の雪 */}
      <path d="M-20 470 L 10 492 L -8 490 L -30 478 Z M130 462 L 162 486 L 140 484 L 118 472 Z M290 474 L 318 496 L 298 494 L 278 484 Z" fill={C.ridgeSnow} />
      <path d={HILL_D} fill={C.hill} />
      {COLD_OPT.bg === "C2" && (
        // C2：遠景は形と色で描く（平たい面のまま）。稜線の内側の縁だけ、空の色へ少し寄せて輪郭と明暗の境界を柔らかく。
        <g clipPath="url(#cw-ridge-clip)" fill="none" stroke={C.ridgeSoft}>
          <path d={RIDGE_D} strokeWidth={9} opacity={0.22} />
          <path d={RIDGE_D} strokeWidth={4} opacity={0.3} />
          <path d={HILL_D} strokeWidth={6} opacity={0.18} />
        </g>
      )}
      {COLD_OPT.bg === "C" || COLD_OPT.bg === "C2" ? (
        // C：遠景（山の稜線・丘）は平たい面のまま、中景の林は描き込んだ絵に。C2 は中景の彩度・明暗差・鮮明さを抑えた版。
        <image href={A(COLD_OPT.bg === "C2" ? "middle-c2" : "middle")} x={BG_MID.x} y={BG_MID.y} width={BG_MID.w} height={BG_MID.h} />
      ) : (
        <>
          <g>{farPines}</g>
          <g>{birches}</g>
        </>
      )}
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
  // 第3次（?cold3=1）：降る雪は奥行きで大きさ・明るさ・速さを変える（遠い粒は小さく暗く遅く、近い粒は大きく明るく速い）。
  const flakes = Array.from({ length: 60 }, (_, i) => {
    const depth = COLD_OPT.art3 ? (i % 5 === 0 ? 2 : i % 2) : -1;
    const rr = r();
    return (
      <circle
        key={i}
        className="cw-flake"
        data-depth={depth}
        r={depth < 0 ? 1 + rr * 1.8 : [0.5 + rr * 0.4, 0.9 + rr * 0.6, 1.8 + rr * 1.0][depth]}
        cx={(r() * W).toFixed(0)}
        cy={-10}
        fill={COLD_OPT.art3 ? "url(#cw-flake-g)" : "#ffffff"}
        opacity={depth < 0 ? 0.85 : [0.45, 0.7, 0.9][depth]}
      />
    );
  });
  const sky = (k: keyof typeof SKY, first = false) => (
    <rect className={`cw-sky-${k}`} x={-700} y={-400} width={W + 1100} height={H + 860} fill={`url(#cw-sky-${k})`} opacity={first ? 1 : 0} />
  );
  /** 地上の形（山の稜線から下）：夕方・夜に地上だけを沈める色の重ね（.cw-shade）の切り抜き。 */
  // 背景 B（描き込んだ遠景・中景）では、山の稜線の形を使わない（地上は雪原から下と、描き込んだ絵の形）。
  const land = COLD_OPT.bg === "B" ? "M-700 650 L 1100 650 L 1100 1400 L -700 1400 Z" :
    "M-700 560 L -200 500 L -120 540 L -20 470 L 60 520 L 130 462 L 210 516 L 290 474 L 370 522 L 450 482 L 540 530 L 1100 500 L 1100 1400 L -700 1400 Z";
  return (
    <svg className="cw" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <Sky id="cw-sky-day" c={SKY.day} />
        <Sky id="cw-sky-dusk" c={COLD_OPT.art3 ? SKY.dusk3 : SKY.dusk} />
        <Sky id="cw-sky-night" c={SKY.night} />
        <Sky id="cw-sky-dawn" c={SKY.dawn} />
        <MoonDefs p="cw" />
        {/* 夕方・夜に沈める所：地上（山の稜線から下）と、山より上に出る主役の幹（描き込んだ幹の皮のめくれも含む）。 */}
        <filter id="cw-white" x="0" y="0" width="1" height="1">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
        </filter>
        <mask id="cw-land" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <path d={land} fill="#ffffff" />
          <path d={trunkD()} fill="#ffffff" />
          {/* 第3次の背景 B・C：描き込んだ林は稜線より上へ伸びるので、その形も地上として沈める。 */}
          {COLD_OPT.bg === "B" && <image href={A("far")} x={BG_FAR.x} y={BG_FAR.y} width={BG_FAR.w} height={BG_FAR.h} filter="url(#cw-white)" />}
          {(COLD_OPT.bg === "B" || COLD_OPT.bg === "C" || COLD_OPT.bg === "C2") && <image href={A(COLD_OPT.bg === "C2" ? "middle-c2" : "middle")} x={BG_MID.x} y={BG_MID.y} width={BG_MID.w} height={BG_MID.h} filter="url(#cw-white)" />}
          <image href={A("trunk-plain")} x={PLAIN_IMG.x} y={PLAIN_IMG.y} width={PLAIN_IMG.w} height={PLAIN_IMG.h} filter="url(#cw-white)" />
          <image href={A("trunk-hole")} x={TRUNK_IMG.x} y={TRUNK_IMG.y} width={TRUNK_IMG.w} height={TRUNK_IMG.h} filter="url(#cw-white)" />
          <image href={A("trunk-fork")} x={FORK_IMG.x} y={FORK_IMG.y} width={FORK_IMG.w} height={FORK_IMG.h} filter="url(#cw-white)" />
        </mask>
        {/* 穴の口（穴の中のコガラは口の形に切る）。 */}
        {/* 試作（?coldSleep=1）：月の光が届いた眠るコガラ（顔の所が明るく、外へやわらかく消える。青白い月の色。明るい所は月のある左上へ少し寄せる＝光の向きと縁の陰影をそろえる）。 */}
        <radialGradient id="cw-birdlight-g" cx="0.42" cy="0.4" r="0.55">
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
        {/* 第3次（?cold3=1）：光を受けた世界。幹の形の切り抜き、月の側（左）が明るい樹皮、日の側の暖色、月明かりの雪面（幹は抜く）。 */}
        {/* 幹の光は、描き込んだ幹（穴なし・穴・二股）の形と、上へのびる枝の形で切る（二股の所で光が途切れないように）。 */}
        <mask id="cw-trunk-light-mask" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <path d={trunkD()} fill="#ffffff" />
          <image href={A("trunk-plain")} x={PLAIN_IMG.x} y={PLAIN_IMG.y} width={PLAIN_IMG.w} height={PLAIN_IMG.h} filter="url(#cw-white)" />
          <image href={A("trunk-hole")} x={TRUNK_IMG.x} y={TRUNK_IMG.y} width={TRUNK_IMG.w} height={TRUNK_IMG.h} filter="url(#cw-white)" />
          <image href={A("trunk-fork")} x={FORK_IMG.x} y={FORK_IMG.y} width={FORK_IMG.w} height={FORK_IMG.h} filter="url(#cw-white)" />
        </mask>
        <linearGradient id="cw-bark-moon-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#dfe8fb" stopOpacity={0.95} />
          <stop offset="0.45" stopColor="#c6d3ef" stopOpacity={0.35} />
          <stop offset="0.75" stopColor="#c6d3ef" stopOpacity={0} />
        </linearGradient>
        {/* 4P の夕方：日の沈む左が明るく、右（字の列の側）の樹皮は青いかげに。 */}
        <linearGradient id="cw-bark-dusk-g" x1="0" y1="0" x2="1" y2="0">
          {/* 円筒の幹：光の面から陰へゆるやかに。右の縁には雪面からの弱い照り返し（陰を少し浅く、青く）。 */}
          <stop offset="0.14" stopColor="#1b2352" stopOpacity={0} />
          <stop offset="0.27" stopColor="#1b2352" stopOpacity={0.3} />
          <stop offset="0.4" stopColor="#1b2352" stopOpacity={0.66} />
          <stop offset="0.5" stopColor="#1b2352" stopOpacity={0.8} />
          <stop offset="0.58" stopColor="#2a3a72" stopOpacity={0.58} />
        </linearGradient>
        <linearGradient id="cw-bark-sun-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f2c79a" stopOpacity={0.9} />
          <stop offset="0.28" stopColor="#f2c79a" stopOpacity={0.25} />
          <stop offset="0.5" stopColor="#f2c79a" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="cw-snowlit-g" x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0" stopColor="#dde7fa" stopOpacity={0.9} />
          <stop offset="0.6" stopColor="#c3d0ec" stopOpacity={0.45} />
          <stop offset="1" stopColor="#c3d0ec" stopOpacity={0.15} />
        </linearGradient>
        <mask id="cw-snowlit-mask" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <path d="M-300 640 C -100 628 60 642 200 636 C 340 630 480 640 700 632 L 700 1300 L -300 1300 Z" fill="#ffffff" />
          <path d={trunkD()} fill="#000000" />
          <image href={A("trunk-plain")} x={PLAIN_IMG.x} y={PLAIN_IMG.y} width={PLAIN_IMG.w} height={PLAIN_IMG.h} filter="url(#cw-black)" />
        </mask>
        <filter id="cw-black" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        {LIMBS.map((l, i) => (
          <clipPath key={i} id={`cw-limb-clip${i}`}>
            <path d={l.clip} />
          </clipPath>
        ))}
        {/* 2回目（11/26 22:36「星は小さく鋭い光、雪は柔らかな白い粒」）：降る雪は縁のやわらかい粒。3P 接写案の穴をやわらげる面。 */}
        <radialGradient id="cw-flake-g">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity={0.85} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="cw-hole-calm-g">
          <stop offset="0" stopColor="#d9c6b2" stopOpacity={0.55} />
          <stop offset="0.55" stopColor="#efe6dc" stopOpacity={0.35} />
          <stop offset="1" stopColor="#efe6dc" stopOpacity={0} />
        </radialGradient>
        {/* 雪原の下地：地平線から手前へ、連続した明るさの変化（色の帯にしない）。起伏の面：上の稜が明るく、下へ透ける。 */}
        <linearGradient id="cw-snowbase-g" gradientUnits="userSpaceOnUse" x1={0} y1={630} x2={0} y2={900}>
          <stop offset="0" stopColor={C.snow[2]} />
          <stop offset="0.2" stopColor="#d8e0ef" />
          <stop offset="0.5" stopColor="#e9eef7" />
          <stop offset="1" stopColor={C.snow[0]} />
        </linearGradient>
        <linearGradient id="cw-drift-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f8fc" stopOpacity={0.95} />
          <stop offset="0.12" stopColor="#eef2f8" stopOpacity={0.75} />
          <stop offset="0.45" stopColor="#e4eaf4" stopOpacity={0.3} />
          <stop offset="1" stopColor="#e4eaf4" stopOpacity={0} />
        </linearGradient>
        {/* 起伏の稜の月明かり：稜のすぐ下がいちばん明るく、面の下へ消える（線にしない）。手前の起伏は面が大きいので早く消す。 */}
        <linearGradient id="cw-crestlit-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e3ebff" stopOpacity={0.65} />
          <stop offset="0.1" stopColor="#d6e1fb" stopOpacity={0.3} />
          <stop offset="0.3" stopColor="#d6e1fb" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="cw-crestlit-g2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e3ebff" stopOpacity={0.6} />
          <stop offset="0.04" stopColor="#d6e1fb" stopOpacity={0.25} />
          <stop offset="0.12" stopColor="#d6e1fb" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="cw-crest-x" gradientUnits="userSpaceOnUse" x1={-200} y1={0} x2={500} y2={0}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#808080" />
          <stop offset="1" stopColor="#1a1a1a" />
        </linearGradient>
        <mask id="cw-crest-mask" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <rect x={-700} y={600} width={1800} height={700} fill="url(#cw-crest-x)" />
        </mask>
        <clipPath id="cw-ridge-clip">
          <path d={RIDGE_D} />
        </clipPath>
        {/* 第3次 2回目（11/26 18:52 レビュー「世界は冷たいが、そこに生きる命は温かい」）：暖色は命と光を受ける所だけ。
            コガラの胸と頬（低い日の側）、種、種をしまう樹皮の一部分。鳥の形で切る。 */}
        <radialGradient id="cw-warm-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f6c28c" stopOpacity={0.9} />
          <stop offset="0.6" stopColor="#f1b47e" stopOpacity={0.35} />
          <stop offset="1" stopColor="#f1b47e" stopOpacity={0} />
        </radialGradient>
        <mask id="cw-perch-shape" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <image href={A("perch")} x={PERCH_IMG.x} y={PERCH_IMG.y} width={PERCH_IMG.w} height={PERCH_IMG.h} filter="url(#cw-white)" />
        </mask>
        <mask id="cw-cling-shape" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <image href={A("cling")} x={CLING.x} y={CLING.y} width={CLING.w} height={CLING.h} filter="url(#cw-white)" />
        </mask>
        {/* 4P の残照（地平線の近くだけ、昼の光の名残）と、9P の夜明けの薄桃（空の下・雪面・幹の光を受ける側）。 */}
        <linearGradient id="cw-afterglow-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0b89a" stopOpacity={0} />
          <stop offset="0.7" stopColor="#f0b89a" stopOpacity={0.55} />
          <stop offset="1" stopColor="#f6cfae" stopOpacity={0.9} />
        </linearGradient>
        {/* 残照は日の沈む南西（左）に強く、字の列のある右では弱く（字の読みやすさ。絵全体は暗くしない）。 */}
        <linearGradient id="cw-afterglow-x" gradientUnits="userSpaceOnUse" x1={40} y1={0} x2={320} y2={0}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#999999" />
          <stop offset="1" stopColor="#2a2a2a" />
        </linearGradient>
        <mask id="cw-afterglow-mask" maskUnits="userSpaceOnUse" x={-700} y={-400} width={1800} height={2000}>
          <rect x={-700} y={300} width={1800} height={400} fill="url(#cw-afterglow-x)" />
        </mask>
        <linearGradient id="cw-dawnglow-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3cfcf" stopOpacity={0} />
          <stop offset="0.65" stopColor="#f3cfcf" stopOpacity={0.45} />
          <stop offset="1" stopColor="#f7dcd2" stopOpacity={0.8} />
        </linearGradient>
        <linearGradient id="cw-snowpink-g" x1="1" y1="0" x2="0" y2="0.3">
          <stop offset="0" stopColor="#f4d2cf" stopOpacity={0.9} />
          <stop offset="0.7" stopColor="#efd4d6" stopOpacity={0.4} />
          <stop offset="1" stopColor="#efd4d6" stopOpacity={0.1} />
        </linearGradient>
        <linearGradient id="cw-bark-dawn-g" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#f5c3bb" stopOpacity={0.9} />
          <stop offset="0.35" stopColor="#f5c3bb" stopOpacity={0.3} />
          <stop offset="0.6" stopColor="#f5c3bb" stopOpacity={0} />
        </linearGradient>
        {/* 根元の接地：幹の根元の薄い接触影（雪のくぼみ）。 */}
        <radialGradient id="cw-contact-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7d8db8" stopOpacity={0.75} />
          <stop offset="0.6" stopColor="#8e9cc4" stopOpacity={0.3} />
          <stop offset="1" stopColor="#8e9cc4" stopOpacity={0} />
        </radialGradient>
        {/* 8P の寝顔（2回目）：月の側（左上）の頬と胸の上に光を集め、右下の羽毛はわずかに陰に。穴の縁の暗さは残す。 */}
        <radialGradient id="cw-birdlight-g3" cx="0.38" cy="0.4" r="0.42">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.6} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <mask id="cw-birdlight-mask3" maskUnits="userSpaceOnUse" x={HOLE.x - 40} y={HOLE.y - 40} width={80} height={80}>
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx * 1.05} ry={HOLE.ry * 1.05} fill="url(#cw-birdlight-g3)" />
        </mask>
        <radialGradient id="cw-birdshade-g" cx="0.72" cy="0.74" r="0.5">
          <stop offset="0" stopColor="#0b1534" stopOpacity={0.32} />
          <stop offset="1" stopColor="#0b1534" stopOpacity={0} />
        </radialGradient>
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
        <radialGradient id="cw-band-soft" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.55" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <mask id="cw-band-area" maskUnits="userSpaceOnUse" x={HOLE.x - 80} y={HOLE.y - 80} width={160} height={160}>
          {/* 外の縁はぼかす（11/26：寄った所で、光の帯が通るときに縁のはっきりした丸い光の板に見えていた）。 */}
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx + 16} ry={HOLE.ry + 18} fill="url(#cw-band-soft)" />
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
        {COLD_OPT.art3 && (
          <>
            <rect className="cw-afterglow" x={-700} y={380} width={1800} height={200} fill="url(#cw-afterglow-g)" mask="url(#cw-afterglow-mask)" opacity={0} />
            <rect className="cw-dawnglow" x={-700} y={360} width={1800} height={220} fill="url(#cw-dawnglow-g)" opacity={0} />
          </>
        )}
        {/* 第3次 段階2（11/26 21:41「星は描く。ただし非常に控えめに」）：満月の夜なので少数だけ。空に固定（降る雪とは別の層、動かない）。
            明るい星（4P の夕暮れから）と、暗い星（5P から）。月の通り道のまわりには置かない。 */}
        {COLD_OPT.art3 && COLD_OPT.stars && (
          <>
            <g className="cw-stars3-b" opacity={0}>
              {STARS3.filter((x) => x.b).map((x, i) => (
                <g key={i} opacity={x.o} fill="#f4f6ff">
                  {/* 明るい星：小さな芯と、細く鋭い十字の光（雪の丸い粒と見分けられるように）。 */}
                  <circle cx={x.x} cy={x.y} r={x.r * 0.55} />
                  <path d={`M${x.x - x.r * 2.4} ${x.y} L${x.x} ${x.y - 0.22} L${x.x + x.r * 2.4} ${x.y} L${x.x} ${x.y + 0.22} Z M${x.x} ${x.y - x.r * 2.4} L${x.x + 0.22} ${x.y} L${x.x} ${x.y + x.r * 2.4} L${x.x - 0.22} ${x.y} Z`} />
                </g>
              ))}
            </g>
            <g className="cw-stars3-d" opacity={0}>
              {STARS3.filter((x) => !x.b).map((x, i) => (
                <circle key={i} cx={x.x} cy={x.y} r={x.r * 0.7} fill="#e8edff" opacity={x.o} />
              ))}
            </g>
          </>
        )}
        <g className="cw-stars" opacity={0}>
          {stars}
        </g>
        {/* 満月（6ページで北東の地平線＝山の向こうから昇る。昇る前は見せない）。 */}
        <ellipse className="cw-moonrise" cx={110} cy={520} rx={170} ry={90} fill="url(#cw-moon-glow)" opacity={0} />
        <g className="cw-moon-show" opacity={0}>
          <StoryMoon p="cw" at="translate(110 600)" img={storyAsset("cold", "moon")} tint="#eef2fb" />
          {/* 第3次 3回目：7P の月の明暗だけを戻す層（灰色の濃淡をかけ算。黄色の彩度は変えない）。同じ .cw-moon として一緒に動く。 */}
          {COLD_OPT.art3 && (
            <g className="cw-moon" transform="translate(110 600)">
              <image className="cw-moon-relief" href={A("moon-relief")} x={-62 * 1.06} y={-62 * 1.06} width={62 * 2.12} height={62 * 2.12} clipPath="url(#cw-moon-clip)" preserveAspectRatio="xMidYMid slice" opacity={0} style={{ mixBlendMode: "multiply" }} />
            </g>
          )}
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
        {/* 第3次 2回目：幹の根元の接触影（雪のくぼみ）。幹の後ろ、雪の上。 */}
        {COLD_OPT.art3 && <ellipse cx={BIRCH.x + 5} cy={BIRCH.base + 1} rx={38} ry={5.5} fill="url(#cw-contact-g)" />}
        <MainBirch />
        {/* 第3次 2回目（11/26 18:52「木が雪の中に立っている感覚」）：根元の手前に雪を少し重ねる（幹の下の切り口を隠す。世界の座標なので、カメラが動いても接地はそのまま）。 */}
        {COLD_OPT.art3 && (
          <g>
            {/* 3回目（11/26 20:19「低く、左右非対称に、周囲の雪原へ溶け込ませる」）：左は短く、右（陰の側）へ長くなだらかに。縁は薄い雪を一枚外に重ねてぼかす。 */}
            <path d={`M${BIRCH.x - 52} 703 C ${BIRCH.x - 40} 700 ${BIRCH.x - 30} 692 ${BIRCH.x - 18} 690 C ${BIRCH.x - 8} 688 ${BIRCH.x + 4} 687 ${BIRCH.x + 14} 689 C ${BIRCH.x + 26} 691 ${BIRCH.x + 34} 695 ${BIRCH.x + 52} 698 C ${BIRCH.x + 72} 701 ${BIRCH.x + 96} 702 ${BIRCH.x + 120} 704 L ${BIRCH.x - 52} 712 Z`} fill="url(#cw-drift-g)" opacity={0.7} transform="translate(0 -1.6)" />
            <path d={`M${BIRCH.x - 44} 704 C ${BIRCH.x - 34} 701 ${BIRCH.x - 27} 694 ${BIRCH.x - 17} 691.5 C ${BIRCH.x - 6} 689 ${BIRCH.x + 3} 688.5 ${BIRCH.x + 13} 690.5 C ${BIRCH.x + 22} 692 ${BIRCH.x + 31} 695.5 ${BIRCH.x + 46} 698.5 C ${BIRCH.x + 66} 701.5 ${BIRCH.x + 88} 702.5 ${BIRCH.x + 112} 705 L ${BIRCH.x - 44} 712 Z`} fill="url(#cw-drift-g)" />
            <path d={`M${BIRCH.x + 16} 691 C ${BIRCH.x + 24} 693 ${BIRCH.x + 30} 695.5 ${BIRCH.x + 38} 697`} stroke={C.shadow} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.4} />
          </g>
        )}
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
          {/* 第3次：低い日の当たる胸と頬に、ほんのり暖色（鳥の形で切る。跳ねる絵と同じ .cw-hop で一緒に動く）。 */}
          {COLD_OPT.art3 && (
            <g className="cw-hop">
              <ellipse cx={PERCH_IMG.x + PERCH_IMG.w * 0.73} cy={PERCH_IMG.y + PERCH_IMG.h * 0.5} rx={PERCH_IMG.w * 0.16} ry={PERCH_IMG.h * 0.3} fill="url(#cw-warm-g)" mask="url(#cw-perch-shape)" opacity={0.5} style={{ mixBlendMode: "soft-light" }} />
              <ellipse cx={PERCH_IMG.x + PERCH_IMG.w * 0.64} cy={PERCH_IMG.y + PERCH_IMG.h * 0.27} rx={PERCH_IMG.w * 0.08} ry={PERCH_IMG.h * 0.1} fill="url(#cw-warm-g)" mask="url(#cw-perch-shape)" opacity={0.4} style={{ mixBlendMode: "soft-light" }} />
            </g>
          )}
        </g>
        {/* 幹のすきまに種をかくすコガラ（3ページ、c03c）：幹の左の縁につかまる。 */}
        <g className="cw-seed cw-breath" opacity={0}>
          <image href={A("cling")} x={CLING.x} y={CLING.y} width={CLING.w} height={CLING.h} />
          {COLD_OPT.art3 && (
            <ellipse cx={CLING.x + CLING.w * 0.62} cy={CLING.y + CLING.h * 0.5} rx={CLING.w * 0.26} ry={CLING.h * 0.16} fill="url(#cw-warm-g)" mask="url(#cw-cling-shape)" opacity={0.5} style={{ mixBlendMode: "soft-light" }} />
          )}
        </g>
        {/* 3P 接写案の仕上げ（11/26 22:36「大きな穴の存在感をわずかに抑える」）：穴の暗さと縁の明暗差だけを、樹皮の色でやわらげる。 */}
        {COLD_OPT.art3 && <ellipse className="cw-hole-calm" cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx * 1.9} ry={HOLE.ry * 1.9} fill="url(#cw-hole-calm-g)" opacity={0} />}
        {/* 第3次 段階2（3P 接写案）：種をしまう樹皮の小さなすきま（大きな木の穴ではないことが絵で分かるように、細い裂け目）。 */}
        {COLD_OPT.art3 && (
          <g className="cw-crack" opacity={0}>
            <path d={`M${SEED.at[0] + 2} ${SEED.at[1] - 2.4} C ${SEED.at[0] + 5} ${SEED.at[1] - 1} ${SEED.at[0] + 7} ${SEED.at[1] + 1.2} ${SEED.at[0] + 9} ${SEED.at[1] + 3}`} stroke="#3a2a1f" strokeWidth={1.1} strokeLinecap="round" fill="none" opacity={0.85} />
            <path d={`M${SEED.at[0] + 2.6} ${SEED.at[1] - 1.6} C ${SEED.at[0] + 5.4} ${SEED.at[1] - 0.2} ${SEED.at[0] + 7.2} ${SEED.at[1] + 1.8} ${SEED.at[0] + 9} ${SEED.at[1] + 3.6}`} stroke="#f6eee4" strokeWidth={0.5} strokeLinecap="round" fill="none" opacity={0.8} />
          </g>
        )}
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
        {/* 第3次 段階2（11/26 21:41「スポットライト状ではなく、雪面の起伏による反射」）：雪の起伏の稜が月の側（左）ほど光る。
            雪面の月明かり（.cw-snowlit）と同じ時に。 */}
        {COLD_OPT.art3 && (
          <g className="cw-snowlit" opacity={0} mask="url(#cw-crest-mask)" style={{ mixBlendMode: "screen" }}>
            {[...DRIFTS_BACK, ...DRIFTS_FRONT].map((d, i) => (
              <path key={i} d={driftFill(d, i < 3 ? (i === 0 ? 760 : 800) : 1300)} fill={i < 3 ? "url(#cw-crestlit-g)" : "url(#cw-crestlit-g2)"} opacity={DRIFT_CREST_O[i]} />
            ))}
          </g>
        )}
        <g className="cw-moonlit" opacity={0} style={COLD_OPT.art3 ? { display: "none" } : undefined}>
          <ellipse cx={130} cy={716} rx={300} ry={44} fill="url(#cw-moonlit-g)" opacity={0.5} />
          <ellipse cx={HOLE.x - 10} cy={HOLE.y + 10} rx={40} ry={70} fill="url(#cw-moonlit-g)" opacity={0.35} />
        </g>
        {/* 8ページ：月の光の帯が穴の縁と木の内側を、ゆっくり移る（鳥の顔＝穴の口は照らさない）。霜が付く。 */}
        <g mask="url(#cw-band-area)">
          <rect className="cw-band" x={HOLE.x - 60} y={HOLE.y - 50} width={22} height={100} fill="url(#cw-band-g)" opacity={0} style={{ visibility: "hidden", mixBlendMode: "screen" }} />
        </g>
        <g className="cw-frost" opacity={0}>
          {COLD_OPT.art3
            ? // 第3次：霜は穴の縁の上側に付いて動かない。3回目（11/26 20:19）：丸い粒を一つずつ置かず、樹皮の凹凸に付いた小さな不規則な集まり
              // （縁に沿って細長い欠片が2〜4個）。月の側（左上）は明るく、かげの側は暗く。穴の内側には置かない。
              FROST3.map(([a, d, rad, lit], i) => {
                const r = rand(200 + i);
                const cx = HOLE.x + Math.cos(a) * (HOLE.rx + d);
                const cy = HOLE.y + Math.sin(a) * (HOLE.ry + d);
                const deg = (a * 180) / Math.PI + 90; // 縁に沿う向き
                return (
                  <g key={i} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${deg.toFixed(1)})`} fill={lit ? "#e8eefb" : "#8f9bb8"} opacity={lit ? 0.8 : 0.5}>
                    {Array.from({ length: 2 + (i % 3) }, (_, k) => (
                      <ellipse key={k} cx={(r() - 0.5) * 2.4} cy={(r() - 0.5) * 0.9} rx={rad * (0.6 + r() * 0.9)} ry={rad * (0.25 + r() * 0.3)} />
                    ))}
                  </g>
                );
              })
            : Array.from({ length: 14 }, (_, i) => {
                const a = (i / 14) * Math.PI * 2;
                return <circle key={i} cx={HOLE.x + Math.cos(a) * (HOLE.rx + 4)} cy={HOLE.y + Math.sin(a) * (HOLE.ry + 4)} r={0.5 + (i % 3) * 0.3} fill="#eef4ff" />;
              })}
        </g>
        {/* 試作（?coldSleep=1、11/26 渡辺さん「光のマスク」）：光のマスクの2つ目。「月の光が、ゆっくり移っていきます。」の
            終わりに向けて、月の光が穴の中まで届き、眠るコガラの顔と胸をやわらかく照らす。夜の暗さの上に、暗くしていない
            A-11 を、青白い月の色にして、顔の所だけ（やわらかい楕円のマスク、穴の口で切る）重ねる。縁は1つ目（光の帯）が照らす。 */}
        {COLD_OPT.sleep && (
          <g clipPath="url(#cw-hole)">
            <g className="cw-birdlight" mask="url(#cw-birdlight-mask)" opacity={0} style={{ visibility: "hidden" }}>
              <image
                href={A("hole-sleep")}
                x={HOLE.x - 675 * (HOLE.rx / 203)}
                y={HOLE.y - 616 * (HOLE.rx / 203)}
                width={1254 * (HOLE.rx / 203)}
                height={1254 * (HOLE.rx / 203)}
                filter="url(#cw-moonbird)"
              />
            </g>
            {/* 第3次 2回目：月の側の頬と胸の上にだけ、光をもう一枚（明暗の差を局所的に）。 */}
            {COLD_OPT.art3 && (
              <g className="cw-birdlight2" mask="url(#cw-birdlight-mask3)" opacity={0} style={{ visibility: "hidden" }}>
                <image
                  href={A("hole-sleep")}
                  x={HOLE.x - 675 * (HOLE.rx / 203)}
                  y={HOLE.y - 616 * (HOLE.rx / 203)}
                  width={1254 * (HOLE.rx / 203)}
                  height={1254 * (HOLE.rx / 203)}
                  filter="url(#cw-moonbird)"
                />
              </g>
            )}
            {COLD_OPT.art3 && <ellipse className="cw-birdshade" cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx} ry={HOLE.ry} fill="url(#cw-birdshade-g)" opacity={0} />}
          </g>
        )}
        {COLD_OPT.art3 && (
          <>
            {/* 第3次：月明かりを受けた雪面（空中の光ではなく、雪が光を映す。月のある左ほど明るい）。 */}
            <rect className="cw-snowlit" x={-300} y={600} width={1000} height={700} fill="url(#cw-snowlit-g)" mask="url(#cw-snowlit-mask)" opacity={0} style={{ mixBlendMode: "screen" }} />
            {/* 第3次：樹皮に当たる光。昼は低い日の暖色、夜は月の側の青白い光（幹の形で切る）。 */}
            <g mask="url(#cw-trunk-light-mask)">
              <rect className="cw-bark-sun" x={BIRCH.x - 40} y={-320} width={120} height={1020} fill="url(#cw-bark-sun-g)" opacity={0} style={{ mixBlendMode: "overlay" }} />
              <rect className="cw-bark-moon" x={BIRCH.x - 40} y={-320} width={120} height={1020} fill="url(#cw-bark-moon-g)" opacity={0} style={{ mixBlendMode: "screen" }} />
              <rect className="cw-bark-dusk" x={BIRCH.x - 40} y={-320} width={120} height={1020} fill="url(#cw-bark-dusk-g)" opacity={0} />
              <rect className="cw-bark-dawn" x={BIRCH.x - 60} y={-320} width={120} height={1020} fill="url(#cw-bark-dawn-g)" opacity={0} style={{ mixBlendMode: "soft-light" }} />
              {/* 3P：種をしまう樹皮のすきまのまわりだけ、ほんのり暖色。 */}
              <ellipse className="cw-bark-seedwarm" cx={SEED.at[0] + 8} cy={SEED.at[1]} rx={16} ry={22} fill="url(#cw-warm-g)" opacity={0} style={{ mixBlendMode: "soft-light" }} />
            </g>
            {/* 9P：雪面に映る朝の薄桃（東＝右ほど）。 */}
            <rect className="cw-snowpink" x={-300} y={600} width={1000} height={700} fill="url(#cw-snowpink-g)" mask="url(#cw-snowlit-mask)" opacity={0} />
          </>
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
      duration: (i: number, el: Element) => {
        const d = Number(el.getAttribute("data-depth"));
        return d < 0 ? 11 + (i % 7) : [20, 13, 8][d] + (i % 5);
      },
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
  // 第3次 段階1（?cold3=1）：光を受けた世界（樹皮・雪面）で光を描き、空中の光の帯ともやを弱める。文・時間・カメラは変えない。
  const A3 = !!COLD_OPT.art3;
  // 2回目（11/26 18:52）：暖色は命と光を受ける所だけ。1P は低い日に面した樹皮、2P はコガラの胸と頬（鳥に付けた暖色）で
  // 樹皮の暖色はほぼ引く、3P は種をしまう樹皮のすきまのまわりだけ。背景は冷たいまま。
  if (A3)
    tl.set(".cw-bark-sun", { opacity: 0.6 }, 0)
      .to(".cw-bark-sun", { opacity: 0.12, duration: 0.3, ease: "sine.inOut" }, 1.0)
      .to(".cw-bark-sun", { opacity: 0, duration: 0.3, ease: "sine.inOut" }, 2.0)
      .to(".cw-bark-seedwarm", { opacity: 0.7, duration: 0.3, ease: "sine.inOut" }, 2.02)
      .to(".cw-bark-seedwarm", { opacity: 0, duration: 0.3, ease: "sine.inOut" }, 3.0)
      // 4P はまだ夕方：地平線の近くに昼の光の名残（残照）。5P で消えて、深い藍へ（夜への入口）。
      .to(".cw-afterglow", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 3.05)
      .to(".cw-bark-dusk", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 3.05)
      .to(".cw-bark-dusk", { opacity: 0, duration: 0.5, ease: "sine.inOut" }, 4.02)
      .to(".cw-afterglow", { opacity: 0, duration: 0.5, ease: "sine.inOut" }, 4.02)
      .to(".cw-sky-night", { opacity: 0.5, duration: 0.5, ease: "sine.inOut" }, 4.02)
      .to(".cw-shade-dusk", { opacity: 0.68, duration: 0.5, ease: "sine.inOut" }, 4.02);
  const move = (at: number, c: ReturnType<typeof cam>, duration = 0.75) => tl.to(".cw-camera", { ...c, duration, ease: "power2.inOut" }, at);
  /** 言葉の合図の拍（無いとき＝動きを減らす設定などは、決めた拍）。動きはそのコマの中（頭から 0.75 まで）に収める。 */
  const cue = (page: number, k: number, fallback: number) => {
    const v = cueAt[page]?.[k];
    return Math.min(page + 0.74, Math.max(page, v != null && Number.isFinite(v) ? v : fallback));
  };
  // 第3次 段階2（?coldComp=1、11/26 20:19「同じ場所を描きながら、異なるものを見せる」）：視点の距離のリズム
  // 1 遠 → 2 中 → 3 近 → 4 遠 → 5 近 → 6 いちばん遠い → 7 見上げる → 8 いちばん近い → 9 遠（世界へ戻る）。
  const CP = !!COLD_OPT.comp;
  // 1 雪の森：少し寄った所から、森全体へ。段階2：世界との出会い。広く引き、シラカバは左の三分の一、地平線は低め、右は空と雪原の余白（字の場所）。
  tl.fromTo(".cw-camera", { ...cam(200, 520, 1.3), svgOrigin: "200 430" }, { ...(CP ? cam(292, 474, 0.8) : cam(200, 480, 1.1)), duration: 0.75, ease: "power2.inOut" }, 0);
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
  // 段階2：営みの細部。種をしまう幹のすきまとコガラのくちばしに寄る（コガラと幹を左の三分の二に、右は字の余白）。
  // 段階2 追加：3P の接写案（?coldP3=B）。くちばし・種・樹皮のすきまを中心に（字は左上）。すきまの細い裂け目を見せ、
  // 2つ目の種は先が少し見えたまま、すきまに残す（しまったことが絵で分かる）。
  const P3B = CP && COLD_OPT.p3 === "B";
  if (A3) tl.to(".cw-crack", { opacity: 1, duration: 0.1 }, 2.02).to(".cw-crack", { opacity: 0, duration: 0.1 }, 3.0);
  move(2, P3B ? cam(176, 590, 4.0) : CP ? cam(206, 608, 2.1) : COLD_OPT.view ? cam(BIRCH.x + 5, 610, 1.6) : cam(BIRCH.x + 5, 600, 1.4))
    .to(".cw-perch", { opacity: 0, duration: 0.04 }, 2.01)
    .to(".cw-seed", { opacity: 1, duration: 0.06 }, Math.max(2.02, seeds[0] - 0.08));
  seeds.forEach((t, k) =>
    tl
      .fromTo(`.cw-seed${k + 1}`, { opacity: 0, x: 0, scale: 1 }, { opacity: 1, duration: 0.02 }, t)
      .to(`.cw-seed${k + 1}`, { x: 5, scale: 0.55, svgOrigin: `${SEED.at[0]} ${SEED.at[1]}`, duration: 0.07, ease: "power1.in" }, t + 0.02)
      .to(`.cw-seed${k + 1}`, { opacity: P3B && k === 1 ? 1 : 0, duration: 0.03 }, t + 0.07),
  );
  if (P3B)
    tl.to(".cw-seed2", { opacity: 0, duration: 0.05 }, 3.0)
      .to(".cw-hole-calm", { opacity: 1, duration: 0.2 }, 2.0)
      .to(".cw-hole-calm", { opacity: 0, duration: 0.2 }, 3.0);
  // 星（第3次 段階2）：4P 夕暮れに明るい星がわずか → 5P 少し増える → 6P 月から離れた空に控えめに → 7P 少なく → 8P ほとんど無し → 9P 朝に溶ける。
  if (A3 && COLD_OPT.stars)
    tl.to(".cw-stars3-b", { opacity: 0.55, duration: 0.5 }, 3.2)
      .to(".cw-stars3-b", { opacity: 0.85, duration: 0.4 }, 4.05)
      .to(".cw-stars3-d", { opacity: 0.4, duration: 0.4 }, 4.05)
      .to(".cw-stars3-d", { opacity: 0.8, duration: 0.4 }, 5.05)
      .to([".cw-stars3-b", ".cw-stars3-d"], { opacity: 0.45, duration: 0.4 }, 6.05)
      .to([".cw-stars3-b", ".cw-stars3-d"], { opacity: 0.08, duration: 0.4 }, 7.05);
  // 4 はやい夕暮れ：引いて空を広く。空と雪が青いかげへ。「ひゅう、」で枝が揺れ、雪が流れる。
  const gust = cue(3, 0, 3.46);
  move(3, cam(200, 470, 1.0))
    .to(".cw-seed", { opacity: 0, duration: 0.05 }, 3.0)
    .to(".cw-sky-dusk", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 3.05)
    .to(".cw-shade-dusk", { opacity: A3 ? 0.36 : 0.5, duration: 0.6, ease: "sine.inOut" }, 3.05)
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
  // 見本（?cold67=1、11/26 15:31 レビュー「6P 広がり：地平線を低く、広い雪原と空。月が昇る前に雪原がほのかに明るむ。
  // 出現そのものより光の変化」）：少し引いて（0.84 倍）、地平線を画面の下の 4 分の 1 ほどへ。「雪の野原」で雪原がほのかに
  // 明るみ、月は「まあるい」で山の向こうから昇る。
  const P67 = !!COLD_OPT.p67;
  // 段階2：広い世界と月。いちばん遠くまで引き、地平線を画面の下の三分の一より下に。シラカバは右へ寄せ、月の昇る北東の空を広く。
  if (P67) tl.to(".cw-camera", { ...(CP ? cam(118, 372, 0.7) : cam(188, 362, 0.84)), duration: 0.7, ease: "sine.inOut" }, 5);
  (P67 ? tl : move(5, cam(200, 480, 1.0)))
    .to(".cw-sky-night", { opacity: 1, duration: 0.4, ease: "sine.inOut" }, 5)
    .to(".cw-shade-night", { opacity: 0.8, duration: 0.4, ease: "sine.inOut" }, 5)
    .to(".cw-shade-dusk", { opacity: 0, duration: 0.4 }, 5.05)
    .to(".cw-air", { autoAlpha: 0, duration: 0.3 }, 5)
    .to(".cw-stars", { opacity: 1, duration: 0.4 }, 5.1)
    .to(".cw-moonrise", { opacity: 1, duration: 0.14, ease: "sine.in" }, 5.02)
    .to(".cw-moon-show", { opacity: 1, duration: 0.03 }, P67 ? full - 0.1 : lit - 0.09)
    .to(".cw-moon", { attr: { transform: "translate(110 420)" }, duration: P67 ? 0.24 : full - (lit - 0.08), ease: P67 ? "sine.out" : "power1.out" }, P67 ? full - 0.09 : lit - 0.08)
    .fromTo(".cw-moonlit", { opacity: 0, scaleY: 0.3, svgOrigin: "130 690" }, { opacity: P67 ? 0.45 : 0.8, scaleY: 1, duration: 0.3, ease: "sine.out" }, lit)
    .to(".cw-moonlit", { opacity: 0.8, duration: P67 ? 0.2 : 0.002 }, P67 ? full : lit + 0.3)
    .to(".cw-moon-air", { autoAlpha: A3 ? 0.16 : 0.45, duration: 0.3, ease: "sine.in" }, P67 ? full : lit + 0.12)
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.05 }, lit - 0.08)
    .to(".cw-fluff-open", { opacity: 1, duration: 0.05 }, lit - 0.06);
  // 第3次：6P は月が昇るにつれて雪面が明るむ（ほのか → 月が出てから）。樹皮の月の側に光。
  // 2回目：月の色は高さで変える。6P は昇る月＝淡い金（彩度を少し落とす）、7P は高い冬の満月＝象牙に近い淡い金、9P は白。
  if (A3)
    tl.set(".cw-moon-tint", { attr: { fill: "#f4eddc" }, opacity: 0.3 }, 5)
      .to(".cw-moon-tint", { opacity: 0.45, duration: 0.6, ease: "sine.inOut" }, 6.05)
      .to(".cw-moon-relief", { opacity: COLD_OPT.moon7 ?? 0.4, duration: 0.6, ease: "sine.inOut" }, 6.05)
      .to(".cw-moon-relief", { opacity: 0, duration: 0.3 }, 7.4)
      .set(".cw-moon-tint", { attr: { fill: "#eef2fb" } }, 7.7);
  if (A3)
    tl.to(".cw-snowlit", { opacity: 0.22, duration: 0.25, ease: "sine.inOut" }, lit)
      .to(".cw-snowlit", { opacity: 0.5, duration: 0.3, ease: "sine.inOut" }, full)
      .to(".cw-bark-moon", { opacity: 0.3, duration: 0.3, ease: "sine.inOut" }, full);
  // 7 「高く、もっと高く。」：見上げる（世界が下へ流れ、月は東から南の高い所へ。真上にはしない）。月は「高く」の字に合わせて
  // ぐっと昇る（6ページでも昇るので、7ページは「高く、もっと高く」に動きを集める）。
  const high = Math.min(6.5, Math.max(6.12, cue(6, 0, 6.3)));
  // 見本（?cold67=1、「7P 高さ：視線を上へ。シラカバの枝を手がかりに、月の高さを。月は拡大しない。常に動かし続けない」）：
  // 区間の前半でゆっくり見上げ（地平線は画面の下の端へ、二股の枝が上へ伸びる）、あとは止まる。月は東から南へ、二股の枝の間（V の中）の高い所へ。文の列が右にあるので、二股（V）を画面の左寄りに置く。
  // 背の低い画面（高さ 640px 未満、320×568 など）では、昇りきった月が上の操作ボタン（物語をとばす）に少しかかっていた
  // （11/26 確認：月の上の端 33px、ボタンの下の端 40px）。もう少し見上げて、月を下げる。
  const short67 = typeof window !== "undefined" && window.innerHeight < 640;
  if (P67) tl.to(".cw-camera", { ...cam(252, short67 ? 190 : 222, 0.9), duration: 0.5, ease: "sine.inOut" }, 6.02);
  (P67 ? tl : move(6, cam(200, 400, 1.0)))
    .to(".cw-moonrise", { opacity: 0, duration: 0.3 }, 6.02)
    .to(".cw-moon", { attr: { transform: P67 ? "translate(128 230)" : "translate(95 290)" }, duration: high - 6.02, ease: "sine.inOut" }, 6.02)
    .to(".cw-moon", { attr: { transform: P67 ? "translate(194 -26)" : "translate(78 150)" }, duration: 6.74 - high, ease: "power2.out" }, high)
    .to(".cw-fluff-open", { opacity: 0, duration: 0.05 }, 6.1)
    .to(".cw-fluff-closed", { opacity: 1, duration: 0.05 }, 6.12);
  // 第3次：7P は月が高い。月に面した枝と樹皮の明暗をはっきり、雪面も明るく。
  if (A3) tl.to(".cw-bark-moon", { opacity: 0.5, duration: 0.4, ease: "sine.inOut" }, 6.15).to(".cw-snowlit", { opacity: 0.55, duration: 0.4 }, 6.15);
  // 8 ながい夜：穴の口に寄る。月は西南西へ（円盤は画面の外、光だけ）。「月の光」で光の帯が穴の縁を東から西へ移る（鳥の顔は
  // 照らさない）。穴の縁に霜が付く。
  const band = cue(7, 0, 7.42);
  // 見本（11/26 レビュー「8P は遠景から近景へ。急なズームを避ける」）：雪の森を遠くに見たまま「ながい、ながい夜。」を読み、
  // ゆっくり（区間の半分ほどかけて）木の穴の眠るコガラへ寄る。
  // 光のマスクの2つ目（11/26 レビュー「光が届く → コガラに気づく → 文章を読み終える → 絵だけを眺める」）：「月の光が、」の節が
  // 出はじめてから光が穴の中へ届きはじめ、文が消えはじめる（区間の終わり）より約 1 秒前（読み終える頃）に、いちばん明るく（0.85）なる。
  // 節の頭から文が消えはじめるまで約 4.9 秒（浮かぶ 0.9 ＋読む時間 4.0）なので、その 4.0/4.9 の所。そのあと夜明けまで、その明るさのまま。
  if (COLD_OPT.sleep) {
    // 8P の区間は拍 6.78〜7.78（MoonStory の segBeat、BEAT_REST 0.78）。区間の終わり 7.78 で文が消えはじめる。
    const end8 = 7.78;
    const s3 = Math.min(end8 - 0.05, cueAt[7]?.[0] ?? 7.5);
    const peak = s3 + (end8 - s3) * (4.0 / 4.9);
    const lit = s3 + (end8 - s3) * (0.3 / 4.9);
    tl.to(".cw-hole-sleep", { opacity: 1, duration: 0.3, ease: "sine.inOut" }, 7.4)
      .fromTo(".cw-birdlight", { autoAlpha: 0 }, { autoAlpha: 0.85, duration: Math.max(0.02, peak - lit), ease: "sine.inOut" }, lit);
    if (A3)
      tl.fromTo(".cw-birdshade", { opacity: 0 }, { opacity: 1, duration: Math.max(0.02, peak - lit), ease: "sine.inOut" }, lit)
        .fromTo(".cw-birdlight2", { autoAlpha: 0 }, { autoAlpha: 0.55, duration: Math.max(0.02, peak - lit), ease: "sine.inOut" }, lit);
  }
  (COLD_OPT.view ? move(7, cam(200, 440, 1.0), 0.2).to(".cw-camera", { ...(CP ? cam(HOLE.x + 22, HOLE.y + 6, 3.6) : cam(HOLE.x + (COLD_OPT.cu?.[0] ?? 12), HOLE.y + 30, COLD_OPT.cu?.[1] ?? 2.3)), duration: 0.5, ease: "sine.inOut" }, 7.22) : move(7, cam(HOLE.x + 12, HOLE.y + 30, 2.3)))
    .to(".cw-moon", { attr: { transform: "translate(-120 300)" }, duration: 0.6 }, 7.05)
    .fromTo(".cw-band", { x: 100, autoAlpha: 0 }, { x: 0, autoAlpha: A3 ? 0.3 : 0.55, duration: Math.min(0.3, 7.75 - band), ease: "sine.inOut" }, band)
    .to(".cw-frost", { opacity: 0.9, duration: Math.min(0.3, 7.75 - band) }, band);
  // 第3次：8P は静かに。降る雪を控えめに（眠る姿を飾らない）。樹皮と雪面の月明かりは少し落とす（月は西へ）。
  if (A3) tl.to(".cw-snow", { opacity: 0.55, duration: 0.3 }, 7.05).to(".cw-bark-moon", { opacity: 0.16, duration: 0.3 }, 7.05).to(".cw-snowlit", { opacity: 0.3, duration: 0.3 }, 7.05);
  // 9 コールドムーン：朝の光（木が桃色に照らされる）→「フィーチー」でコガラが穴から出て枝へ →「朝の森」は止まった絵で →
  // 西へ向く（カメラが左へ。月が動いたのでなく見る向きが変わった）→ 白い月 →「西の空」→ 余白 → 名前。月は最後まで消さない。
  // 見本（?coldSleep=1、11/26 レビュー「文字が完全に消えた後も、3秒程度は眠るコガラを眺められる時間」）：夜明けは、8P の文が
  // 消えて絵だけの時間（8P の picture）が終わってから（9P の「絵が先」の頭、合図 108）。それまで夜の穴の寄りのまま。
  const fly = cue(8, 0, 8.14);
  const west = cue(8, 2, 8.74);
  const turn = Math.max(fly + 0.17, west - 0.11);
  if (COLD_OPT.sleep) {
    // 見本（?coldSleep=1、11/26 14:36 レビュー「夜の近景から朝の遠景へ急に変わる。空が少しずつ明るむ → 月光の青白さが
    // 薄れる → 視点がゆっくり遠ざかる → 声と朝の活動」）：9P の「絵が先」（intro 4.4 秒）の中で、この順に重ねて進める。
    // 8P の文が消えはじめてから「フィーチー」までは、8P の消える秒＋絵だけの秒＋ 9P の intro（SLEEP_TIMES）。その区間は
    // 一定の速さで運ぶので、秒は拍に比例させて置く（文が消えはじめるのは 8P の区間の終わり 7.78）。
    const T = SLEEP_TIMES;
    const span = (fly - 7.78) / (T.fade8 + T.picture8 + T.intro9); // 1 秒あたりの拍
    const at = (sec: number) => fly - (T.intro9 - sec) * span; // 9P の intro の頭からの秒
    const dur = (sec: number) => Math.max(0.002, sec * span);
    tl.to(".cw-sky-dawn", { opacity: 1, duration: dur(3.2), ease: "sine.inOut" }, at(0))
      .to(".cw-sky-night", { opacity: 0, duration: dur(3.2), ease: "sine.inOut" }, at(0))
      .to(".cw-stars", { opacity: 0, duration: dur(2.4) }, at(0.3))
      .to(".cw-shade-night", { opacity: A3 ? 0.08 : 0.2, duration: dur(3.4), ease: "sine.inOut" }, at(0.2))
      .to(".cw-trunk-dawn", { opacity: 1, duration: dur(3.0), ease: "sine.inOut" }, at(0.6))
      // 月光の青白さが薄れる（空が明るみはじめてから）。
      // 穴の中の光（色を変える filter つきの絵）は、視点が動きだす前に消しきって描かないようにする（autoAlpha、描く負荷）。
      .to(".cw-birdlight", { autoAlpha: 0, duration: dur(1.0), ease: "sine.inOut" }, at(0.6))
      .to(".cw-band", { autoAlpha: 0, duration: dur(1.4), ease: "sine.inOut" }, at(0.6))
      .to(".cw-moon-air", { autoAlpha: 0, duration: dur(2.0) }, at(0.6))
      .to([".cw-bark-moon", ".cw-snowlit"], { opacity: 0, duration: dur(2.0) }, at(0.6))
      .to(".cw-birdshade", { opacity: 0, duration: dur(1.0) }, at(0.6))
      .to(".cw-birdlight2", { autoAlpha: 0, duration: dur(1.0) }, at(0.6))
      .to([".cw-stars3-b", ".cw-stars3-d"], { opacity: 0, duration: dur(2.4) }, at(0.3))
      .to(".cw-snow", { opacity: 1, duration: dur(2.0) }, at(1.0))
      .to(".cw-moonlit", { opacity: 0, duration: dur(2.0) }, at(0.6))
      .to(".cw-frost", { opacity: 0.4, duration: dur(2.0) }, at(0.8))
      .to(".cw-air", { autoAlpha: A3 ? 0.4 : 0.5, duration: dur(2.4), ease: "sine.inOut" }, at(1.2))
      .to(".cw-mist", { autoAlpha: 0.45, duration: dur(2.4), ease: "sine.inOut" }, at(1.6))
      // 視点がゆっくり遠ざかる。寄りの絵（A-11）は離れはじめてから今の幹へ戻す。
      .to(".cw-camera", { ...cam(270, 540, 1.3), duration: dur(2.6), ease: "sine.inOut" }, at(1.7))
      .to(".cw-hole-sleep", { autoAlpha: 0, duration: dur(0.8), ease: "sine.inOut" }, at(1.8))
      .set(".cw-moon", { attr: { transform: "translate(64 400) scale(0.5)" } }, at(1.4))
      .set(".cw-moon-tint", { opacity: A3 ? 0.86 : 0.62 }, at(1.4));
    // 2回目：9P は朝の色を独立させる。空の下・雪面の反射・シラカバの光を受ける側（東）に、ごく淡い桃色。西の白い月と対に。
    if (A3)
      tl.to(".cw-dawnglow", { opacity: 1, duration: dur(3.0), ease: "sine.inOut" }, at(0.6))
        .to(".cw-snowpink", { opacity: 0.32, duration: dur(3.0), ease: "sine.inOut" }, at(0.8))
        .to(".cw-bark-dawn", { opacity: 0.55, duration: dur(3.0), ease: "sine.inOut" }, at(0.8));
  } else
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
      .to(".cw-shade-night", { opacity: 0.2, duration: 0.3, ease: "sine.inOut" }, 8.02);
  tl
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.02 }, fly)
    .to(".cw-fly", { opacity: 1, duration: 0.02 }, fly)
    .to(".cw-fly", { x: -108, duration: 0.12, ease: "sine.inOut" }, fly + 0.01)
    .to(".cw-fly", { keyframes: { y: [0, -22, 30] }, duration: 0.12, ease: "sine.inOut" }, fly + 0.01)
    .to(".cw-song", { opacity: 1, duration: 0.03 }, fly + 0.12)
    .to(".cw-fly", { opacity: 0, duration: 0.03 }, fly + 0.14);
  // 枝にとまったら少し止まり（「朝の森に、コガラの声。」を止まった絵で読む）、「西の空」の前に西へ向く（11/23 レビュー：
  // 一つの続いた動きにせず、短い静止で余韻を作る）。
  // 段階2：世界へ戻る。西を向くとき、1P より少し広く引く（コガラは小さく、森と西の白い月が大きく）。
  move(turn, CP ? cam(185, 470, 0.75) : cam(175, 480, 0.96), Math.min(0.1, 8.75 - turn));
}

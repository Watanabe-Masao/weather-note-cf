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
  birchKnot: "#4d473c",
  snow: ["#f4f6fb", "#dfe6f2", "#c8d3e8"] as const,
  shadow: "#b6c3de",
  bark: "#f3e9e4",
  barkShade: "#d6cfd4",
  twig: "#6b5240",
};

// 置く位置（世界の座標 400×860）。主役のシラカバは右寄りに一本。素材の目印は design-src/story/cold/pack/anchors.json。
/** 主役のシラカバ：根元の中心、幅、太い幹の上の端（そこから上は細い二本の枝になって画面の外へ。
 * 上の方は物語の文字の後ろに来るので、文字が読めるよう細い枝だけにする）。 */
const BIRCH = { x: 292, base: 690, w: 64, top: 390 };
/** 太い幹の上の端の幅。 */
const TOP_W = BIRCH.w - 10;
/** 主役の幹の形（太い幹＋上で分かれる細い二本の枝）。夜に沈める色の切り抜きにも使う。 */
const TRUNK_D = [
  `M${BIRCH.x - BIRCH.w / 2} ${BIRCH.base} L${BIRCH.x - TOP_W / 2} ${BIRCH.top} C ${BIRCH.x - 18} ${BIRCH.top - 30} ${BIRCH.x - 12} ${BIRCH.top - 50} ${BIRCH.x - 10} ${BIRCH.top - 70}`,
  `L${BIRCH.x - 40} -300 L${BIRCH.x - 28} -300 L${BIRCH.x + 2} ${BIRCH.top - 66}`,
  `L${BIRCH.x + 34} -300 L${BIRCH.x + 43} -300 L${BIRCH.x + 10} ${BIRCH.top - 62}`,
  `C ${BIRCH.x + 14} ${BIRCH.top - 44} ${BIRCH.x + 20} ${BIRCH.top - 26} ${BIRCH.x + TOP_W / 2} ${BIRCH.top} L${BIRCH.x + BIRCH.w / 2} ${BIRCH.base} Z`,
].join(" ");
/** 高さ y での幹の左右の端。 */
const trunkEdge = (y: number) => {
  const half = (TOP_W + ((BIRCH.w - TOP_W) * (y - BIRCH.top)) / (BIRCH.base - BIRCH.top)) / 2;
  return [BIRCH.x - half, BIRCH.x + half] as const;
};
/** 木の穴（キツツキの古い穴）。描き込んだ幹（c05）の穴の口に合わせる。 */
const HOLE = { x: 294, y: 548, rx: 13, ry: 14 };
/** 描き込んだ幹（c05、1024×1536）：穴の口の中心は画像の (510, 671)、幹の幅は画像の約 620。幹の幅を BIRCH.w にそろえる。 */
const TRUNK_IMG = (() => {
  const s = BIRCH.w / 620;
  return { x: HOLE.x - 510 * s, y: HOLE.y - 671 * s, w: 1024 * s, h: 1536 * s };
})();
/** 左上の雪の枝（c09、1774×887。左の端が幹）。ビーバームーンの紅葉の枝と同じ、1・2ページの額縁。 */
const BRANCH = { x: -46, y: 92, w: 310, h: (310 * 887) / 1774 };
/** いちばん手前の雪と枯れ草（c08-near、2172×724。上の縁は画像の y≈260〜570）。 */
const NEAR = { x: -110, y: 700, w: 620, h: (620 * 724) / 2172 };
/** 雪の枝（幹から左へ）。コガラの足が触れる所。 */
const BOUGH = { x0: BIRCH.x - BIRCH.w / 2 + 2, y0: 600, x1: 168, y1: 590 };
/** 枝のコガラ（c01、1536×1024。足が枝に触れる点は画像の (965, 975)）。鳥の幅は画像の約 7 割。 */
const PERCH = { w: 76, foot: [965, 975] as const, at: [212, 596] as const };
/** 幹のすきまに種をかくす（c03、1024×1536）：絵の中の足（画像の x≈620, y≈845）を、主役の幹の左の縁（枝の下）に合わせる。
 * 絵の中の幹と茂みは消し（cw-seed-mask）、鳥と種だけを残す。 */
const SEED = { w: 132, h: 198 };
const SEED_AT = { x: BIRCH.x - BIRCH.w / 2 - (SEED.w * 600) / 1024, y: 652 - (SEED.h * 845) / 1536 };
/** 穴の中のふくらんだコガラ（c06、1536×1024。鳥の幅は画像の約 6 割）。 */
const FLUFF = { w: 46, h: (46 * 1024) / 1536 };
/** 夜明けの枝でさえずるコガラ（c07、1536×1024、枝つき）。 */
const SONG = { w: 92, h: (92 * 1024) / 1536, x: 140, y: 546 };

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

/** 主役のシラカバ（平たい面）：白い幹、皮目（横の短い線）と黒いあざ、雪、木の穴、左へ伸びる雪の枝。
 * 皮目とあざは描き込んだ幹（c05）と同じ形・同じ色にして、平たい幹と描き込んだ幹のつなぎ目を目立たせない。 */
function MainBirch(): ReactElement {
  const r = rand(77);
  const { x, base, top } = BIRCH;
  const dashes: ReactElement[] = [];
  for (let y = top + 6; y < base - 6; y += 9 + r() * 7) {
    if (y > TRUNK_IMG.y + 10 && y < TRUNK_IMG.y + TRUNK_IMG.h - 14) continue;
    const [l, rt] = trunkEdge(y);
    const dw = 5 + r() * 9;
    const dx = l + 3 + r() * (rt - l - dw - 6);
    dashes.push(<rect key={`d${dashes.length}`} x={dx} y={y} width={dw} height={1.6} rx={0.8} fill={C.birchMark} opacity={0.55} />);
  }
  const knots = [404, 470, 650].map((y, i) => {
    const [l, rt] = trunkEdge(y);
    const left = i % 2 === 0;
    const kw = 14 + r() * 10;
    return (
      <path
        key={`k${i}`}
        d={left ? `M${l} ${y - 5} q ${kw * 0.6} 2 ${kw} 5 q ${-kw * 0.4} 4 ${-kw} 5 Z` : `M${rt} ${y - 5} q ${-kw * 0.6} 2 ${-kw} 5 q ${kw * 0.4} 4 ${kw} 5 Z`}
        fill={C.birchKnot}
        opacity={0.85}
      />
    );
  });
  return (
    <g>
      {/* 幹 */}
      <path className="cw-trunk" d={TRUNK_D} fill={C.bark} />
      {/* 右側のかげ（光は左＝南の低い日から） */}
      <path d={`M${x + TOP_W / 2 - 12} ${top} L${x + TOP_W / 2} ${top} L${x + BIRCH.w / 2} ${base} L${x + BIRCH.w / 2 - 15} ${base} Z`} fill={C.barkShade} />
      {/* 細い枝の黒い節 */}
      {[60, 180, 280].map((y, i) => (
        <rect key={`l${i}`} x={x - 30 + ((y + 300) / (top - 70 + 300)) * 18 + (i % 2) * 2} y={y} width={6} height={1.6} fill={C.birchMark} opacity={0.6} />
      ))}
      {dashes}
      {knots}
      {/* 幹の左側の雪 */}
      {[440, 560, 660].map((y, i) => {
        const [l] = trunkEdge(y);
        return <path key={i} d={`M${l + 1} ${y} q -5 -8 5 -12 q 7 2 5 12 Z`} fill={C.snow[0]} />;
      })}
      {/* 穴のあたりは描き込んだ幹（c05）。上下は平たい幹へぼかしてつなぐ（ビーバームーンの住みかと同じ、主役の場所のアクセント）。 */}
      <image href={A("trunk-hole")} x={TRUNK_IMG.x} y={TRUNK_IMG.y} width={TRUNK_IMG.w} height={TRUNK_IMG.h} mask="url(#cw-trunk-mask)" />
      {/* 雪の枝（幹から左へ） */}
      <path
        d={`M${BOUGH.x0} ${BOUGH.y0} C ${BOUGH.x0 - 30} ${BOUGH.y0 - 4} ${BOUGH.x1 + 40} ${BOUGH.y1 + 2} ${BOUGH.x1} ${BOUGH.y1} M${BOUGH.x1 + 30} ${BOUGH.y1 + 1} l -14 -10`}
        stroke={C.twig}
        strokeWidth={3.2}
        strokeLinecap="round"
        fill="none"
      />
      <path d={`M${BOUGH.x0 - 2} ${BOUGH.y0 - 3} C ${BOUGH.x0 - 30} ${BOUGH.y0 - 9} ${BOUGH.x1 + 40} ${BOUGH.y1 - 4} ${BOUGH.x1 + 4} ${BOUGH.y1 - 3} Z`} fill={C.snow[0]} stroke={C.snow[0]} strokeWidth={2.4} strokeLinejoin="round" />
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
        <clipPath id="cw-land">
          <path d={land} />
          {/* 山より上に出る主役の幹も沈める */}
          <path d={TRUNK_D} />
        </clipPath>
        {/* 穴の口（穴の中のコガラは口の形に切る）。 */}
        <clipPath id="cw-hole">
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.rx} ry={HOLE.ry} />
        </clipPath>
        {/* 種をかくすコガラ（c03）の絵の、まわりの茂みを消す（鳥と幹のあたりだけ残す）。 */}
        <radialGradient id="cw-seed-fade" cx="0.42" cy="0.44" r="0.4">
          <stop offset="0.7" stopColor="#ffffff" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <linearGradient id="cw-seed-cut" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.74" stopColor="#000000" stopOpacity={0} />
          <stop offset="0.8" stopColor="#000000" stopOpacity={1} />
        </linearGradient>
        <mask id="cw-seed-mask" maskContentUnits="objectBoundingBox">
          <rect width={1} height={1} fill="url(#cw-seed-fade)" />
          <rect width={1} height={1} fill="url(#cw-seed-cut)" />
        </mask>
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
        {/* 雪の上の月明かり（ビーバームーンの水面の月の道にあたる）。 */}
        <radialGradient id="cw-moonlit-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff1c4" stopOpacity={0.9} />
          <stop offset="0.55" stopColor="#f6dc9a" stopOpacity={0.35} />
          <stop offset="1" stopColor="#f6dc9a" stopOpacity={0} />
        </radialGradient>
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
          <StoryMoon p="cw" at="translate(110 600)" img={storyAsset("cold", "moon")} />
        </g>
        <Distance />
        <SnowField />
        <MainBirch />
        {/* 穴の中で丸くなるコガラ（5・8ページは目を閉じ、6ページは開く）。穴の口の形に切る。 */}
        <g clipPath="url(#cw-hole)">
          <g className="cw-fluff-closed cw-breath" opacity={0}>
            <image href={A("fluff-closed")} x={HOLE.x - FLUFF.w / 2} y={HOLE.y - FLUFF.h * 0.36} width={FLUFF.w} height={FLUFF.h} />
          </g>
          <g className="cw-fluff-open cw-breath" opacity={0}>
            <image href={A("fluff-open")} x={HOLE.x - FLUFF.w / 2} y={HOLE.y - FLUFF.h * 0.36} width={FLUFF.w} height={FLUFF.h} />
          </g>
        </g>
        {/* 枝にとまるコガラ（2ページ） */}
        <g className="cw-perch cw-breath" opacity={0}>
          <image
            href={A("perch")}
            x={PERCH.at[0] - (PERCH.w * PERCH.foot[0]) / 1536}
            y={PERCH.at[1] - ((PERCH.w * 1024) / 1536) * (PERCH.foot[1] / 1024)}
            width={PERCH.w}
            height={(PERCH.w * 1024) / 1536}
          />
        </g>
        {/* 幹のすきまに種をかくすコガラ（3ページ、c03）：絵の中の幹を主役の幹に重ね、まわりの茂みは消す。 */}
        <g className="cw-seed cw-breath" opacity={0}>
          <image href={A("seed-trunk")} x={SEED_AT.x} y={SEED_AT.y} width={SEED.w} height={SEED.h} mask="url(#cw-seed-mask)" />
        </g>
        {/* 夜明けの枝でさえずるコガラ（9ページ、c07）。 */}
        <g className="cw-song cw-breath" opacity={0}>
          <image href={A("song")} x={SONG.x} y={SONG.y} width={SONG.w} height={SONG.h} />
        </g>
        <SnowField front />
        {/* 地上を沈める色（夕方は青いかげ、夜は紺）。地上の形で切り、空と月にはかからない。 */}
        <g clipPath="url(#cw-land)">
          <rect className="cw-shade-dusk" x={-700} y={-400} width={1800} height={2000} fill="#2a3876" opacity={0} />
          <rect className="cw-shade-night" x={-700} y={-400} width={1800} height={2000} fill="#071131" opacity={0} />
        </g>
        {/* 雪の上の月明かり（6〜8ページ。夜明けで消える）。紺に沈めた地上の上に重ねる。 */}
        <g className="cw-moonlit" opacity={0}>
          <ellipse cx={130} cy={716} rx={300} ry={44} fill="url(#cw-moonlit-g)" opacity={0.5} />
          <ellipse cx={HOLE.x - 10} cy={HOLE.y + 10} rx={40} ry={70} fill="url(#cw-moonlit-g)" opacity={0.35} />
        </g>
        {/* 上の雪の枝（1・2ページの前景）。後半のページには残さない。 */}
        <g className="cw-bough">
          <image href={A("branch")} x={BRANCH.x} y={BRANCH.y} width={BRANCH.w} height={BRANCH.h} />
        </g>
      </g>
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
export function buildColdScene(gsap: Gsap, root: Element, tl: Tween, loops = true): Loop | null {
  buildBeats(tl);
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
function buildBeats(tl: Tween) {
  const move = (at: number, c: ReturnType<typeof cam>) => tl.to(".cw-camera", { ...c, duration: 0.75, ease: "power2.inOut" }, at);
  // 1 雪の森：少し寄った所から、森全体へ。
  tl.fromTo(".cw-camera", { ...cam(200, 520, 1.3), svgOrigin: "200 430" }, { ...cam(200, 480, 1.1), duration: 0.75, ease: "power2.inOut" }, 0);
  // 2 雪の枝の小さなコガラ：枝に寄る（ビーバーの住みかの寄りと同じくらい）。
  move(1, cam(225, 545, 1.6)).to(".cw-perch", { opacity: 1, duration: 0.12 }, 1.2);
  // 3 ひとつぶずつ：幹のすきまに種をかくすコガラ。枝のコガラから入れ替わる（二つの姿を重ねない）。
  move(2, cam(BIRCH.x - 50, 600, 1.8))
    .to(".cw-perch", { opacity: 0, duration: 0.05 }, 2.05)
    .to(".cw-seed", { opacity: 1, duration: 0.1 }, 2.12);
  // 4 はやい夕暮れ：引いて空を広く。空と雪が青いかげへ。前景の枝は画面から出る。
  move(3, cam(200, 470, 1.0))
    .to(".cw-seed", { opacity: 0, duration: 0.05 }, 3.0)
    .to(".cw-sky-dusk", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 3.05)
    .to(".cw-shade-dusk", { opacity: 0.5, duration: 0.6, ease: "sine.inOut" }, 3.05)
    .to(".cw-bough", { opacity: 0, duration: 0.4 }, 3.1);
  // 5 木の穴へ：穴に寄る（コガラが画面の 3 分の 1 ほど）。穴の中で丸くなる（目を閉じた姿）。
  move(4, cam(HOLE.x - 20, HOLE.y + 30, 2.1)).to(".cw-fluff-closed", { opacity: 1, duration: 0.15 }, 4.35);
  // 6 月が昇る：引いて、北東の地平線（山の向こう）から月。夜になり、穴の口のコガラは目を開けて月を見る。
  move(5, cam(200, 480, 1.0))
    .to(".cw-sky-night", { opacity: 1, duration: 0.5, ease: "sine.inOut" }, 5)
    .to(".cw-shade-night", { opacity: 0.8, duration: 0.5, ease: "sine.inOut" }, 5)
    .to(".cw-shade-dusk", { opacity: 0, duration: 0.5 }, 5.1)
    .to(".cw-stars", { opacity: 1, duration: 0.4 }, 5.1)
    .to(".cw-moonrise", { opacity: 1, duration: 0.25, ease: "sine.in" }, 5)
    .to(".cw-moon-show", { opacity: 1, duration: 0.03 }, 5.18)
    .to(".cw-moonlit", { opacity: 0.8, duration: 0.4, ease: "sine.in" }, 5.3)
    .to(".cw-moon", { attr: { transform: "translate(110 420)" }, duration: 0.5, ease: "power1.out" }, 5.2)
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.05 }, 5.2)
    .to(".cw-fluff-open", { opacity: 1, duration: 0.05 }, 5.22);
  // 7 高く、高く：見上げる（下に森、上に月）。月は東から南の高い所へ。真上にはしない。
  move(6, cam(200, 400, 1.0))
    .to(".cw-moonrise", { opacity: 0, duration: 0.3 }, 6.02)
    .to(".cw-moon", { attr: { transform: "translate(160 180)" }, duration: 0.7, ease: "sine.inOut" }, 6.02)
    .to(".cw-fluff-open", { opacity: 0, duration: 0.05 }, 6.1)
    .to(".cw-fluff-closed", { opacity: 1, duration: 0.05 }, 6.12);
  // 8 ながい夜：穴の口に寄る。月の円盤は画面に入れない（光だけ。光の帯は PR-3）。
  move(7, cam(HOLE.x - 20, HOLE.y + 30, 2.3)).to(".cw-moon", { attr: { transform: "translate(-120 300)" }, duration: 0.6 }, 7.05);
  // 9 コールドムーン：夜明けの森の一枚の絵。西の空の低い所に白い月、コガラは穴から出て枝でさえずる。
  move(8, cam(200, 480, 0.96))
    .to(".cw-sky-dawn", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 8)
    .to(".cw-sky-night", { opacity: 0, duration: 0.6, ease: "sine.inOut" }, 8.05)
    .to(".cw-stars", { opacity: 0, duration: 0.5 }, 8.05)
    .to(".cw-moonlit", { opacity: 0, duration: 0.5 }, 8.05)
    .to(".cw-shade-night", { opacity: 0.2, duration: 0.6, ease: "sine.inOut" }, 8.05)
    .set(".cw-moon", { attr: { transform: "translate(64 400) scale(0.5)" } }, 8.02)
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.05 }, 8.1)
    .to(".cw-song", { opacity: 1, duration: 0.15 }, 8.3);
}

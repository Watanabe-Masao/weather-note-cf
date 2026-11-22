// ビーバームーンの絵本の世界（2026-11-20 渡辺さん「一コマ一コマ、一つ一つのパーツ、背景、描画を通じた一体感で
// 物語の世界観を表現し、満月の魅力を体験させる」）。一枚の続いた世界を、絵本の1ページごとに場面（コマ）として動かす。
// 11/21 絵本の本文（Project「ビーバームーン_絵コンテと本文」v0.3）に合わせて付け直した：
//   1 秋の森、葉がはらり、はらり → 2 ちゃぷん、枝をくわえたビーバーが顔を出す → 3 一本、また一本（住みかへ枝を運ぶ）→
//   4 枝を重ね、泥をぬる → 5 夕暮れ、一番星、あと一本だけ（振り返る）→ 6 丘の向こうが明るみ、満月が昇る →
//   7 月明かりの中を泳いで最後の一本 → 8 雪がひとひら、潜って住みかへ → 9 しんとした冬の森が一枚の絵に。
// 色はここ（デザインの層）にだけ書く。動きは buildBeaverScene（GSAP、スクロールに合わせる）。
// 絵は文化的なイメージで、実際の月の色や見え方とは別（物語のページで断る）。
import type { ReactElement } from "react";
import { storyAsset } from "./storyAssets";
import {
  cssSky,
  MoonDefs,
  pine,
  rand,
  SkyGradient as Sky,
  STORY_H as H,
  STORY_MOON as MOON,
  STORY_W as W,
  StoryMoon,
  stars as starField,
} from "./parts";

/** 物語の一文の数（場面の数）。 */
export const BEAVER_BEATS = 9;
/**
 * 行を出しはじめる所（11/21 絵コンテ v0.3）：6ページ（コマ 5）は、丘の向こうが明るんでから1行目「ふわりと、森の向こうが
 * 明るくなって。」、月の縁が丘の上に出てから2行目「大きな、まんまるのお月さま。」（明るみは 5〜5.25、月は 5.22〜5.72 で昇る）。
 */
// 5ページ（11/21 承認）：絵が先、文があと。夕暮れの中で止まり、住みかを振り返り、前を向いてから「でも、あと一本だけ。」。
export const BEAVER_LINE_AT: Record<number, number[]> = { 4: [0, 0, 0.59], 5: [0.12, 0.34] };

/** 渡辺さんの素材（src/design/story/storyAssets.ts の beaver）。 */
const A = (name: string) => storyAsset("beaver", name);

const SKY = {
  dusk: ["#3a3f7e", "#b2617a", "#f0a565", "#f7cf8a"],
  twilight: ["#1d2a5e", "#4e3f78", "#a26a7c", "#d69a7a"],
  night: ["#060d26", "#0c1a42", "#16295a", "#223a6e"],
};
const GOLD = "#f1d38a";
const WATER = ["#2b4a7d", "#16294f", "#0b1838"];
const LEAF = ["#e8a63d", "#d9772f", "#f2c35a", "#c85a2a"];


/** 住みか（枝を組んだ丸屋根）。枝は一本ずつ描かれる（.bw-stick）。 */
function Lodge() {
  const r = rand(11);
  const sticks = Array.from({ length: 46 }, (_, i) => {
    const t = i / 46;
    const a = Math.PI * (0.05 + 0.9 * r());
    const rr = 0.35 + 0.65 * Math.sqrt(r());
    const cx = Math.cos(a) * 62 * rr;
    const cy = -Math.sin(a) * 40 * rr;
    const ang = (r() - 0.5) * 2.4 + (t > 0.5 ? 0.6 : -0.6);
    const len = 22 + r() * 26;
    const dx = Math.cos(ang) * len * 0.5;
    const dy = Math.sin(ang) * len * 0.5;
    return (
      <path
        key={i}
        className="bw-stick"
        d={`M${(cx - dx).toFixed(1)} ${(cy - dy).toFixed(1)} L${(cx + dx).toFixed(1)} ${(cy + dy).toFixed(1)}`}
        pathLength={1}
        stroke={i % 3 ? "#6b4a2d" : "#8a6238"}
        strokeWidth={2.6 + r() * 1.6}
        strokeLinecap="round"
      />
    );
  });
  return (
    <g>
      <path
        className="bw-mud"
        d="M-66 0 C -60 -30 -32 -46 0 -46 C 32 -46 60 -30 66 0 Z"
        fill="#2e2117"
      />
      {sticks}
      {/* 塗った泥（4ページ「泥をぬって。」）：下から広がる。 */}
      <path
        className="bw-mud-coat"
        d="M-62 0 C -56 -26 -30 -40 0 -41 C 30 -40 56 -26 62 0 Z"
        fill="#3a2a1c"
        opacity={0}
      />
    </g>
  );
}

/** 水の中に蓄えた枝（住みかのそば、水面の下）。 */
function Stash() {
  const r = rand(5);
  return (
    <g className="bw-stash" opacity={0}>
      {Array.from({ length: 14 }, (_, i) => {
        const x = -40 + r() * 80;
        const y = 10 + r() * 26;
        const a = (r() - 0.5) * 1.2;
        return (
          <path
            key={i}
            d={`M${x - 14 * Math.cos(a)} ${y - 14 * Math.sin(a)} L${x + 14 * Math.cos(a)} ${y + 14 * Math.sin(a)}`}
            stroke="#9a7a52"
            strokeWidth={2.2}
            strokeLinecap="round"
            opacity={0.55}
          />
        );
      })}
    </g>
  );
}

/** 場面の最初の空（本のページの窓から場面へつなぐ色。CSS の背景）。 */
export const BEAVER_SKY = cssSky(SKY.dusk);

/**
 * 表紙の真ん中の絵（11/20 18:42 渡辺さんの素材の表紙を、素材を重ねて組み直したもの）：満月、紅葉の木、水面の月の道、
 * 巣の上のビーバー。文字は表紙の側（HTML）で重ねる（素材の README「絵の中の文字は作り直す」）。並べ方は CSS（.bca-*）。
 */
export function BeaverCoverArt(): ReactElement {
  // 11/20 19:52 渡辺さんの見本（素材の book_cover）：大きな満月、重なる山、針葉樹と紅葉、川の月の道、巣の上のビーバー。
  // 山・森・川は物語の場面と同じ平たい描き方（19:53「山・森・川はあれがいい。絵本っぽさをメインでない部分で」）。
  const r = rand(19);
  const pines = Array.from({ length: 22 }, (_, i) =>
    pine(
      i * 15 + r() * 6 - 8,
      186 + r() * 5,
      16 + r() * 14,
      "#16224a",
      `cp${i}`,
    ),
  );
  const sparks = Array.from({ length: 9 }, (_, i) => (
    <circle
      key={i}
      cx={(r() * 300).toFixed(0)}
      cy={(8 + r() * 70).toFixed(0)}
      r={0.6 + r() * 0.9}
      fill={GOLD}
      opacity={0.5 + r() * 0.4}
    />
  ));
  return (
    <svg
      className="bca"
      viewBox="0 0 300 260"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
    >
      <defs>
        <MoonDefs p="bca" />
        <linearGradient id="bca-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={WATER[0]} />
          <stop offset="1" stopColor={WATER[2]} />
        </linearGradient>
        {/* 絵の四方を革へ溶かす */}
        <radialGradient id="bca-fade" cx="0.5" cy="0.5" r="0.62">
          <stop offset="0.72" stopColor="#ffffff" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <mask id="bca-mask">
          <rect width={300} height={260} fill="url(#bca-fade)" />
        </mask>
        <linearGradient id="bca-top" x1="0" y1="0" x2="0" y2="1">
          {/* 絵の上は切れて見える（xMidYMax slice）ので、見える上の縁で光が消えるように少し下から */}
          <stop offset="0.1" stopColor="#000000" />
          <stop offset="0.42" stopColor="#ffffff" />
        </linearGradient>
        <mask id="bca-mask-top">
          <rect width={300} height={260} fill="url(#bca-top)" />
        </mask>
      </defs>
      <g mask="url(#bca-mask)">
        <g>{sparks}</g>
        <circle
          cx={150}
          cy={96}
          r={150}
          fill="url(#bca-moon-glow)"
          mask="url(#bca-mask-top)"
        />
        <image href={A("moon")} x={92} y={38} width={116} height={116} />
        {/* 遠い山・近い丘 */}
        <path
          d="M-10 168 L 30 128 L 62 146 L 104 112 L 150 150 L 196 118 L 236 146 L 270 124 L 310 156 L 310 196 L -10 196 Z"
          fill="#2a3a6e"
        />
        <path
          d="M-10 176 C 50 158 110 170 160 162 C 210 154 260 166 310 160 L 310 200 L -10 200 Z"
          fill="#22305e"
        />
        <g>{pines}</g>
        <image href={A("tree")} x={-6} y={120} width={58} height={86} />
        <image
          href={A("tree")}
          x={34}
          y={146}
          width={34}
          height={50}
          opacity={0.9}
        />
        <image href={A("tree-big")} x={236} y={128} width={80} height={75} />
        {/* 川と月の道 */}
        <path
          d="M-10 196 C 60 192 120 200 180 196 C 240 192 280 198 310 195 L 310 270 L -10 270 Z"
          fill="url(#bca-water)"
        />
        <image href={A("reflection")} x={94} y={198} width={112} height={39} />
        <path
          d="M14 222 q 16 -3 32 0 M220 236 q 20 -3 40 0 M40 248 q 18 -3 36 0"
          stroke="#9fb7e6"
          strokeWidth={0.8}
          opacity={0.45}
          fill="none"
        />
        {/* 巣の上のビーバー */}
        <image href={A("nest")} x={150} y={184} width={118} height={76} />
        <image
          href={A("beaver-branch")}
          x={162}
          y={140}
          width={86}
          height={86}
        />
        <image
          href={A("reed")}
          x={-8}
          y={206}
          width={70}
          height={54}
          opacity={0.85}
        />
      </g>
    </svg>
  );
}

/**
 * 紙のページの下の淡い絵（11/20 20:56 渡辺さんの見本）：湖のほとり、倒木の上のビーバー、手前の草、右の針葉樹の森。
 * 色はセピアの一色の濃淡（紙に刷ったように）。上は紙へ溶かす。並べ方の大きさは 400×150。
 */
function LakeArt(): ReactElement {
  const r = rand(23);
  const ink = "#6b4a2a";
  const warm = "#c8944a";
  const far = Array.from({ length: 18 }, (_, i) =>
    pine(200 + i * 11 + r() * 5, 104 + r() * 2, 12 + r() * 10, ink, `fa${i}`),
  );
  const near = Array.from({ length: 6 }, (_, i) =>
    pine(304 + i * 17 + r() * 6, 110, 40 + r() * 34, ink, `ne${i}`),
  );
  return (
    <svg
      className="bpa"
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="bpa-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" />
          <stop offset="0.4" stopColor="#ffffff" />
        </linearGradient>
        <mask id="bpa-mask">
          <rect width={400} height={160} fill="url(#bpa-fade)" />
        </mask>
        <radialGradient id="bpa-glow" cx="0.55" cy="0.68" r="0.5">
          <stop offset="0" stopColor={warm} stopOpacity={0.35} />
          <stop offset="1" stopColor={warm} stopOpacity={0} />
        </radialGradient>
      </defs>
      <g mask="url(#bpa-mask)">
        <rect width={400} height={160} fill="url(#bpa-glow)" />
        {/* 遠い丘 */}
        <path
          d="M120 108 C 170 86 220 80 270 90 C 300 96 320 100 360 104 L 360 112 L 120 112 Z"
          fill={ink}
          opacity={0.14}
        />
        <g opacity={0.2}>{far}</g>
        <g opacity={0.36}>{near}</g>
        {/* 湖：水平線と、映り込みの線と光 */}
        <path d="M0 110 H400" stroke={ink} strokeWidth={0.8} opacity={0.3} />
        <path
          d="M180 116 H250 M200 122 H236 M150 128 H220 M240 134 H320 M110 142 H190 M210 150 H300"
          stroke={warm}
          strokeWidth={0.9}
          opacity={0.45}
        />
        {/* 倒木とビーバー */}
        <path
          d="M26 130 C 60 120 118 118 172 124 L 178 134 C 130 130 74 132 30 140 Z"
          fill={ink}
          opacity={0.5}
        />
        <path
          d="M60 126 L 52 116 M138 122 L 146 112"
          stroke={ink}
          strokeWidth={1.6}
          opacity={0.45}
        />
        <image
          href={A("beaver")}
          x={62}
          y={74}
          width={64}
          height={64}
          className="bpa-ink"
          opacity={0.7}
        />
        <image
          href={A("reed")}
          x={-18}
          y={70}
          width={116}
          height={90}
          className="bpa-ink"
          opacity={0.6}
        />
        <image
          href={A("reed")}
          x={326}
          y={92}
          width={86}
          height={68}
          className="bpa-ink"
          opacity={0.5}
        />
      </g>
    </svg>
  );
}

/** 水辺のダムと巣（自然との関係のページ）：枝を組んだダムで水がせき止められ、奥に巣、枝をくわえて泳ぐビーバー。 */
function DamArt(): ReactElement {
  const r = rand(31);
  const ink = "#6b4a2a";
  const warm = "#c8944a";
  const far = Array.from({ length: 22 }, (_, i) =>
    pine(i * 19 + r() * 6, 96 + r() * 3, 12 + r() * 12, ink, `df${i}`),
  );
  const sticks = Array.from({ length: 34 }, (_, i) => {
    const x = 20 + (i / 34) * 200 + r() * 6;
    const y = 118 + r() * 10;
    const a = (r() - 0.5) * 0.9;
    const l = 10 + r() * 14;
    return (
      <path
        key={i}
        d={`M${(x - Math.cos(a) * l).toFixed(1)} ${(y - Math.sin(a) * l).toFixed(1)} L${(x + Math.cos(a) * l).toFixed(1)} ${(y + Math.sin(a) * l).toFixed(1)}`}
      />
    );
  });
  return (
    <svg
      className="bpa"
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="bda-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" />
          <stop offset="0.4" stopColor="#ffffff" />
        </linearGradient>
        <mask id="bda-mask">
          <rect width={400} height={160} fill="url(#bda-fade)" />
        </mask>
        <radialGradient id="bda-glow" cx="0.6" cy="0.7" r="0.5">
          <stop offset="0" stopColor={warm} stopOpacity={0.32} />
          <stop offset="1" stopColor={warm} stopOpacity={0} />
        </radialGradient>
      </defs>
      <g mask="url(#bda-mask)">
        <rect width={400} height={160} fill="url(#bda-glow)" />
        <g opacity={0.18}>{far}</g>
        {/* せき止められた池（奥）と、ダムの下の流れ（手前） */}
        <path d="M0 104 H400" stroke={ink} strokeWidth={0.8} opacity={0.3} />
        <path
          d="M240 112 H330 M270 118 H360 M250 106 H300"
          stroke={warm}
          strokeWidth={0.9}
          opacity={0.45}
        />
        <path
          d="M30 140 C 60 136 90 146 120 142 M60 150 C 90 146 130 154 170 150"
          stroke={ink}
          strokeWidth={0.8}
          opacity={0.28}
          fill="none"
        />
        {/* ダム：枝と泥を積んだ低い堤 */}
        <path
          d="M10 130 C 60 118 160 116 232 124 L 232 134 C 160 128 70 132 10 140 Z"
          fill={ink}
          opacity={0.32}
        />
        <g stroke={ink} strokeWidth={1.6} strokeLinecap="round" opacity={0.5}>
          {sticks}
        </g>
        {/* 奥の巣と、枝をくわえたビーバー */}
        <image
          href={A("nest")}
          x={262}
          y={70}
          width={92}
          height={60}
          className="bpa-ink"
          opacity={0.62}
        />
        <image
          href={A("beaver-branch")}
          x={150}
          y={74}
          width={64}
          height={64}
          className="bpa-ink"
          opacity={0.68}
        />
        <image
          href={A("reed")}
          x={-20}
          y={78}
          width={96}
          height={80}
          className="bpa-ink"
          opacity={0.5}
        />
        <image
          href={A("reed")}
          x={340}
          y={96}
          width={74}
          height={62}
          className="bpa-ink"
          opacity={0.45}
        />
      </g>
    </svg>
  );
}

/**
 * 紙のページの下の淡い絵（11/20 21:17 渡辺さん「ページごとに変える」）：名前の由来は湖のほとり、自然との関係は水辺のダムと巣。
 */
export function BeaverPaperArt({
  kind,
}: {
  kind: "origin" | "nature";
}): ReactElement {
  return kind === "nature" ? <DamArt /> : <LakeArt />;
}

/** 本のページの窓の絵（場面の最初のコマの小さな絵：夕暮れの空、丘、針葉樹、川）。窓の中へ寄ると、場面へつながる。 */
export function BeaverWindow(): ReactElement {
  const r = rand(7);
  return (
    <svg
      className="bk-window-art"
      viewBox="0 0 200 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <Sky id="bkw-sky" c={SKY.dusk} />
      </defs>
      <rect width={200} height={240} fill="url(#bkw-sky)" />
      <path
        d="M-10 170 L 30 130 L 60 150 L 100 110 L 140 145 L 175 120 L 210 150 L 210 200 L -10 200 Z"
        fill="#2a3a6e"
      />
      {Array.from({ length: 14 }, (_, i) =>
        pine(
          i * 15 + r() * 6 - 4,
          192 + r() * 4,
          22 + r() * 16,
          "#141d3c",
          `w${i}`,
        ),
      )}
      <rect x={-10} y={196} width={220} height={50} fill={WATER[1]} />
      <path
        d="M10 210 q 14 -3 28 0 M120 222 q 18 -3 36 0"
        stroke="#9fb7e6"
        strokeWidth={0.8}
        opacity={0.5}
        fill="none"
      />
      {Array.from({ length: 9 }, (_, i) => (
        <ellipse
          key={i}
          cx={20 + r() * 160}
          cy={40 + r() * 120}
          rx={2.4}
          ry={1.5}
          fill={LEAF[i % LEAF.length]}
          transform={`rotate(${(r() * 180).toFixed(0)})`}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      ))}
    </svg>
  );
}

/** 絵本の世界の SVG（スクロールの場面は buildBeaverScene が動かす）。 */
export function BeaverWorld(): ReactElement {
  const r = rand(42);
  const stars = starField("bw", 80, 42);
  const LEAVES = ["leaf-large", "leaf-small", "leaf-tiny"];
  const leaves = Array.from({ length: 16 }, (_, i) => {
    const sz = [22, 16, 11][i % 3];
    return (
      <image
        key={i}
        className="bw-leaf"
        href={A(LEAVES[i % 3])}
        x={-sz / 2}
        y={-sz / 2}
        width={sz}
        height={sz}
        transform={`translate(${(r() * W).toFixed(0)} -20)`}
      />
    );
  });
  const flakes = Array.from({ length: 70 }, (_, i) => (
    <circle
      key={i}
      className="bw-flake"
      r={1.6 + r() * 2.2}
      cx={(r() * W).toFixed(0)}
      cy={-10}
      fill="#ffffff"
      opacity={0.9}
    />
  ));
  const farPines = Array.from({ length: 24 }, (_, i) =>
    pine(
      i * 18 + r() * 8 - 6,
      552 + r() * 8,
      28 + r() * 18,
      "#1c2a52",
      `fp${i}`,
    ),
  );
  const midPines = Array.from({ length: 11 }, (_, i) =>
    pine(i * 40 + r() * 16, 604 + r() * 8, 54 + r() * 30, "#141d3c", `mp${i}`),
  );
  return (
    <svg
      className="bw"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <Sky id="bw-sky-dusk" c={SKY.dusk} />
        <Sky id="bw-sky-twi" c={SKY.twilight} />
        <Sky id="bw-sky-night" c={SKY.night} />
        <MoonDefs p="bw" />
        <linearGradient id="bw-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={WATER[0]} />
          <stop offset="0.5" stopColor={WATER[1]} />
          <stop offset="1" stopColor={WATER[2]} />
        </linearGradient>
        <linearGradient id="bw-road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={MOON.glow} stopOpacity={0.85} />
          <stop offset="1" stopColor={MOON.glow} stopOpacity={0} />
        </linearGradient>
        <radialGradient id="bw-fog" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c9d6f2" stopOpacity={0.35} />
          <stop offset="0.6" stopColor="#c9d6f2" stopOpacity={0.18} />
          <stop offset="1" stopColor="#c9d6f2" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="bw-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000000" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.55} />
        </radialGradient>
        <filter id="bw-soft" x="-50%" y="-20%" width="200%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <clipPath id="bw-above">
          <rect x={-200} y={-900} width={800} height={900} />
        </clipPath>
      </defs>
      <g className="bw-camera">
        {/* 空：夕暮れ → 薄明 → 夜 */}
        <rect
          x={-300}
          y={-400}
          width={W + 600}
          height={H + 800}
          fill="url(#bw-sky-dusk)"
        />
        <rect
          className="bw-sky-twi"
          x={-300}
          y={-400}
          width={W + 600}
          height={H + 800}
          fill="url(#bw-sky-twi)"
          opacity={0}
        />
        <rect
          className="bw-sky-night"
          x={-300}
          y={-400}
          width={W + 600}
          height={H + 800}
          fill="url(#bw-sky-night)"
          opacity={0}
        />
        <g className="bw-stars">{stars}</g>
        {/* 一番星（5ページ）：星空より先に、一つだけ。 */}
        <g className="bw-star1" opacity={0}>
          <circle cx={318} cy={452} r={5} fill={MOON.glow} opacity={0.35} />
          <circle cx={318} cy={452} r={1.9} fill="#fff8dc" />
        </g>
        {/* 満月（丘の向こうから昇る） */}
        {/* 昇る前は見せない（11/20 23:51 渡辺さん「ここもか」：丘と川の間の隙間から、昇る前の月が金の帯のように見えていた）。
            出し入れは外の組（.bw-moon-show）で：月の組の不透明度は、今夜の情報の月へ移る動きが使う。 */}
        <g className="bw-moon-show" opacity={0}>
          <StoryMoon p="bw" at="translate(150 640)" img={A("moon")} />
        </g>
        {/* 月の出の前の明るみ（丘の向こう） */}
        <ellipse
          className="bw-moonrise"
          cx={150}
          cy={540}
          rx={170}
          ry={90}
          fill="url(#bw-moon-glow)"
          opacity={0}
        />
        {/* 遠い山 */}
        <path
          d="M-40 560 L 20 500 L 70 530 L 130 470 L 190 520 L 250 480 L 310 525 L 370 490 L 440 540 L 440 600 L -40 600 Z"
          fill="#2a3a6e"
        />
        <path
          d="M-40 575 C 40 545 120 560 200 548 C 280 536 360 552 440 545 L 440 610 L -40 610 Z"
          fill="#22305e"
        />
        <g>{farPines}</g>
        <g className="bw-autumn">
          {/* 紅葉の木（渡辺さんの素材 11/20 18:42） */}
          <image href={A("tree")} x={-34} y={462} width={104} height={154} />
          <image
            href={A("tree-big")}
            x={290}
            y={474}
            width={140}
            height={131}
          />
          <image
            href={A("tree")}
            x={196}
            y={548}
            width={40}
            height={59}
            opacity={0.85}
          />
        </g>
        <g>{midPines}</g>
        {/* 川 */}
        <path
          d="M-40 618 C 60 610 140 626 220 620 C 300 614 360 622 440 616 L 440 740 L -40 740 Z"
          fill="url(#bw-water)"
        />
        <path
          className="bw-water-night"
          d="M-40 618 C 60 610 140 626 220 620 C 300 614 360 622 440 616 L 440 740 L -40 740 Z"
          fill="#081230"
          opacity={0}
        />
        <g className="bw-road" opacity={0}>
          {/* 月の道（素材の水面の映り込み） */}
          <image
            href={A("reflection")}
            x={60}
            y={624}
            width={180}
            height={63}
          />
        </g>
        <g
          className="bw-ripples"
          stroke="#9fb7e6"
          strokeWidth={1}
          opacity={0.5}
          fill="none"
        >
          <path d="M20 650 q 20 -4 40 0 M110 690 q 26 -5 52 0 M250 700 q 22 -4 44 0 M320 660 q 18 -3 36 0" />
        </g>
        {/* 霧（住みかとビーバーの奥） */}
        {/* 上下の縁がくっきりした帯に見えないよう、縦にも薄れる楕円（11/21 レビュー）。 */}
        <ellipse
          className="bw-fog"
          cx={200}
          cy={610}
          rx={330}
          ry={26}
          fill="url(#bw-fog)"
          opacity={0}
        />
        {/* 置いたあとの静けさ（3・7ページ）：枝を置き終えたページで、住みかのまわりに水の輪がゆっくり広がって消える。
            くり返す動き（startLoops）で、見えるのはそのページの間だけ（buildBeats が opacity を出し入れする）。 */}
        <g className="bw-calm" fill="none" stroke="#cfe0ff" opacity={0}>
          <ellipse className="bw-calm-ring" cx={292} cy={664} rx={62} ry={8} strokeWidth={1} />
          <ellipse className="bw-calm-ring" cx={292} cy={664} rx={62} ry={8} strokeWidth={1} />
        </g>
        {/* 住みかと、水に蓄えた枝 */}
        <g transform="translate(292 652)">
          <g transform="translate(-8 4)">
            <Stash />
          </g>
          <g className="bw-lodge">
            <Lodge />
          </g>
          {/* 雪をかぶった住みか（8〜9ページ、素材 A-03）。 */}
          <image className="bw-lodge-snow" href={A("nest-snow")} x={-76} y={-50} width={152} height={52} opacity={0} />
        </g>
        {/* ビーバー：泳ぐ姿と、住みかの上の姿 */}
        {/* ちゃぷん（2ページ）：顔を出す所の水の輪。 */}
        {/* 顔を出したビーバー（2ページ、素材 B-07）：主人公の顔と、口の「最初の一本」を近くで。 */}
        <g className="bw-peek" opacity={0}>
          <image href={A("beaver-peek")} x={74} y={615} width={88} height={57} />
        </g>
        <g className="bw-splash" transform="translate(118 664)" fill="none" stroke="#cfe0ff" opacity={0}>
          <ellipse rx={14} ry={3.2} strokeWidth={1.2} />
          <ellipse rx={26} ry={5.4} strokeWidth={0.8} opacity={0.6} />
        </g>
        {/* 泳ぐビーバー（11/21 渡辺さんの素材 A-08：細い枝をくわえて泳ぐ姿）。月明かりの夜は色を沈める（.bw-swim-img）。
            位置は GSAP の x・y（世界の座標そのもの。transform の translate を置き換える）。 */}
        <g className="bw-swim" transform="translate(-80 662)" opacity={0}>
          <g>
            {/* 昼（2・3ページ）は「最初の一本」（赤い葉が2枚の枝、素材 B-04）をくわえた姿、月明かりの7ページは細い普通の枝。 */}
            <image className="bw-swim-day" href={A("beaver-swim-first")} x={-66} y={-31} width={126} height={41} />
            <image className="bw-swim-img" href={A("beaver-swim-branch-blue")} x={-62} y={-30} width={112} height={40} opacity={0} />
          </g>
        </g>
        {/* 8ページ「住みかへ帰ります」（11/21 承認：カメラは寄せず、姿と動きで見せる）：住みかの前の水面を進む姿 →
            頭を下げて尾が少し残る姿（素材 A-04）→ 水に消えて、波の輪だけが残る。どれも月明かりの色に沈める。 */}
        <g className="bw-home" transform="translate(168 662)" opacity={0}>
          <image className="bw-night-img" href={A("beaver-swim")} x={-60} y={-38} width={120} height={50} />
        </g>
        <g className="bw-dive" opacity={0}>
          <image className="bw-night-img" href={A("beaver-dive")} x={176} y={604} width={110} height={62} />
        </g>
        <g className="bw-dive-ring" transform="translate(231 661)" fill="none" stroke="#cfe0ff" opacity={0}>
          <ellipse rx={16} ry={3.4} strokeWidth={1.1} />
          <ellipse rx={30} ry={6} strokeWidth={0.8} opacity={0.6} />
        </g>
        {/* 住みかへ運ぶ細い枝（3・7ページ、素材 A-02）：一本ずつ、住みかの上に置く。 */}
        <g className="bw-twigs">
          {[
            [262, 618, -18],
            [300, 612, 12],
            [278, 606, -6],
            [318, 622, 24],
          ].map(([x, y, a], i) => (
            <image
              key={i}
              className="bw-twig"
              href={A("twig")}
              x={x - 19}
              y={y - 8}
              width={38}
              height={16}
              opacity={0}
              transform={`rotate(${a} ${x} ${y})`}
            />
          ))}
          {/* 最初の一本（素材 B-03、11/21 承認）：2ページでくわえて来た枝を、3ページの「一本、」で住みかに組み込む。
              8ページで雪が積もると、雪をかぶった同じ枝が住みかの端から少しだけのぞく（2回目に読んだときに見つける程度）。 */}
          <image
            className="bw-first"
            href={A("first-branch")}
            x={236}
            y={608}
            width={52}
            height={19}
            opacity={0}
            transform="rotate(-18 262 618)"
          />
          <image
            className="bw-first-snow"
            href={A("first-branch-snow")}
            x={228}
            y={612}
            width={46}
            height={17}
            opacity={0}
            transform="rotate(-16 251 620)"
          />
        </g>
        {/* 月を見上げるビーバー（素材）：月が昇るコマで、枝を持つ姿から替わる。 */}
        <g className="bw-look bw-breath" opacity={0}>
          <image href={A("beaver")} x={212} y={524} width={98} height={94} />
        </g>
        {/* 4ページ：前足で泥をぬる（素材 B-06）。5ページ：前を見る（B-02）→ 振り返って住みかを見る（B-01）→ 前を見る。
            7ページ：置いたばかりの最後の一本を見下ろす（B-05）。 */}
        <g className="bw-mud2" opacity={0}>
          <image href={A("beaver-mud2")} x={205} y={564} width={140} height={94} />
        </g>
        <g className="bw-ahead bw-breath" opacity={0}>
          <image href={A("beaver-ahead")} x={229} y={528} width={126} height={92} />
        </g>
        <g className="bw-turn bw-breath" opacity={0}>
          <image href={A("beaver-turn")} x={236} y={528} width={112} height={92} />
        </g>
        <g className="bw-down bw-breath" opacity={0}>
          <image className="bw-night-img" href={A("beaver-down")} x={220} y={528} width={100} height={92} />
        </g>
        <g className="bw-sit bw-breath" opacity={0}>
          {/* 枝を持つビーバー（素材）。枝を置く動きは、この絵を少し傾けて（.bw-branch）。 */}
          <image
            className="bw-branch"
            href={A("beaver-branch")}
            x={206}
            y={540}
            width={130}
            height={95}
          />
        </g>
        {/* 手前の岸と葦 */}
        <path
          d="M-300 740 C 60 726 160 736 230 732 C 300 728 360 736 700 728 L 700 1300 L -300 1300 Z"
          fill="#0b1328"
        />
        <g fill="#0e1830">
          {Array.from({ length: 22 }, (_, i) => {
            const x = i * 19 + r() * 8;
            const h = 30 + r() * 46;
            return (
              <path
                key={i}
                d={`M${x} 742 C ${x + 2} ${742 - h * 0.5} ${x + 6} ${742 - h * 0.8} ${x + 10} ${742 - h} C ${x + 6} ${742 - h * 0.6} ${x + 5} ${742 - h * 0.3} ${x + 6} 742 Z`}
              />
            );
          })}
        </g>
        {/* 上の枝（見本の金の葉の枝） */}
        <g className="bw-bough">
          <image
            href={A("reed")}
            x={-20}
            y={690}
            width={150}
            height={72}
            opacity={0.9}
          />
          <image
            href={A("reed")}
            x={290}
            y={694}
            width={140}
            height={67}
            opacity={0.85}
          />
          {/* 上の紅葉の枝（素材） */}
          <image
            className="bw-maple"
            href={A("branch")}
            x={-40}
            y={40}
            width={240}
            height={148}
            transform="rotate(18 80 114)"
          />
        </g>
      </g>
      {/* 月明かりのもや（11/23、コールドムーンの c12b を使う。黒い背景のまま足し算で重ねる）：月が昇ってから（6〜9ページ）、
          月の側から下りる光。夕暮れのページは空の色だけで足りるので重ねない（見本で比べた）。 */}
      <image className="bw-moon-air" href={storyAsset("cold", "moon-air")} x={-110} y={-30} width={620} height={930} preserveAspectRatio="none" transform="matrix(-1 0 0 1 400 0)" opacity={0} style={{ mixBlendMode: "screen" }} />
      {/* 落ち葉と雪（場面に合わせて見せる） */}
      <g className="bw-leaves">{leaves}</g>
      {/* はらり、はらり（1ページ）：言葉に合わせて落ちる大きな葉が二枚。 */}
      <image className="bw-bigleaf" href={A("leaf-large")} x={-17} y={-17} width={34} height={34} transform="translate(120 -40)" />
      <image className="bw-bigleaf" href={A("leaf-large")} x={-15} y={-15} width={30} height={30} transform="translate(250 -40)" />
      {/* 雪がひとひら（8ページ）：雪の降りはじめの一片。 */}
      <circle className="bw-flake1" cx={210} cy={-20} r={4.2} fill="#ffffff" opacity={0} />
      <g className="bw-snow" opacity={0}>
        {flakes}
      </g>
      <rect
        width={W}
        height={H}
        fill="url(#bw-vignette)"
        pointerEvents="none"
      />
    </svg>
  );
}

// ---- 動き（GSAP、型は最小限） -----------------------------------------------------------------------

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

/**
 * 場面の動き。tl は物語の長さ（BEAVER_BEATS 拍）で、スクロールに合わせて進める（文はページの側で重ねる）。
 * 落ち葉・雪・泳ぎの揺れ・波はくり返す動き（スクロールと別）で、一つのタイムラインにまとめて返す（場面が画面に
 * 無い間は止める。GSAP 公式スキル gsap-performance「見えない動きは止める」「別々の遅れより stagger」）。
 */
export function buildBeaverScene(
  gsap: Gsap,
  root: Element,
  tl: Tween,
  loops = true,
): Loop | null {
  const q = (s: string) => root.querySelectorAll(s);
  buildBeats(tl, q);
  return loops ? startLoops(gsap, root) : null;
}

function startLoops(gsap: Gsap, root: Element): Loop {
  const loop = gsap.timeline({ paused: true }) as Loop;
  const leaves = gsap.utils.toArray<Element>(".bw-leaf", root);
  const flakes = gsap.utils.toArray<Element>(".bw-flake", root);
  // 落ち葉：左右に揺れながら回って落ちる（一枚ずつ少しずらして、くり返す）。
  loop.to(
    leaves,
    {
      y: 900,
      x: (i: number) => `+=${(i % 2 ? 1 : -1) * (40 + (i % 5) * 12)}`,
      rotation: (i: number) => (i % 2 ? 1 : -1) * 540,
      duration: (i: number) => 7 + (i % 6),
      ease: "none",
      stagger: { each: 0.9, repeat: -1 },
    },
    0,
  );
  // 雪：まっすぐ静かに。
  loop.to(
    flakes,
    {
      y: 900,
      x: (i: number) => `+=${((i % 3) - 1) * 10}`,
      duration: (i: number) => 9 + (i % 7),
      ease: "none",
      stagger: { each: 0.45, repeat: -1 },
    },
    0,
  );
  loop.to(
    ".bw-swim > g",
    { y: -2, duration: 1.1, yoyo: true, repeat: -1, ease: "sine.inOut" },
    0,
  );
  loop.to(
    ".bw-ripples",
    { x: 12, duration: 3, yoyo: true, repeat: -1, ease: "sine.inOut" },
    0,
  );
  loop.to(
    ".bw-moon-glow",
    {
      opacity: 0.75,
      duration: 2.6,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    },
    0,
  );
  // 呼吸（11/22）：止まっている姿は、数秒に一度、ごくわずかにふくらんで戻る（足もとを基準に、縦に 1.5%）。
  // 見えていない姿にも掛かるが、opacity 0 なので見えない（姿の出し入れはスクロールの側）。
  loop.to(
    ".bw-breath",
    { scaleY: 1.015, scaleX: 1.005, transformOrigin: "50% 100%", duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: -1, repeatDelay: 1.8 },
    0,
  );
  // 置いたあとの静けさ（11/22）：住みかのまわりの水の輪が、二つずらしてゆっくり広がって消える（4秒、間をおいて）。
  loop.fromTo(
    ".bw-calm-ring",
    { scale: 0.8, opacity: 0.55, svgOrigin: "292 664" },
    { scale: 1.45, opacity: 0, duration: 4, ease: "sine.out", stagger: { each: 2.6, repeat: -1, repeatDelay: 1.2 } },
    0,
  );
  // 開いたときに、もう降っている途中から。
  loop.time(40);
  return loop;
}

// 各コマの動きは、そのコマの頭から 0.75 までに終える（ページ送りは 0.78 で止まる。11/20 22:06 渡辺さん「止まる所が描画と
// リンクしていない」）。言葉と合わせる動き（はらり・ちゃぷん・一本ずつ・泥・一番星・月・あと一本・ひとひら）は、その言葉が
// 出る所（コマの中の 0〜1。読む速さは MoonStory の revealTimes）に置く（11/21 絵コンテ v0.3）。
function buildBeats(tl: Tween, q: (s: string) => NodeListOf<Element>) {
  const leaves = q(".bw-bigleaf");
  const twigs = q(".bw-twig");
  // 1 秋の森：森に寄ったカメラ、葉が落ちる。「はらり、はらり。」で大きな葉が二枚、間をおいて。
  tl.fromTo(
    ".bw-camera",
    { scale: 1.45, x: -60, y: -93, transformOrigin: "50% 50%" },
    { scale: 1.2, x: -10, y: -46, duration: 0.75, ease: "power2.inOut" },
    0,
  );
  [0.27, 0.36].forEach((at, i) =>
    tl.fromTo(
      leaves[i],
      { y: 0, x: 0, rotation: 0, opacity: 1 },
      { y: 760, x: i ? -60 : 50, rotation: i ? -320 : 280, duration: 0.42, ease: "sine.in" },
      at,
    ),
  );
  // 落ちきった葉は消す（11/21 レビュー：冬のページまで草むらに赤い葉が残っていた）。
  tl.to(leaves, { opacity: 0, duration: 0.08 }, 0.72);
  // 2 ちゃぷん：カメラが川へ降り、水の輪が広がって、枝をくわえたビーバーが顔を出す。少し泳いで住みかの方へ。
  tl.to(
    ".bw-camera",
    { scale: 1.3, x: 20, y: -64, duration: 0.75, ease: "power2.inOut" },
    1,
  )
    .fromTo(
      ".bw-splash",
      { opacity: 0.9, scale: 0.3, svgOrigin: "118 664" },
      { opacity: 0, scale: 1.4, duration: 0.2, ease: "power1.out" },
      1.06,
    )
    // 顔を出す（素材 B-07）：「顔を出しました」「口には一本の枝」を読むあいだ、顔と最初の一本を見せてから泳ぎだす。
    .fromTo(".bw-peek", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, 1.08)
    .to(".bw-peek", { opacity: 0, duration: 0.05 }, 1.56)
    .fromTo(".bw-swim", { x: 118, y: 662, opacity: 0 }, { opacity: 1, duration: 0.05 }, 1.6)
    .to(".bw-swim", { x: 160, duration: 0.15, ease: "power1.inOut" }, 1.6);
  // 3 一本、また一本：住みかへ泳いで枝を置く。言葉の拍で一本ずつ、そのあと枝が組み上がる。泳ぐ姿から住みかの上の姿へ。
  tl.to(".bw-swim", { x: 222, duration: 0.18, ease: "power1.inOut" }, 2)
    .to(".bw-swim", { opacity: 0, duration: 0.08 }, 2.2)
    .to(".bw-sit", { opacity: 1, duration: 0.12 }, 2.22);
  // 一つ目の「いっぽん。」で置くのは最初の一本（2ページでくわえて来た枝）。二つ目からは普通の枝（#416 で行が
  // 「いっぽん。また、いっぽん。」になり、二つ目の「いっぽん。」が少し遅く出るので 2.18）。
  tl.fromTo(".bw-first", { opacity: 0, y: -18 }, { opacity: 1, y: 0, duration: 0.06, ease: "power2.out" }, 2.07);
  [2.18, 2.32].forEach((at, i) =>
    tl.fromTo(
      twigs[i + 1],
      { opacity: 0, y: -18 },
      { opacity: 1, y: 0, duration: 0.06, ease: "power2.out" },
      at,
    ),
  );
  tl.fromTo(
    q(".bw-stick"),
    { strokeDasharray: 1, strokeDashoffset: 1 },
    { strokeDashoffset: 0, duration: 0.05, stagger: 0.012 },
    2.12,
  )
    .to(".bw-stash", { opacity: 1, duration: 0.3 }, 2.4)
    // 置き終えたあとの静けさ：水の輪を出し、次のページの頭で消す。
    .to(".bw-calm", { opacity: 1, duration: 0.15, ease: "sine.inOut" }, 2.5)
    .to(".bw-calm", { opacity: 0, duration: 0.1 }, 3.0)
    // 枝を住みかに置く（前足と枝が下りて、また上がる）。
    .fromTo(
      ".bw-branch",
      { rotation: -5, svgOrigin: "262 632" },
      { rotation: 4, duration: 0.12, ease: "power1.inOut", yoyo: true, repeat: 1 },
      2.4,
    )
    .to(
      ".bw-camera",
      { scale: 1.5, x: -150, y: -102, duration: 0.75, ease: "power2.inOut" },
      2,
    );
  // 4 枝を重ねて、泥をぬって：住みかに寄り、「泥をぬって。」で泥の色が下から広がる。「もう少し。あと少し。」で影が深くなる。
  tl.to(
    ".bw-camera",
    { scale: 1.7, x: -75, y: -131, duration: 0.75, ease: "power2.inOut" },
    3,
  )
    // 枝を持つ姿から、前足で泥をぬる姿へ（3ページと違う絵で止まる）。消えきってから出す（二つの姿を重ねない）。
    .to(".bw-sit", { opacity: 0, duration: 0.05 }, 3.02)
    .to(".bw-mud2", { opacity: 1, duration: 0.06 }, 3.07)
    .fromTo(".bw-mud", { opacity: 0 }, { opacity: 1, duration: 0.1 }, 3.06)
    .fromTo(
      ".bw-mud-coat",
      { opacity: 0, scaleY: 0, svgOrigin: "0 0" },
      { opacity: 0.6, scaleY: 1, duration: 0.3, ease: "power1.out" },
      3.12,
    )
    .fromTo(
      ".bw-mud2",
      { y: 0 },
      { y: 2.5, duration: 0.07, ease: "sine.inOut", yoyo: true, repeat: 3 },
      3.14,
    )
    .to(".bw-mud-coat", { opacity: 0.85, duration: 0.2 }, 3.5);
  // 5 夕暮れ、一番星、あと一本だけ：空と水面が夕暮れから宵へ。星は一つだけ先に灯る。最後の行でビーバーが川を振り返る。
  tl.to(".bw-camera", { scale: 1.15, x: 0, y: -36, duration: 0.75, ease: "power2.inOut" }, 4)
    .to(".bw-sky-twi", { opacity: 1, duration: 0.5, ease: "sine.inOut" }, 4)
    .to(".bw-water-night", { opacity: 0.55, duration: 0.6, ease: "sine.inOut" }, 4.1)
    .to(".bw-autumn", { opacity: 0.6, duration: 0.6 }, 4.1)
    .to(".bw-leaves", { opacity: 0.3, duration: 0.5 }, 4.1)
    .fromTo(".bw-star1", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "sine.in" }, 4.24)
    // 立ち止まる（11/21 承認）：泥をぬる姿から、住みかの上で前（川の向こう）を見る姿へ。二つ目の行のあと、動きを止めて
    // 振り返り、できかけの住みかを見る。一拍おいて前を向き直し、そこで「でも、あと一本だけ。」（BEAVER_LINE_AT の 4）。
    .to(".bw-mud2", { opacity: 0, duration: 0.05 }, 4.02)
    .to(".bw-ahead", { opacity: 1, duration: 0.06 }, 4.07)
    .to(".bw-ahead", { opacity: 0, duration: 0.02 }, 4.47)
    .to(".bw-turn", { opacity: 1, duration: 0.02 }, 4.49)
    .to(".bw-turn", { opacity: 0, duration: 0.02 }, 4.55)
    .to(".bw-ahead", { opacity: 1, duration: 0.02 }, 4.57);
  // 6 ふわりと明るくなって、まんまるのお月さま：丘の向こうが明るみ、夜になり、月が昇る。カメラが引く。ビーバーは向き直って見上げる。
  tl.to(".bw-moon-air", { opacity: 0.25, duration: 0.4, ease: "sine.in" }, 5.35);
  tl.to(".bw-moonrise", { opacity: 1, duration: 0.25, ease: "sine.in" }, 5)
    .to(".bw-sky-night", { opacity: 1, duration: 0.5, ease: "sine.inOut" }, 5)
    .to(".bw-water-night", { opacity: 1, duration: 0.4, ease: "sine.inOut" }, 5.05)
    .fromTo(
      q(".bw-star"),
      { opacity: 0 },
      { opacity: 0.9, duration: 0.06, stagger: { amount: 0.4, from: "random" } },
      5.05,
    )
    .to(".bw-moon-show", { opacity: 1, duration: 0.03 }, 5.2)
    .to(".bw-camera", { scale: 1, x: 0, y: -8, duration: 0.75, ease: "power2.inOut" }, 5)
    .to(".bw-moon", { attr: { transform: "translate(150 380)" }, duration: 0.5, ease: "power1.out" }, 5.22)
    .to(".bw-leaves", { opacity: 0, duration: 0.3 }, 5.05)
    .to(".bw-ahead", { opacity: 0, duration: 0.06 }, 5.42)
    .to(".bw-look", { opacity: 1, duration: 0.1 }, 5.49)
    .to(".bw-stars", { opacity: 0.5, duration: 0.3 }, 5.45)
    .to(".bw-autumn", { opacity: 0.4, duration: 0.3 }, 5.45)
    .fromTo(
      ".bw-road",
      { opacity: 0, scaleY: 0.2, svgOrigin: "150 622" },
      { opacity: 1, scaleY: 1, duration: 0.25, ease: "power1.out" },
      5.5,
    )
    .to(".bw-ripples", { opacity: 0.9, duration: 0.2 }, 5.55);
  // 7 月明かりの中を泳ぐ、あと一本：見上げる姿から、月の道を横切って泳ぐ姿へ（色は月明かりに沈める）。「あと一本。」で
  // 最後の枝を一本だけ置き、住みかの上で月を見上げる姿に戻る。
  tl.to(".bw-look", { opacity: 0, duration: 0.08 }, 6.02)
    .set(".bw-swim", { x: 40, y: 662 }, 6.02)
    .set(".bw-swim-img", { filter: "brightness(0.62) saturate(0.75)" }, 6.02)
    .set(".bw-swim-day", { opacity: 0 }, 6.02)
    // 月明かりの姿は色を沈める（見下ろす姿・泳ぐ姿・潜る姿。新しい素材だけが明るく浮かないように）。
    .set(".bw-night-img", { filter: "brightness(0.62) saturate(0.75)" }, 6.02)
    .set(".bw-swim-img", { opacity: 1 }, 6.02)
    // 見上げる姿が消えきってから泳ぐ姿を出す（11/21 レビュー：二つの姿が半透明で重なる瞬間があった）。
    .to(".bw-swim", { opacity: 1, duration: 0.08 }, 6.1)
    .to(".bw-swim", { x: 222, duration: 0.3, ease: "power1.inOut" }, 6.12)
    .fromTo(twigs[3], { opacity: 0, y: -18 }, { opacity: 1, y: 0, duration: 0.06, ease: "power2.out" }, 6.42)
    .to(".bw-swim", { opacity: 0, duration: 0.08 }, 6.44)
    // 最後の一本を置いたら、見上げる姿ではなく、その一本を見下ろす姿で止まる（素材 B-05。6ページと違う絵）。
    .to(".bw-down", { opacity: 1, duration: 0.1 }, 6.5)
    // 最後の一本を置いたあとの静けさ（3ページと同じ水の輪。8ページの頭で消す）。
    .to(".bw-calm", { opacity: 0.8, duration: 0.15, ease: "sine.inOut" }, 6.55)
    .to(".bw-calm", { opacity: 0, duration: 0.1 }, 7.0)
    .to(".bw-fog", { opacity: 1, duration: 0.4 }, 6.2)
    // 秋から冬へ（11/21 承認）：7ページは紅葉を残し、読み終えたあとの間から8ページの頭にかけて、上の紅葉の枝と
    // 紅葉の木をゆっくり消す（8・9ページは冬の森。急に消えないように）。
    .to(".bw-maple", { opacity: 0, duration: 0.6, ease: "sine.inOut" }, 6.75)
    .to(".bw-autumn", { opacity: 0, duration: 0.65, ease: "sine.inOut" }, 6.75);
  // 8 雪がひとひら、静かな住みかへ：一片の雪のあとに雪が降りはじめ、ビーバーは尾を上げて潜り、住みかに雪が積もる。
  tl.fromTo(".bw-flake1", { opacity: 0, y: 0 }, { opacity: 0.95, y: 560, duration: 0.36, ease: "none" }, 7.02)
    .to(".bw-flake1", { opacity: 0, duration: 0.05 }, 7.38)
    .to(".bw-snow", { opacity: 1, duration: 0.3 }, 7.3)
    // 住みかへ帰る（11/21 承認）：住みかの上の姿が消え、住みかの前の水面を進み、頭を下げて尾が少し残り、水に消える。
    // 波の輪が姿の消えたあとに残る。8ページの静けさを保つため、大きくは動かさない。
    // 住みかの上の姿が消えきってから泳ぐ姿を出す（二つの姿が半透明で重ならないように。7ページと同じ）。
    .to(".bw-down", { opacity: 0, duration: 0.08 }, 7.34)
    .fromTo(".bw-home", { opacity: 0, x: 150 }, { opacity: 1, x: 162, duration: 0.06 }, 7.43)
    .to(".bw-home", { x: 214, duration: 0.12, ease: "sine.inOut" }, 7.46)
    .to(".bw-home", { opacity: 0, duration: 0.04 }, 7.58)
    .fromTo(".bw-dive", { opacity: 0, y: 0 }, { opacity: 1, duration: 0.04 }, 7.58)
    .to(".bw-dive", { y: 16, opacity: 0, duration: 0.14, ease: "power1.in" }, 7.68)
    .fromTo(
      ".bw-dive-ring",
      { opacity: 0.85, scale: 0.6, svgOrigin: "231 661" },
      { opacity: 0, scale: 1.7, duration: 0.26, ease: "sine.out" },
      7.72,
    )
    .to(q(".bw-twig"), { opacity: 0, duration: 0.2 }, 7.45)
    .to(".bw-first", { opacity: 0, duration: 0.2 }, 7.45)
    .to(".bw-first-snow", { opacity: 0.9, duration: 0.25, ease: "sine.inOut" }, 7.5)
    .to(".bw-lodge-snow", { opacity: 1, duration: 0.25, ease: "sine.inOut" }, 7.45)
    .to(".bw-camera", { scale: 1.12, x: -30, y: -31, duration: 0.75, ease: "power2.inOut" }, 7);
  // 9 しんと静まった冬の森：世界が引いて一枚の絵に収まる。
  tl.to(".bw-camera", { scale: 0.96, x: 0, y: 10, duration: 0.75, ease: "power2.inOut" }, 8).to(
    ".bw-fog",
    { opacity: 0.5, duration: 0.5 },
    8.1,
  );
}

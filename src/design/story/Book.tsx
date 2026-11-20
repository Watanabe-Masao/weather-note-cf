// 満月の物語の「本」（2026-11-20 渡辺さんの見本：紺の革の表紙、金の飾り枠、生成りの紙、しおりのリボン）。
// 表紙を開くと紙のページ、そのページの絵の中へ入っていく（動きは src/ui/MoonStory.tsx）。色はここと palette.ts だけ。
import type { CSSProperties, ReactElement } from "react";
import { BOOK } from "./palette";
import { LEATHER, PAPER, WOOD } from "./textures";
import { SHELF_SLICE, storyAsset } from "./storyAssets";

/** 物語のページの CSS の変数（テーマによらず一つ）。 */
export function bookVars(): CSSProperties {
  return {
    ["--bk-cover-0" as string]: BOOK.cover[0],
    ["--bk-cover-1" as string]: BOOK.cover[1],
    ["--bk-gold-0" as string]: BOOK.gold[0],
    ["--bk-gold-1" as string]: BOOK.gold[1],
    ["--bk-paper-0" as string]: BOOK.paper[0],
    ["--bk-paper-1" as string]: BOOK.paper[1],
    ["--bk-ink" as string]: BOOK.ink,
    ["--bk-night-0" as string]: BOOK.night[0],
    ["--bk-night-1" as string]: BOOK.night[1],
    ["--bk-dusk-0" as string]: BOOK.dusk[0],
    ["--bk-dusk-1" as string]: BOOK.dusk[1],
    ["--bk-deep-0" as string]: BOOK.deep[0],
    ["--bk-deep-1" as string]: BOOK.deep[1],
    ["--bk-bookmark" as string]: BOOK.bookmark,
    ["--bk-ribbon" as string]: BOOK.ribbon,
    ["--bk-gold-shine" as string]: BOOK.goldShine,
    ["--bk-gold-deep" as string]: BOOK.goldDeep,
    ["--bk-engrave" as string]: BOOK.engrave,
    ["--bk-paper-tex" as string]: PAPER,
    ["--bk-stain" as string]: BOOK.stain,
    ["--bk-edge" as string]: BOOK.edge,
    ["--bk-ink-bleed" as string]: BOOK.inkBleed,
    ["--bk-seal" as string]: BOOK.seal,
    ["--bk-tag" as string]: BOOK.tag,
    ["--bk-engrave-soft" as string]: BOOK.engraveSoft,
    ["--bk-shine-faint" as string]: BOOK.shineFaint,
    ["--bk-shine-soft" as string]: BOOK.shineSoft,
    ["--bk-leather" as string]: LEATHER,
    // 本棚の絵（11/20 18:50 渡辺さん）を枠として伸ばす（border-image）。
    ["--ms-shelf-img" as string]: `url("${storyAsset("common", "shelf")}")`,
    ["--ms-shelf-slice" as string]: `${SHELF_SLICE.join(" ")} fill`,
    ["--bk-woodgrain" as string]: WOOD,
    ["--bk-emboss-0" as string]: BOOK.emboss[0],
    ["--bk-emboss-1" as string]: BOOK.emboss[1],
    ["--bk-wood-0" as string]: BOOK.wood[0],
    ["--bk-wood-1" as string]: BOOK.wood[1],
    ["--bk-moon-0" as string]: BOOK.moon[0],
    ["--bk-moon-1" as string]: BOOK.moon[1],
    ["--bk-moon-2" as string]: BOOK.moon[2],
  } as CSSProperties;
}

/** 金の箔押しの立体（光の当たる縁と、押した溝の影）。SVG の飾りに filter={BEVEL} で使う。 */
export const BEVEL = "url(#bk-bevel)";

/**
 * 物語のページに一つだけ置く SVG の定義（11/20 20:09 渡辺さん「金の縁など立体感が欲しい。重厚感」）：箔押しの面に左上から
 * 光を当て（feSpecularLighting）、下へ溝の影を落とす。物語の金の飾り（枠・紋・欧文・山並み）が url(#bk-bevel) で使う。
 */
export function GoldDefs(): ReactElement {
  return (
    <svg className="bk-defs" width={0} height={0} aria-hidden focusable="false">
      <defs>
        <filter
          id="bk-bevel"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation={0.6} result="blur" />
          <feSpecularLighting
            in="blur"
            surfaceScale={2.2}
            specularConstant={0.85}
            specularExponent={14}
            lightingColor={BOOK.goldShine}
            result="spec"
          >
            <feDistantLight azimuth={225} elevation={42} />
          </feSpecularLighting>
          <feComposite
            in="spec"
            in2="SourceAlpha"
            operator="in"
            result="specIn"
          />
          <feComposite
            in="SourceGraphic"
            in2="specIn"
            operator="arithmetic"
            k1={0}
            k2={0.82}
            k3={0.75}
            k4={0}
            result="lit"
          />
          <feOffset in="SourceAlpha" dy={0.9} result="off" />
          <feGaussianBlur in="off" stdDeviation={0.45} result="offBlur" />
          <feFlood floodColor={BOOK.engrave} floodOpacity={0.9} />
          <feComposite in2="offBlur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="lit" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

/** 本棚の i 冊目の背の色。 */
export const spineVar = (i: number): CSSProperties =>
  ({
    ["--spine" as string]: BOOK.spines[i % BOOK.spines.length],
  }) as CSSProperties;

/** 四隅の唐草（左上の形。ほかの隅は回して使う）。 */
function Corner({ t }: { t: string }) {
  return (
    <g transform={t}>
      <path d="M6 46 C 6 22 22 6 46 6" />
      <path d="M12 40 C 14 26 26 14 40 12" opacity={0.6} />
      <path d="M46 6 C 54 6 58 12 54 16 C 50 20 44 16 48 12" />
      <path d="M6 46 C 6 54 12 58 16 54 C 20 50 16 44 12 48" />
      <circle cx={18} cy={18} r={3.2} fill="currentColor" stroke="none" />
      <path d="M26 10 q 6 -6 12 0 M10 26 q -6 6 0 12" opacity={0.7} />
    </g>
  );
}

/** 金の飾り枠（表紙・紙のページの上に重ねる。幅と高さは viewBox の比で伸びる）。太い外の線・細い内の線の二重に、四隅の唐草。 */
export function GoldFrame({
  w = 300,
  h = 420,
  inset = 14,
  bevel = true,
}: {
  w?: number;
  h?: number;
  inset?: number;
  bevel?: boolean;
}): ReactElement {
  const i = inset;
  return (
    <svg
      className="bk-frame"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ color: BOOK.gold[0] }}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        filter={bevel ? BEVEL : undefined}
      >
        <rect
          x={i}
          y={i}
          width={w - i * 2}
          height={h - i * 2}
          rx={4}
          strokeWidth={2.6}
        />
        <rect
          x={i + 5}
          y={i + 5}
          width={w - i * 2 - 10}
          height={h - i * 2 - 10}
          rx={2}
          strokeWidth={0.9}
        />
        <rect
          x={i + 8}
          y={i + 8}
          width={w - i * 2 - 16}
          height={h - i * 2 - 16}
          rx={1.5}
          strokeWidth={0.6}
          opacity={0.7}
        />
        <Corner t={`translate(${i} ${i})`} />
        <Corner t={`translate(${w - i} ${i}) scale(-1 1)`} />
        <Corner t={`translate(${i} ${h - i}) scale(1 -1)`} />
        <Corner t={`translate(${w - i} ${h - i}) scale(-1 -1)`} />
        {/* 上下の中央の飾り */}
        <path
          d={`M${w / 2 - 34} ${i} q 17 14 34 0 q 17 14 34 0`}
          strokeWidth={1.8}
        />
        <path
          d={`M${w / 2 - 34} ${h - i} q 17 -14 34 0 q 17 -14 34 0`}
          strokeWidth={1.8}
        />
        <circle
          cx={w / 2}
          cy={i + 8}
          r={2.8}
          fill="currentColor"
          stroke="none"
        />
        <circle
          cx={w / 2}
          cy={h - i - 8}
          r={2.8}
          fill="currentColor"
          stroke="none"
        />
      </g>
    </svg>
  );
}

/** 小さな飾りの線（見出しの下など）：― ◆ ―。 */
export function Flourish(): ReactElement {
  return (
    <svg
      className="bk-flourish"
      viewBox="0 0 160 14"
      aria-hidden
      style={{ color: BOOK.gold[0] }}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        filter={BEVEL}
      >
        <path d="M4 7 H 62 M98 7 H 156" />
        <path d="M62 7 q 8 -6 12 0 q -4 6 -12 0 M98 7 q -8 -6 -12 0 q 4 6 12 0" />
        <path d="M80 1 L 86 7 L 80 13 L 74 7 Z" fill="currentColor" />
      </g>
    </svg>
  );
}

/** 満月の金のメダル（表紙の真ん中、絵を丸く収める枠）。 */
export function Medallion(): ReactElement {
  const rays = Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2;
    const r0 = 54;
    const r1 = k % 2 ? 60 : 64;
    return (
      <path
        key={k}
        d={`M${(64 + Math.cos(a) * r0).toFixed(1)} ${(64 + Math.sin(a) * r0).toFixed(1)} L${(64 + Math.cos(a) * r1).toFixed(1)} ${(64 + Math.sin(a) * r1).toFixed(1)}`}
      />
    );
  });
  return (
    <svg
      className="bk-medal-ring"
      viewBox="0 0 128 128"
      aria-hidden
      style={{ color: BOOK.gold[0] }}
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" filter={BEVEL}>
        <circle cx={64} cy={64} r={50} strokeWidth={2} />
        <circle cx={64} cy={64} r={46} strokeWidth={0.8} opacity={0.6} />
        <g strokeWidth={1.4}>{rays}</g>
      </g>
    </svg>
  );
}

// 満月の物語の「本」（2026-11-20 渡辺さんの見本：紺の革の表紙、金の飾り枠、生成りの紙、しおりのリボン）。
// 表紙を開くと紙のページ、そのページの絵の中へ入っていく（動きは src/ui/MoonStory.tsx）。色はここと palette.ts だけ。
import type { CSSProperties, ReactElement } from "react";
import { BOOK } from "./palette";
import { LEATHER, WOOD } from "./textures";

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
    ["--bk-ribbon" as string]: BOOK.ribbon,
    ["--bk-leather" as string]: LEATHER,
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

/** 本棚の i 冊目の背の色。 */
export const spineVar = (i: number): CSSProperties => ({ ["--spine" as string]: BOOK.spines[i % BOOK.spines.length] }) as CSSProperties;

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

/** 金の飾り枠（表紙・紙のページの上に重ねる。幅と高さは viewBox の比で伸びる）。 */
export function GoldFrame({ w = 300, h = 420, inset = 14 }: { w?: number; h?: number; inset?: number }): ReactElement {
  const i = inset;
  return (
    <svg className="bk-frame" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden style={{ color: BOOK.gold[0] }}>
      <g fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
        <rect x={i} y={i} width={w - i * 2} height={h - i * 2} rx={4} />
        <rect x={i + 6} y={i + 6} width={w - i * 2 - 12} height={h - i * 2 - 12} rx={2} opacity={0.55} />
        <Corner t={`translate(${i} ${i})`} />
        <Corner t={`translate(${w - i} ${i}) scale(-1 1)`} />
        <Corner t={`translate(${i} ${h - i}) scale(1 -1)`} />
        <Corner t={`translate(${w - i} ${h - i}) scale(-1 -1)`} />
        {/* 上下の中央の飾り */}
        <path d={`M${w / 2 - 34} ${i} q 17 14 34 0 q 17 14 34 0`} />
        <path d={`M${w / 2 - 34} ${h - i} q 17 -14 34 0 q 17 -14 34 0`} />
        <circle cx={w / 2} cy={i + 8} r={2.4} fill="currentColor" stroke="none" />
        <circle cx={w / 2} cy={h - i - 8} r={2.4} fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

/** 小さな飾りの線（見出しの下など）：― ◆ ―。 */
export function Flourish(): ReactElement {
  return (
    <svg className="bk-flourish" viewBox="0 0 160 14" aria-hidden style={{ color: BOOK.gold[0] }}>
      <g fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
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
    return <path key={k} d={`M${(64 + Math.cos(a) * r0).toFixed(1)} ${(64 + Math.sin(a) * r0).toFixed(1)} L${(64 + Math.cos(a) * r1).toFixed(1)} ${(64 + Math.sin(a) * r1).toFixed(1)}`} />;
  });
  return (
    <svg className="bk-medal-ring" viewBox="0 0 128 128" aria-hidden style={{ color: BOOK.gold[0] }}>
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx={64} cy={64} r={50} strokeWidth={2} />
        <circle cx={64} cy={64} r={46} strokeWidth={0.8} opacity={0.6} />
        <g strokeWidth={1.4}>{rays}</g>
      </g>
    </svg>
  );
}

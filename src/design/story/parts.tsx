// 満月の物語の絵本の、どの満月の場面にも使う部品（11/20 渡辺さん「このクオリティーを横展開」）。
// 場面ごとのファイル（例：BeaverWorld.tsx）は、ここの部品と決まりを使って描く（docs/moon-story.md）。
//   - 絵の大きさは 400×860（縦長のスマホに合わせ、xMidYMid slice で画面を覆う）。
//   - 決まった並びの乱数（開くたびに同じ絵）。
//   - 満月は StoryMoon で描く：data-story-moon（月の組）と data-story-disc（月の円）が、物語の月を今夜の情報の月へ
//     引き継ぐ動き（src/ui/MoonStory.tsx）の目印。月の色・光もここで共通。
// 色はデザインの層（src/design）にだけ書く。
import type { ReactElement } from "react";

/** 場面の絵の大きさ（viewBox）。 */
export const STORY_W = 400;
export const STORY_H = 860;

/** 決まった並びの乱数（開くたびに変わらない）。 */
export function rand(seed: number) {
  let s = seed;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/** 満月の色（どの場面でも同じ月）。 */
export const STORY_MOON = {
  light: "#fff6d8",
  mid: "#f6dc98",
  edge: "#d9b062",
  glow: "#ffe9a8",
} as const;

/** 縦の4色のグラデーション（空など）。 */
export function SkyGradient({
  id,
  c,
}: {
  id: string;
  c: readonly string[];
}): ReactElement {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={c[0]} />
      <stop offset="0.45" stopColor={c[1]} />
      <stop offset="0.7" stopColor={c[2]} />
      <stop offset="1" stopColor={c[3]} />
    </linearGradient>
  );
}

/** 4色のグラデーションを CSS の背景にする（本の窓から場面へつなぐ色）。 */
export const cssSky = (c: readonly string[]) =>
  `linear-gradient(${c[0]}, ${c[1]} 45%, ${c[2]} 70%, ${c[3]})`;

/** 針葉樹（x, 地面 y, 高さ）。 */
export function pine(
  x: number,
  y: number,
  h: number,
  fill: string,
  key: string,
): ReactElement {
  const w = h * 0.42;
  const tiers = 4;
  let d = "";
  for (let i = 0; i < tiers; i++) {
    const top = y - h + (i * h) / (tiers + 0.6);
    const bot = top + h / 2.4;
    const ww = (w * (i + 1.4)) / (tiers + 0.4);
    d += `M${x} ${top} L${x + ww} ${bot} L${x - ww} ${bot} Z `;
  }
  return (
    <path
      key={key}
      d={`${d}M${x - 2} ${y - h * 0.18} h4 v${h * 0.18} h-4 Z`}
      fill={fill}
    />
  );
}

/** 満月の光と円のグラデーション（<defs> の中に置く）。p は場面の接頭（例：bw）。 */
export function MoonDefs({ p }: { p: string }): ReactElement {
  return (
    <>
      <radialGradient id={`${p}-moon-glow`}>
        <stop offset="0" stopColor={STORY_MOON.glow} stopOpacity={0.75} />
        <stop offset="0.35" stopColor={STORY_MOON.glow} stopOpacity={0.22} />
        <stop offset="1" stopColor={STORY_MOON.glow} stopOpacity={0} />
      </radialGradient>
      <radialGradient id={`${p}-moon-disc`} cx="0.4" cy="0.36" r="0.75">
        <stop offset="0" stopColor={STORY_MOON.light} />
        <stop offset="0.7" stopColor={STORY_MOON.mid} />
        <stop offset="1" stopColor={STORY_MOON.edge} />
      </radialGradient>
    </>
  );
}

/**
 * 満月（光・円・海の模様）。at は最初の位置（transform）。動きは場面の側で、`.${p}-moon` を動かす。
 * data-story-moon / data-story-disc は、物語の月を今夜の情報の月へ引き継ぐ目印（一つの場面に一つ）。
 */
export function StoryMoon({
  p,
  at,
  r = 62,
  img,
  tint,
}: {
  p: string;
  at: string;
  r?: number;
  img?: string;
  /** 月の色を変える薄い面の色（不透明度 0 で置き、場面が動かす：`.${p}-moon-tint`）。CSS の filter は iPhone の SVG で効かないので面で。 */
  tint?: string;
}): ReactElement {
  const k = r / 62;
  // 渡辺さんの素材の月の絵があれば、それを円に切って使う（11/20 18:42）。無ければ描いた月。
  if (img)
    return (
      <g className={`${p}-moon`} transform={at} data-story-moon="">
        <circle
          r={190 * k}
          fill={`url(#${p}-moon-glow)`}
          className={`${p}-moon-glow`}
        />
        <clipPath id={`${p}-moon-clip`}>
          <circle r={r} />
        </clipPath>
        <image
          href={img}
          x={-r * 1.06}
          y={-r * 1.06}
          width={r * 2.12}
          height={r * 2.12}
          clipPath={`url(#${p}-moon-clip)`}
          preserveAspectRatio="xMidYMid slice"
        />
        {tint && <circle r={r} fill={tint} opacity={0} className={`${p}-moon-tint`} />}
        <circle r={r} fill="none" data-story-disc="" />
      </g>
    );
  return (
    <g className={`${p}-moon`} transform={at} data-story-moon="">
      <circle
        r={190 * k}
        fill={`url(#${p}-moon-glow)`}
        className={`${p}-moon-glow`}
      />
      <circle r={r} fill={`url(#${p}-moon-disc)`} data-story-disc="" />
      <g fill={STORY_MOON.edge} opacity={0.22} transform={`scale(${k})`}>
        <path d="M-22 -18 c 10 -10 26 -6 28 4 c 2 10 -10 16 -20 12 c -9 -3 -12 -10 -8 -16 z" />
        <path d="M8 10 c 10 -5 20 0 20 8 c 0 8 -10 12 -18 9 c -6 -3 -7 -12 -2 -17 z" />
        <circle cx={24} cy={-24} r={6} />
        <circle cx={-14} cy={26} r={4} />
        <circle cx={-34} cy={6} r={3} />
      </g>
    </g>
  );
}

/** 星（空の上の方に n 個、最初は見えない。場面の側で `.${p}-star` を一つずつ灯す）。 */
export function stars(
  p: string,
  n: number,
  seed: number,
  maxY = 470,
): ReactElement[] {
  const r = rand(seed);
  return Array.from({ length: n }, (_, i) => {
    const x = r() * STORY_W;
    const y = r() * maxY;
    const s = 0.5 + r() * 1.6;
    return (
      <circle
        key={i}
        className={`${p}-star`}
        cx={x}
        cy={y}
        r={s}
        fill="#ffffff"
        opacity={0}
      />
    );
  });
}

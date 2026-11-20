// 満月の物語の本の背と表紙の紋（11/20 18:19 渡辺さんの見本：オオカミ・雪の結晶・芽・花・イチゴ・シカ・チョウザメ・
// トウモロコシ・麦・ビーバー・針葉樹）。金の箔押しのような一色の形（currentColor）。名前の由来の主役を表す。
// ハンターズムーンは狩りを直接描かず、冬への備え（どんぐりと葉）で。ブルームーンはひと月に二つの満月。
import type { CSSProperties, ReactElement } from "react";
import { BEVEL } from "./Book";

const F = { fill: "currentColor" } as const;
const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const EMBLEMS: Record<string, ReactElement> = {
  ウルフムーン: (
    <path
      {...F}
      d="M7 29 L9.5 21 C 8.5 18 9 15 11 13 L 12.5 7.5 L 14.5 11 C 16 10.4 17.4 10.4 18.6 11 L 21.5 6.5 L 21.8 12.2 C 23.6 13.6 24.2 15.8 23.4 18 L 24.6 22.6 L 27 29 L 23.6 29 L 21.8 24 L 17.4 25.2 L 15.6 29 L 12.4 29 L 13.6 24.6 L 11 23 Z"
    />
  ),
  スノームーン: (
    <g {...S}>
      <path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10" />
      <path d="M13 6.5 L16 9.5 L19 6.5 M13 25.5 L16 22.5 L19 25.5 M6.5 14.4 L10.6 13.4 L9.4 9.4 M25.5 17.6 L21.4 18.6 L22.6 22.6 M6.5 17.6 L10.6 18.6 L9.4 22.6 M25.5 14.4 L21.4 13.4 L22.6 9.4" />
    </g>
  ),
  ワームムーン: (
    <g>
      <path {...S} d="M16 28 V15" />
      <path
        {...F}
        d="M16 17 C 11 17 7.5 14 7 9 C 12 9 15.5 11.5 16 17 Z M16 15 C 17 10 20.5 7 25.5 7.4 C 25 12.4 21 15.2 16 15 Z"
      />
      <path {...S} d="M9 28.5 C 12 27 20 27 23 28.5" />
    </g>
  ),
  ピンクムーン: (
    <g {...F}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse
          key={a}
          cx={16}
          cy={9.6}
          rx={4.2}
          ry={6}
          transform={`rotate(${a} 16 16)`}
          opacity={0.92}
        />
      ))}
      <circle
        cx={16}
        cy={16}
        r={2.6}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
    </g>
  ),
  フラワームーン: (
    <g {...F}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <ellipse
          key={a}
          cx={16}
          cy={8.4}
          rx={2.4}
          ry={5.4}
          transform={`rotate(${a} 16 16)`}
        />
      ))}
      <circle
        cx={16}
        cy={16}
        r={3.4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
      />
    </g>
  ),
  ストロベリームーン: (
    <g>
      <path
        {...F}
        d="M16 29 C 9 25 6.5 19.5 7.4 15 C 8.2 11.4 12 10.4 16 11.6 C 20 10.4 23.8 11.4 24.6 15 C 25.5 19.5 23 25 16 29 Z"
      />
      <path
        {...S}
        d="M11 9.5 L16 11.6 L21 9.5 M16 11.6 L16 5.5 M13 10.8 L12 7.5 M19 10.8 L20 7.5"
      />
      <g fill="var(--bk-seed, #0000)">
        {[
          [12, 16],
          [16, 15.4],
          [20, 16],
          [14, 20],
          [18, 20],
          [16, 24],
        ].map(([x, y]) => (
          <ellipse key={`${x}${y}`} cx={x} cy={y} rx={0.8} ry={1.2} />
        ))}
      </g>
    </g>
  ),
  バックムーン: (
    <g>
      <path
        {...S}
        d="M12.5 13 C 10 11 8.5 8 9 4.5 M10.2 9.4 L6.5 8 M9.4 6.4 L6.8 4.4 M19.5 13 C 22 11 23.5 8 23 4.5 M21.8 9.4 L25.5 8 M22.6 6.4 L25.2 4.4"
      />
      <path
        {...F}
        d="M12 13 C 13.5 12 18.5 12 20 13 L 19.4 19 C 19 23 17.6 27 16 28.5 C 14.4 27 13 23 12.6 19 Z M10 14.5 L12.4 15.2 L12.4 17 Z M22 14.5 L19.6 15.2 L19.6 17 Z"
      />
    </g>
  ),
  スタージョンムーン: (
    <g>
      <path
        {...F}
        d="M3.5 17 C 7 13 13 12 19 13 L 24 10.5 L 23.4 13.8 C 25.6 14.6 27.6 15.8 28.6 17 C 27.6 18.2 25.6 19.4 23.4 20.2 L 24 23.5 L 19 21 C 13 22 7 21 3.5 17 Z"
      />
      <path
        {...S}
        d="M8 16.6 L22 15.4 M10 18.6 L21 18"
        stroke="var(--bk-seed, #0000)"
      />
      <circle cx={6.6} cy={16.2} r={0.9} fill="var(--bk-seed, #0000)" />
    </g>
  ),
  コーンムーン: (
    <g>
      <path
        {...F}
        d="M16 4 C 19.5 6.5 20.5 12 19.6 18 C 19 22 17.6 25 16 26.5 C 14.4 25 13 22 12.4 18 C 11.5 12 12.5 6.5 16 4 Z"
      />
      <path
        {...S}
        d="M13 10 H19 M12.6 14 H19.4 M12.6 18 H19.4 M13.4 22 H18.6 M16 5 V26"
        stroke="var(--bk-seed, #0000)"
      />
      <path
        {...S}
        d="M16 28 C 12 25 8.5 20 8 13.5 M16 28 C 20 25 23.5 20 24 13.5"
      />
    </g>
  ),
  ハーベストムーン: (
    <g>
      <path {...S} d="M16 29 V8" />
      {[10, 14, 18, 22].map((y) => (
        <g key={y} {...F}>
          <ellipse
            cx={13.2}
            cy={y}
            rx={1.8}
            ry={3}
            transform={`rotate(-32 13.2 ${y})`}
          />
          <ellipse
            cx={18.8}
            cy={y}
            rx={1.8}
            ry={3}
            transform={`rotate(32 18.8 ${y})`}
          />
        </g>
      ))}
      <ellipse {...F} cx={16} cy={6.4} rx={1.8} ry={3} />
    </g>
  ),
  ハンターズムーン: (
    <g>
      <path
        {...F}
        d="M9 20 C 9 15 12 13 16 13 C 20 13 23 15 23 20 C 23 25 20 28.5 16 29 C 12 28.5 9 25 9 20 Z"
        opacity={0.95}
      />
      <path
        {...F}
        d="M8 14 C 8 10.5 11.5 8.6 16 8.6 C 20.5 8.6 24 10.5 24 14 Z"
      />
      <path {...S} d="M16 8.6 V4.5 C 17.5 3.6 19.5 3.8 20.5 5" />
    </g>
  ),
  ビーバームーン: (
    <g {...F}>
      <path d="M6 24 C 5 18 8.5 13 14 12.4 C 15 9.6 17.6 8 20.4 8.6 C 23.4 9.2 25 12 24 14.8 C 23.4 16.6 21.6 17.4 20 17.2 L 21 24 Z" />
      <circle cx={18.4} cy={9} r={1.4} />
      <ellipse cx={8} cy={26} rx={6} ry={2.4} transform="rotate(-8 8 26)" />
    </g>
  ),
  コールドムーン: (
    <g {...F}>
      {[
        [16, 4, 22],
        [9, 10, 16],
        [23, 10, 16],
      ].map(([x, top, h]) => (
        <path
          key={x}
          d={`M${x} ${top} L${x + h * 0.32} ${top + h * 0.45} L${x + h * 0.16} ${top + h * 0.45} L${x + h * 0.4} ${top + h * 0.85} L${x + 0.6} ${top + h * 0.85} L${x + 0.6} ${top + h} L${x - 0.6} ${top + h} L${x - 0.6} ${top + h * 0.85} L${x - h * 0.4} ${top + h * 0.85} L${x - h * 0.16} ${top + h * 0.45} L${x - h * 0.32} ${top + h * 0.45} Z`}
        />
      ))}
    </g>
  ),
  ブルームーン: (
    <g>
      <circle {...F} cx={12} cy={16} r={6.4} opacity={0.55} />
      <circle {...F} cx={20.5} cy={16} r={6.4} />
    </g>
  ),
};

/** 呼び名の紋（無い呼び名は満月の円）。 */
export function MoonEmblem({
  name,
  className,
}: {
  name: string;
  className?: string;
}): ReactElement {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden>
      <g filter={BEVEL}>
        {EMBLEMS[name] ?? <circle {...F} cx={16} cy={16} r={9} />}
      </g>
    </svg>
  );
}

/** 本の背の下の山並み（金の細い線）。 */
export function SpineHills({
  className,
}: {
  className?: string;
}): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 40 16"
      preserveAspectRatio="none"
      aria-hidden
    >
      <g filter={BEVEL}>
        <path
          {...S}
          strokeWidth={1.1}
          d="M0 14 L7 7 L11 10 L18 3 L25 10 L29 7 L40 14"
        />
        <path
          {...S}
          strokeWidth={0.7}
          opacity={0.6}
          d="M0 15.5 L5 12 L10 14 L16 9 L22 13 L28 10 L34 13 L40 11"
        />
      </g>
    </svg>
  );
}

/** Weather Note の雲の印（本と本棚の飾り）。 */
export function CloudMark({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 40 20" aria-hidden>
      <path
        {...S}
        strokeWidth={1.6}
        filter={BEVEL}
        d="M6 17 H34 C 37 17 38 14.5 37 12.6 C 36 10.6 33.4 10.2 32 11 C 31.6 7 28.4 4.6 24.8 5 C 22.6 2.4 18.6 2 16 4.2 C 13.6 6 13 8.6 13.4 10.6 C 11.4 9.4 8.4 10 7.2 12 C 5 12 3.6 14 4.4 15.6 C 4.8 16.6 5.4 17 6 17 Z"
      />
    </svg>
  );
}

/** 小枝（本棚の飾り板の左右、月桂樹のように）。flip で左右を返す。 */
export function Sprig({
  flip,
  className,
}: {
  flip?: boolean;
  className?: string;
}): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 48 24"
      aria-hidden
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <g filter={BEVEL}>
        <path {...S} strokeWidth={1.2} d="M2 22 C 14 18 28 12 44 4" />
        {[
          [10, 19, -30],
          [17, 16, -38],
          [24, 13, -44],
          [31, 10, -50],
          [38, 7, -56],
        ].map(([x, y, a]) => (
          <g key={x} fill="currentColor">
            <ellipse
              cx={x}
              cy={y - 3}
              rx={1.4}
              ry={3.4}
              transform={`rotate(${a + 70} ${x} ${y - 3})`}
            />
            <ellipse
              cx={x + 1.6}
              cy={y + 2.6}
              rx={1.4}
              ry={3.4}
              transform={`rotate(${a + 140} ${x + 1.6} ${y + 2.6})`}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * 本の背の欧文（11/20 19:52 渡辺さんの見本の背：英語の呼び名を二行、日付と月の英語の略）。背の幅に合わせて縮むよう SVG の字で、
 * 長い語は幅に収める（textLength）。書体は CSS（.sp-latin、物語の欧文の書体）。
 */
export function SpineLatin({
  lines,
  className,
}: {
  lines: string[];
  className?: string;
}): ReactElement {
  const W = 40;
  const fs = 9;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${lines.length * fs * 1.04 + 1.5}`}
      aria-hidden
    >
      <g filter={BEVEL}>
        {lines.map((t, i) => (
          <text
            key={i}
            x={W / 2}
            y={fs * (i + 1) * 1.04 - 1}
            fontSize={fs}
            textAnchor="middle"
            fill="currentColor"
            {...(t.length * fs * 0.5 > W - 4
              ? { textLength: W - 4, lengthAdjust: "spacingAndGlyphs" }
              : {})}
          >
            {t}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** きらめき（四つの光の筋の星。金の飾りや月のそばで小さく瞬かせる。11/20 20:42 渡辺さん「キラッとしたエフェクト」）。 */
export function Glint({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 0 C 12.8 8.6 15.4 11.2 24 12 C 15.4 12.8 12.8 15.4 12 24 C 11.2 15.4 8.6 12.8 0 12 C 8.6 11.2 11.2 8.6 12 0 Z"
      />
    </svg>
  );
}

/**
 * 象徴の言葉の小さな絵（11/20 20:56 渡辺さんの見本：芽・薪・雪の結晶）。言葉ごとに足す（無い言葉は絵なし）。
 * 一色（currentColor）。
 */
const SYMBOL_ICONS: Record<string, ReactElement> = {
  巣作り: (
    <g {...S} strokeWidth={1.7}>
      <path d="M16 28 V16" />
      <path
        d="M16 18 C 10 18 6 14 6 8 C 12 8 16 12 16 18 Z M16 15 C 17 9 21 6 26 6 C 26 12 22 15 16 15 Z"
        fill="currentColor"
        stroke="none"
      />
    </g>
  ),
  貯蔵: (
    <g {...S} strokeWidth={1.5}>
      {[
        [10, 21],
        [21, 21],
        [15.5, 12.5],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <path
            d={`M${x - 7} ${y - 4} H${x + 4} M${x - 7} ${y + 4} H${x + 4}`}
          />
          <ellipse cx={x + 4} cy={y} rx={2.4} ry={4} />
          <ellipse
            cx={x + 4}
            cy={y}
            rx={0.8}
            ry={1.4}
            fill="currentColor"
            stroke="none"
          />
        </g>
      ))}
    </g>
  ),
  冬支度: (
    <g {...S} strokeWidth={1.6}>
      <path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10" />
      <path d="M13 6.5 L16 9.5 L19 6.5 M13 25.5 L16 22.5 L19 25.5 M6.5 14.4 L10.6 13.4 L9.4 9.4 M25.5 17.6 L21.4 18.6 L22.6 22.6 M6.5 17.6 L10.6 18.6 L9.4 22.6 M25.5 14.4 L21.4 13.4 L22.6 9.4" />
    </g>
  ),
};

/** 象徴の言葉の絵（無い言葉は null）。 */
export function SymbolIcon({
  word,
  className,
}: {
  word: string;
  className?: string;
}): ReactElement | null {
  const g = SYMBOL_ICONS[word];
  return g ? (
    <svg className={className} viewBox="0 0 32 32" aria-hidden>
      {g}
    </svg>
  ) : null;
}

/** 紙のページの見出しの下の飾り：細い線と、真ん中に小枝（11/20 20:56 見本）。 */
export function LeafRule({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 200 20" aria-hidden>
      <path {...S} strokeWidth={0.9} d="M6 10 H84 M116 10 H194" />
      <path {...S} strokeWidth={1.2} d="M86 14 C 94 13 104 9 112 4" />
      <path
        fill="currentColor"
        d="M95 12 C 92 6 95 3 99 3 C 100 7 99 10 95 12 Z M103 9 C 104 3 108 1 112 2 C 111 6 108 9 103 9 Z M99 11.5 C 104 15 108 15 111 12 C 107 9 103 9.5 99 11.5 Z"
      />
    </svg>
  );
}

/** 紙のページの四隅の唐草（11/20 21:04 渡辺さんの見本「名前の由来」）。左上の形で、ほかの隅は CSS で返す。 */
export function PaperCorner({
  className,
}: {
  className?: string;
}): ReactElement {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <g {...S} strokeWidth={1.1} filter={BEVEL}>
        <path d="M4 30 C 4 14 14 4 30 4" />
        <path d="M30 4 C 38 4 42 9 39 13 C 36 16 31 14 33 10" />
        <path d="M4 30 C 4 38 9 42 13 39 C 16 36 14 31 10 33" />
        <path
          d="M11 22 C 13 15 16 12 22 11 M17 8 C 20 5 24 6 24 9 M8 17 C 5 20 6 24 9 24"
          strokeWidth={0.8}
        />
        <circle cx={14} cy={14} r={1.6} fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

/** 月の満ち欠けの列（細い月から満月、また細い月へ。真ん中の満月は型押しの月の絵）。 */
export function PhaseRow({
  moon,
  className,
}: {
  moon: string;
  className?: string;
}): ReactElement {
  // 欠けた月：外の円と、ずらした円の差（右が光る → 満月 → 左が光る）。
  const phase = (x: number, r: number, k: number, key: string) => {
    const d = k * r * 1.9;
    return (
      <g key={key}>
        <mask id={`ph-${key}`}>
          <circle cx={x} cy={12} r={r} fill="#ffffff" />
          <circle cx={x + d} cy={12} r={r} fill="#000000" />
        </mask>
        <circle
          cx={x}
          cy={12}
          r={r}
          fill="currentColor"
          mask={`url(#ph-${key})`}
        />
      </g>
    );
  };
  return (
    <svg className={className} viewBox="0 0 160 24" aria-hidden>
      <g filter={BEVEL}>
        {phase(14, 4, -0.82, "a")}
        {phase(34, 5, -0.6, "b")}
        {phase(56, 6, -0.32, "c")}
        {phase(104, 6, 0.32, "d")}
        {phase(126, 5, 0.6, "e")}
        {phase(146, 4, 0.82, "f")}
      </g>
      <image
        href={moon}
        x={69}
        y={-1}
        width={22}
        height={26}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

/** 小さな枯れ枝（金、11/20 21:05 渡辺さん「ゴールドで小さな枯れ枝のモチーフ」）。 */
export function Twig({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 120 28" aria-hidden>
      <g {...S} filter={BEVEL}>
        <path
          strokeWidth={1.8}
          d="M6 20 C 30 16 58 15 84 11 C 96 9 106 8 114 6"
        />
        <path
          strokeWidth={1.2}
          d="M34 16.5 C 38 11 42 8 48 6 M58 14.5 C 62 18 66 21 72 22 M80 11.6 C 84 7 88 4 92 3 M96 9 C 99 11 102 13 106 13"
        />
        <path
          strokeWidth={0.9}
          d="M44 7.5 L 46 3 M68 21 L 70 25 M88 4.4 L 87 1"
        />
      </g>
      <g fill="currentColor" filter={BEVEL}>
        <ellipse cx={48.5} cy={5.6} rx={1.6} ry={1.1} />
        <ellipse cx={92.4} cy={2.8} rx={1.5} ry={1} />
        <ellipse cx={114.5} cy={5.8} rx={1.6} ry={1.1} />
      </g>
    </svg>
  );
}

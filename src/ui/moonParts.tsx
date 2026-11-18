// 月と方位の小さな部品（太陽と月のシート・月のシートで使う）。
import { useId } from "react";
import moonUrl from "../assets/moon.webp";

/** 方位の名前（16方位、北0・東90）。 */
const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
export const dirName = (az: number) => DIRS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];

/**
 * 月の満ち欠けの絵：照らされている割合（輝面比）と、満ちていくか欠けていくか（月齢 14.8 日の前か後か）から。
 * 北半球で見た形（満ちていくときは右が明るい）。
 */
export function MoonGlyph({ phase, size, limb, tint }: { phase: { age: number; illuminated: number }; size: number; limb?: number; tint?: string }) {
  const r = size / 2 - 1;
  const c = size / 2;
  const k = Math.min(1, Math.max(0, phase.illuminated));
  // limb（光っている側の向き、上から反時計回り）があれば、満ちていく形（右が光る＝270°）で描いて回す。
  const waxing = limb !== undefined || phase.age < 14.77;
  const turn = limb !== undefined ? 270 - limb : 0;
  const rx = Math.abs(1 - 2 * k) * r;
  // 明るい側の半円＋明暗の境（楕円の半分）。半分より多く照らされていれば楕円は暗い側へふくらむ。
  const side = waxing ? 1 : 0;
  const bulge = waxing ? (k > 0.5 ? 1 : 0) : k > 0.5 ? 0 : 1;
  const d = `M${c},${c - r} A${r},${r} 0 0 ${side} ${c},${c + r} A${rx},${r} 0 0 ${bulge} ${c},${c - r} Z`;
  const id = useId();
  // 月の絵（渡辺さんの絵、2026-11-19）：照らされた側は絵そのまま、影の側は同じ絵を暗く（地球照のように模様がうっすら）。
  // tint（高さの色）があれば、絵の色みを抜いてその色を掛ける。
  return (
    <svg className="moon-glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <defs>
        <clipPath id={`${id}lit`}>
          <path d={d} transform={turn ? `rotate(${turn.toFixed(1)} ${c} ${c})` : undefined} />
        </clipPath>
        {tint && (
          <filter id={`${id}tint`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0.15" result="grey" />
            <feFlood floodColor={tint} result="col" />
            <feBlend in="grey" in2="col" mode="multiply" result="mix" />
            <feComposite in="mix" in2="SourceAlpha" operator="in" />
          </filter>
        )}
      </defs>
      <circle cx={c} cy={c} r={r} className="moon-dark" />
      <g filter={tint ? `url(#${id}tint)` : undefined}>
        <image href={moonUrl} x={c - r} y={c - r} width={2 * r} height={2 * r} className="moon-shade" />
        <image href={moonUrl} x={c - r} y={c - r} width={2 * r} height={2 * r} clipPath={`url(#${id}lit)`} />
      </g>
    </svg>
  );
}

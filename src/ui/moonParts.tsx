// 月と方位の小さな部品（太陽と月のシート・月のシートで使う）。
import { ICON } from "../design/tokens";

/** 方位の名前（16方位、北0・東90）。 */
const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
export const dirName = (az: number) => DIRS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];

/**
 * 月の満ち欠けの絵：照らされている割合（輝面比）と、満ちていくか欠けていくか（月齢 14.8 日の前か後か）から。
 * 北半球で見た形（満ちていくときは右が明るい）。
 */
export function MoonGlyph({ phase, size }: { phase: { age: number; illuminated: number }; size: number }) {
  const r = size / 2 - 1;
  const c = size / 2;
  const k = Math.min(1, Math.max(0, phase.illuminated));
  const waxing = phase.age < 14.77;
  const rx = Math.abs(1 - 2 * k) * r;
  // 明るい側の半円＋明暗の境（楕円の半分）。半分より多く照らされていれば楕円は暗い側へふくらむ。
  const side = waxing ? 1 : 0;
  const bulge = waxing ? (k > 0.5 ? 1 : 0) : k > 0.5 ? 0 : 1;
  const d = `M${c},${c - r} A${r},${r} 0 0 ${side} ${c},${c + r} A${rx},${r} 0 0 ${bulge} ${c},${c - r} Z`;
  return (
    <svg className="moon-glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={c} cy={c} r={r} className="moon-dark" />
      <path d={d} className="moon-lit" style={{ fill: ICON.moon }} />
    </svg>
  );
}


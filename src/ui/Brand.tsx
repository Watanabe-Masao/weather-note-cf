// 見出しのロゴ（2026-11-18 渡辺さん）：使っているテーマの色のアイコンと、円弧と一点の上に乗った「Weather Note」。
// 絵は src/design/brand.ts（ホーム画面のアイコンと同じ形）。テーマを替えるとアプリが描き直されるので、ここも替わる。
import { brandIconSvg, WORDMARK } from "../design/brand";
import { currentTheme } from "../design/tokens";

export function Brand() {
  return (
    <h1 className="brand" aria-label="Weather Note">
      <span className="brand-icon" aria-hidden dangerouslySetInnerHTML={{ __html: brandIconSvg(currentTheme(), { rx: 112, id: "wn-head" }) }} />
      <svg className="brand-word" viewBox={WORDMARK.viewBox} aria-hidden>
        <path d={WORDMARK.arc} fill="none" stroke="currentColor" strokeWidth={WORDMARK.stroke} strokeLinecap="round" />
        <circle cx={WORDMARK.dot.cx} cy={WORDMARK.dot.cy} r={WORDMARK.dot.r} fill="currentColor" />
        <path d={WORDMARK.text} fill="currentColor" />
      </svg>
    </h1>
  );
}

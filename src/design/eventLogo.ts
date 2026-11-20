// 空のイベントの日のロゴ（2026-11-20 渡辺さんの案「満月イベント用アイコン」「日食・月食系イベントロゴ」）：その日だけ、
// 見出しのロゴを横長の帯の絵にする（アイコンと文字をまとめて1枚）。満月は月ごとの絵（呼び名にちなむ）、日食・月食は
// 食の形。色はテーマごと（地と丘は Brand と同じ組）。文字は今のロゴと同じ「Weather Note」の線（WORDMARK）。
// 読み込みの無い文字列で返す（Brand と同じ）。448×100 の帯（見出しでは高さ 36px ほど）。
import { BRAND, type BrandTheme, WORDMARK } from "./brand";
import type { SkyEventKind } from "../../shared/skyEvents";

const INK: Record<BrandTheme, string> = { navy: "#eef3ff", mist: "#26382c", warm: "#243448" };
const SIL: Record<BrandTheme, string> = { navy: "#0b1a3a", mist: "#2f4a3a", warm: "#2c3e57" };

/** 月ごとの絵（呼び名から）。x 6〜120・y 40〜100 のあたりに、月の前と丘の上に置く。 */
const MOTIFS: Record<string, (sil: string) => string> = {
  // 遠吠えする狼（座って鼻先を上へ）
  ウルフムーン: (s) => `<g transform="translate(18 44) scale(0.27)" fill="${s}"><path d="M20 200 C 22 170 30 140 52 112 C 60 96 66 84 70 74 L 76 44 L 84 26 L 92 46 L 100 42 L 136 6 L 146 12 L 150 20 L 122 50 C 114 60 110 70 112 82 C 120 100 126 120 128 150 L 130 200 Z"/><path d="M24 196 C 6 196 -6 186 -10 172 C 4 180 14 182 26 180 Z"/></g>`,
  // 雪の木
  スノームーン: (s) => `<g fill="${s}"><path d="M30 92 L48 58 L66 92 Z"/><path d="M34 74 L48 46 L62 74 Z"/><rect x="45" y="90" width="6" height="8"/></g><g fill="#ffffff" opacity=".9"><path d="M38 72 L48 52 L58 72 Q48 66 38 72 Z"/><path d="M34 90 L48 64 L62 90 Q48 84 34 90 Z" opacity=".7"/></g>`,
  // 芽吹き
  ワームムーン: () => `<path d="M48 96 C 48 84 48 76 50 66" stroke="#4f8a3c" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M50 70 C 40 56 26 58 22 64 C 30 72 42 74 50 70 Z" fill="#6fb04f"/><path d="M50 66 C 58 50 74 50 78 56 C 72 66 60 70 50 66 Z" fill="#86c25e"/>`,
  // 桜の枝
  ピンクムーン: () => `${branch()}${blossom(36, 74, 0.8, "#f7b6c8", "#e06a8c")}${blossom(70, 62, 0.65, "#f7b6c8", "#e06a8c")}${blossom(96, 70, 0.5, "#f7b6c8", "#e06a8c")}`,
  // 白い花と葉
  フラワームーン: () => `<path d="M30 80 C 20 70 22 58 34 60 C 40 66 38 76 30 80 Z" fill="#5f9a4a"/><path d="M84 84 C 96 76 98 64 86 64 C 80 70 80 80 84 84 Z" fill="#5f9a4a"/>${blossom(58, 72, 1, "#ffffff", "#f2c94c")}`,
  // 苺
  ストロベリームーン: () => `${berry(40, 76)}${berry(66, 80)}<path d="M84 70 C 92 62 100 64 102 70 C 96 74 90 74 84 70 Z" fill="#5f9a4a"/>`,
  // 雄鹿（角つき）
  バックムーン: (s) => `<g fill="${s}"><path d="M30 98 L32 80 C 30 72 34 66 42 64 L70 62 C 76 62 80 58 82 52 L86 46 L92 50 L90 58 C 88 64 84 68 80 70 L80 98 L74 98 L72 76 L46 78 L44 98 Z"/></g><g stroke="${s}" stroke-width="3" fill="none" stroke-linecap="round"><path d="M86 46 C 84 36 86 28 92 22 M86 38 L78 30 M88 30 L96 24"/><path d="M90 48 C 94 40 100 34 106 32 M96 38 L104 40"/></g>`,
  // 跳ねるチョウザメ
  スタージョンムーン: (s) => `<path d="M24 76 C 40 54 72 50 96 62 L108 54 L106 70 L96 66 C 74 74 50 78 30 84 Z" fill="${s}"/><path d="M16 92 C 26 84 40 84 50 92" stroke="#8fc3e8" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="90" cy="88" r="3" fill="#8fc3e8"/>`,
  // トウモロコシ
  コーンムーン: () => `<path d="M50 96 C 44 80 46 62 56 50 C 66 62 66 80 60 96 Z" fill="#f2c94c"/><g fill="#d9a92c"><circle cx="54" cy="64" r="2.4"/><circle cx="58" cy="72" r="2.4"/><circle cx="54" cy="80" r="2.4"/></g><path d="M50 96 C 36 84 32 70 38 58 C 44 72 48 84 54 92 Z" fill="#6fa34f"/><path d="M60 96 C 74 84 78 70 72 58 C 66 72 62 84 56 92 Z" fill="#5f9a4a"/>`,
  // すすき
  ハーベストムーン: () => [24, 44, 64, 84].map((x, i) => `<path d="M${x} 98 C ${x + 6} 80 ${x + 10} 64 ${x + 20 - i * 2} 48" stroke="#c9a24f" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M${x + 20 - i * 2} 48 C ${x + 26 - i * 2} 56 ${x + 26 - i * 2} 64 ${x + 18 - i * 2} 68" stroke="#e6c77a" stroke-width="5" fill="none" stroke-linecap="round"/>`).join(""),
  // 紅葉
  ハンターズムーン: () => `${maple(42, 70, 1, "#d9532b")}${maple(78, 62, 0.75, "#e9792f")}${maple(98, 84, 0.6, "#c8432a")}`,
  // ビーバーと枝
  ビーバームーン: (s) => `<g fill="${s}"><ellipse cx="46" cy="84" rx="22" ry="14"/><circle cx="66" cy="72" r="10"/><circle cx="62" cy="64" r="3"/><ellipse cx="22" cy="92" rx="14" ry="5" transform="rotate(-18 22 92)"/></g><g stroke="#8a5a2b" stroke-width="4" stroke-linecap="round"><line x1="78" y1="94" x2="112" y2="82"/><line x1="82" y1="82" x2="114" y2="94"/><line x1="88" y1="90" x2="106" y2="76"/></g>`,
  // 雪の結晶と木
  コールドムーン: (s) => `${flake(36, 66, 12)}<g fill="${s}"><path d="M84 96 L94 74 L104 96 Z"/><path d="M98 96 L106 80 L114 96 Z" opacity=".8"/></g>`,
};

function branch(): string {
  return `<path d="M0 96 C 24 88 44 80 70 64 C 84 56 96 54 108 56" stroke="#6b4030" stroke-width="4" fill="none" stroke-linecap="round"/>`;
}
function blossom(x: number, y: number, s: number, petal: string, core: string): string {
  let p = "";
  for (let i = 0; i < 5; i++) {
    const a = ((i * 72 - 90) * Math.PI) / 180;
    const px = (x + Math.cos(a) * 7 * s).toFixed(1);
    const py = (y + Math.sin(a) * 7 * s).toFixed(1);
    p += `<ellipse cx="${px}" cy="${py}" rx="${(6 * s).toFixed(1)}" ry="${(7.5 * s).toFixed(1)}" transform="rotate(${i * 72} ${px} ${py})" fill="${petal}"/>`;
  }
  return `${p}<circle cx="${x}" cy="${y}" r="${(3.2 * s).toFixed(1)}" fill="${core}"/>`;
}
function berry(x: number, y: number): string {
  return `<path d="M${x - 10} ${y - 6} C ${x - 12} ${y + 6} ${x - 4} ${y + 16} ${x} ${y + 18} C ${x + 4} ${y + 16} ${x + 12} ${y + 6} ${x + 10} ${y - 6} Z" fill="#d93a3a"/><path d="M${x - 9} ${y - 7} L${x - 4} ${y - 12} L${x} ${y - 7} L${x + 4} ${y - 12} L${x + 9} ${y - 7} Z" fill="#4f8a3c"/><g fill="#ffd9a0"><circle cx="${x - 4}" cy="${y}" r="1"/><circle cx="${x + 4}" cy="${y + 2}" r="1"/><circle cx="${x}" cy="${y + 8}" r="1"/></g>`;
}
function maple(x: number, y: number, s: number, c: string): string {
  const pts = [0, -16, 4, -6, 14, -10, 9, -1, 16, 4, 6, 4, 6, 14, 0, 7, -6, 14, -6, 4, -16, 4, -9, -1, -14, -10, -4, -6];
  let d = "";
  for (let i = 0; i < pts.length; i += 2) d += `${i ? "L" : "M"}${(x + pts[i] * s).toFixed(1)} ${(y + pts[i + 1] * s).toFixed(1)} `;
  return `<path d="${d}Z" fill="${c}"/><line x1="${x}" y1="${y + 7 * s}" x2="${x}" y2="${y + 16 * s}" stroke="${c}" stroke-width="${2 * s}"/>`;
}
function flake(x: number, y: number, r: number): string {
  let p = "";
  for (let i = 0; i < 3; i++) {
    const a = (i * 60 * Math.PI) / 180;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    p += `<line x1="${(x - dx).toFixed(1)}" y1="${(y - dy).toFixed(1)}" x2="${(x + dx).toFixed(1)}" y2="${(y + dy).toFixed(1)}"/>`;
  }
  return `<g stroke="#e8f2ff" stroke-width="3" stroke-linecap="round">${p}</g>`;
}

/** 空の天体（満月・月食・日食）。真ん中 (cx, cy)、半径 r。 */
function body(kind: SkyEventKind, id: string, blue: boolean, cx: number, cy: number, r: number): string {
  const glow = (c: string, o = 0.5) => `<radialGradient id="${id}-g"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient><circle cx="${cx}" cy="${cy}" r="${r * 1.9}" fill="url(#${id}-g)"/>`;
  const disc = (a: string, b: string) => `<radialGradient id="${id}-m" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-m)"/>`;
  const craters = `<g fill="#000" opacity=".07"><circle cx="${cx - 8}" cy="${cy - 6}" r="${r * 0.2}"/><circle cx="${cx + 8}" cy="${cy + 6}" r="${r * 0.14}"/><circle cx="${cx - 2}" cy="${cy + 10}" r="${r * 0.1}"/></g>`;
  switch (kind) {
    case "full":
      return blue ? `${glow("#bcd8ff")}${disc("#eef5ff", "#9cc3f2")}${craters}` : `${glow("#fff1b8")}${disc("#fff6d2", "#f0d88e")}${craters}`;
    case "lunar-total":
      return `${glow("#d0583a", 0.45)}${disc("#e0764f", "#8e2f20")}${craters}`;
    case "lunar-partial":
      return `${glow("#fff1b8", 0.35)}${disc("#f3ead0", "#cdbf98")}${craters}<clipPath id="${id}-cl"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><circle cx="${cx + r * 0.7}" cy="${cy - r * 0.2}" r="${r * 1.05}" fill="#4a2a24" opacity=".8" clip-path="url(#${id}-cl)"/>`;
    case "lunar-penumbral":
      return `${glow("#fff1b8", 0.3)}${disc("#f1ead6", "#bfb497")}${craters}<radialGradient id="${id}-p" cx="1" cy=".5" r="1"><stop offset="0" stop-color="#1a1f33" stop-opacity=".55"/><stop offset="1" stop-color="#1a1f33" stop-opacity="0"/></radialGradient><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-p)"/>`;
    // 日食の月は黒く塗らない（11/20 渡辺さん「背景色に若干溶け込むように」）：月の所は帯の空（地の色）のまま、皆既だけ少し暗く。
    case "solar-annular":
      return `<mask id="${id}-mk"><rect width="448" height="100" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${r * 0.86}" fill="#000"/></mask><g mask="url(#${id}-mk)">${glow("#ffb347", 0.6)}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffcf5a"/></g>`;
    case "solar-total":
      return `${glow("#e8f2ff", 0.75)}<circle cx="${cx}" cy="${cy}" r="${r * 1.06}" fill="#ffffff" opacity=".85"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-bg)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#000" opacity=".2"/>`;
    case "solar-partial":
      return `${glow("#ffd27a", 0.5)}<mask id="${id}-mk"><rect width="448" height="100" fill="#fff"/><circle cx="${cx + r * 0.55}" cy="${cy - r * 0.15}" r="${r * 0.95}" fill="#000"/></mask><g mask="url(#${id}-mk)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffcf4d"/></g>`;
  }
}

/** 帯のロゴの SVG（448×100）。name は満月の呼び名（月ごとの絵）。 */
export function eventBannerSvg(theme: BrandTheme, kind: SkyEventKind, name: string | null, blue: boolean, id = "wn-ev"): string {
  const c = BRAND[theme];
  const ink = INK[theme];
  const motif = kind === "full" ? (blue ? cloud() : (MOTIFS[name ?? ""]?.(SIL[theme]) ?? "")) : cloud();
  // 月（太陽）は絵の後ろに：影の絵が月の明るさの上に乗って、紺の地でも形が読める。
  const cx = 66;
  const cy = 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 100" width="448" height="100"><defs>
<clipPath id="${id}-c"><rect x="1" y="1" width="446" height="98" rx="49"/></clipPath>
<linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bg[0]}"/><stop offset="1" stop-color="${c.bg[1]}"/></linearGradient>
<linearGradient id="${id}-h1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.hill1[0]}"/><stop offset="1" stop-color="${c.hill1[1]}"/></linearGradient>
<linearGradient id="${id}-h2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.hill2[0]}"/><stop offset="1" stop-color="${c.hill2[1]}"/></linearGradient>
</defs><g clip-path="url(#${id}-c)">
<rect width="448" height="100" fill="url(#${id}-bg)"/>
<g fill="${theme === "navy" ? "#ffffff" : c.dot}" opacity=".8"><path d="M412 20 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/><circle cx="20" cy="22" r="2"/><circle cx="140" cy="16" r="1.6"/></g>
${body(kind, id, blue, cx, cy, 31)}
<path d="M0 84 C 70 70 140 76 210 72 C 290 66 360 60 448 70 L448 100 L0 100 Z" fill="url(#${id}-h1)"/>
${motif}
<path d="M0 94 C 90 82 190 84 280 88 C 350 91 400 86 448 82 L448 100 L0 100 Z" fill="url(#${id}-h2)"/>
<g transform="translate(150 76) scale(0.39)" fill="${ink}"><path d="${WORDMARK.arc}" fill="none" stroke="${ink}" stroke-width="${WORDMARK.stroke}" stroke-linecap="round"/><circle cx="${WORDMARK.dot.cx}" cy="${WORDMARK.dot.cy}" r="${WORDMARK.dot.r}"/><path d="${WORDMARK.text}"/></g>
</g><rect x="1" y="1" width="446" height="98" rx="49" fill="none" stroke="${ink}" stroke-opacity=".18" stroke-width="2"/></svg>`;
}

function cloud(): string {
  return `<path d="M16 96 C 14 86 24 80 32 84 C 36 74 52 74 56 84 C 66 82 72 90 68 96 Z" fill="#ffffff" opacity=".55"/><path d="M90 96 C 90 90 98 86 104 90 C 108 84 118 86 118 94 Z" fill="#ffffff" opacity=".4"/>`;
}

/** 説明の舞台の光の色（11/20「演出・特別感」）：月・食の色に合わせる（上の body() と同じ色）。 */
export function eventGlow(kind: SkyEventKind, blue: boolean): string {
  if (kind === "lunar-total") return "#e0764f";
  if (kind.startsWith("solar")) return "#ffd27a";
  return blue ? "#cfe3ff" : "#fff1b8";
}

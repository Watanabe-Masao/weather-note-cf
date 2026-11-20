// イベントの日の見出しの絵のうち、まだ渡辺さんの絵が無い種類（コーンムーン・月食3・日食3）を、コードで描いて元の画像にする
// （2026-11-20 渡辺さん「無いのは作って置いてください」、docs/event-banner.md の案 A）。640×160・文字なし（アプリが右に
// 「Weather Note」を重ねる、台帳の text: "overlay"）。左の 4割に主役、右の 6割は文字が読める落ち着いた地。
// 日食の月は黒く塗らず、空になじませる（11/20 渡辺さん「背景色に若干溶け込むように」）。
// 渡辺さんの絵が届いたら、その種類は design-src/event/<種類>-<テーマ>.png を置き換え、ここからは外す（E-01）。
//
//   node scripts/event-art-drawn.ts        → design-src/event/<種類>-<テーマ>.png（PNG は Playwright の Chromium で描く）
//   node scripts/event-images.ts <種類>    → public/event/<種類>-<テーマ>.webp

import { createRequire } from "node:module";
type T = "navy" | "warm" | "mist";
const W = 640, H = 160;
const PAL: Record<T, { sky: [string, string, string]; far: [string, string]; mid: [string, string]; near: [string, string]; sil: string; star: string; ink: string; haze: string; night: boolean }> = {
  navy: { sky: ["#0b1d46", "#0a1838", "#061024"], far: ["#2c4a86", "#1f3a70"], mid: ["#1d3566", "#152a52"], near: ["#0f2148", "#0a1838"], sil: "#050d22", star: "#ffffff", ink: "#f3efe2", haze: "#6f8fd0", night: true },
  warm: { sky: ["#fbf8f1", "#f6f0e3", "#efe6d3"], far: ["#d6dde6", "#c4cfdc"], mid: ["#c2cbd6", "#aebccb"], near: ["#9fb0c2", "#8ea2b8"], sil: "#2c3a4d", star: "#9aa9bf", ink: "#243448", haze: "#ffffff", night: false },
  mist: { sky: ["#f1f6ef", "#e6efe3", "#d9e6d5"], far: ["#c3d6c2", "#b2c9b1"], mid: ["#a5c0a5", "#93b294"], near: ["#7fa283", "#6d9373"], sil: "#25402f", star: "#8fae93", ink: "#20382a", haze: "#ffffff", night: false },
};

const CX = 104, CY = 66, R = 40;

function stars(t: T, n = 14, seed = 7): string {
  const p = PAL[t];
  let s = seed, out = "";
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const x = 10 + rnd() * 620, y = 8 + rnd() * 70, r = 0.6 + rnd() * 1.3;
    if (Math.hypot(x - CX, y - CY) < R * 1.8) continue;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${p.star}" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
  }
  const sp = (x: number, y: number, k: number) => `<path d="M${x} ${y - 7 * k} L${x + 1.6 * k} ${y - 1.6 * k} L${x + 7 * k} ${y} L${x + 1.6 * k} ${y + 1.6 * k} L${x} ${y + 7 * k} L${x - 1.6 * k} ${y + 1.6 * k} L${x - 7 * k} ${y} L${x - 1.6 * k} ${y - 1.6 * k} Z" fill="${p.star}" opacity=".85"/>`;
  return out + sp(604, 26, 1) + sp(206, 22, 0.6);
}

function land(id: string, t: T): string {
  const p = PAL[t];
  return `<linearGradient id="${id}-f" x1="0" x2="1"><stop offset="0" stop-color="${p.far[0]}"/><stop offset="1" stop-color="${p.far[1]}"/></linearGradient>
<linearGradient id="${id}-m" x1="0" x2="1"><stop offset="0" stop-color="${p.mid[0]}"/><stop offset="1" stop-color="${p.mid[1]}"/></linearGradient>
<linearGradient id="${id}-n" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${p.near[0]}"/><stop offset="1" stop-color="${p.near[1]}"/></linearGradient>
<linearGradient id="${id}-hz" x1="0" x2="1"><stop offset="0" stop-color="${p.haze}" stop-opacity="0"/><stop offset=".5" stop-color="${p.haze}" stop-opacity="${p.night ? 0.18 : 0.55}"/><stop offset="1" stop-color="${p.haze}" stop-opacity="0"/></linearGradient>
<path d="M0 124 L40 112 L74 118 L120 104 L168 116 L214 106 L262 118 L310 108 L360 120 L410 110 L460 118 L512 106 L560 116 L604 108 L640 114 L640 160 L0 160 Z" fill="url(#${id}-f)" opacity=".85"/>
<rect x="0" y="112" width="${W}" height="16" fill="url(#${id}-hz)"/>
<path d="M0 134 C 90 120 180 128 280 126 C 380 124 470 116 560 122 C 600 125 622 128 640 126 L640 160 L0 160 Z" fill="url(#${id}-m)"/>
<path d="M0 148 C 120 138 240 142 360 146 C 460 149 560 142 640 138 L640 160 L0 160 Z" fill="url(#${id}-n)"/>`;
}

function moonDisc(id: string, a: string, b: string, cr = "#b89a52"): string {
  return `<radialGradient id="${id}-md" cx=".38" cy=".34" r=".8"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#${id}-md)"/>
<g fill="${cr}" opacity=".18"><path d="M${CX - 18} ${CY - 14} c 8 -8 19 -5 21 3 c 2 8 -8 13 -16 10 c -7 -2 -9 -8 -5 -13z"/><path d="M${CX + 6} ${CY + 6} c 8 -4 16 0 16 7 c 0 7 -9 11 -16 8 c -6 -3 -5 -11 0 -15z"/><circle cx="${CX + 14}" cy="${CY - 16}" r="4.5"/><circle cx="${CX - 10}" cy="${CY + 18}" r="3.4"/><circle cx="${CX - 24}" cy="${CY + 6}" r="2.6"/></g>`;
}
const glow = (id: string, c: string, o: number, k = 2.4) => `<radialGradient id="${id}-gl"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/><stop offset=".5" stop-color="${c}" stop-opacity="${o * 0.3}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient><circle cx="${CX}" cy="${CY}" r="${R * k}" fill="url(#${id}-gl)"/>`;

function pines(c: string, list: number[][]): string {
  return list.map(([x, y, k]) => `<path d="M${x} ${y - 34 * k} L${x + 7 * k} ${y - 22 * k} L${x + 4 * k} ${y - 22 * k} L${x + 10 * k} ${y - 11 * k} L${x + 6 * k} ${y - 11 * k} L${x + 13 * k} ${y} L${x - 13 * k} ${y} L${x - 6 * k} ${y - 11 * k} L${x - 10 * k} ${y - 11 * k} L${x - 4 * k} ${y - 22 * k} L${x - 7 * k} ${y - 22 * k} Z" fill="${c}"/>`).join("");
}
/** 望遠鏡をのぞく人（月食）。 */
function watcher(c: string, x: number, y: number): string {
  return `<g fill="${c}"><circle cx="${x}" cy="${y - 30}" r="5"/><path d="M${x - 6} ${y} L${x - 5} ${y - 16} C ${x - 6} ${y - 24} ${x - 2} ${y - 26} ${x + 2} ${y - 25} L${x + 6} ${y - 18} L${x + 5} ${y} Z"/></g><g stroke="${c}" stroke-width="2.2" stroke-linecap="round"><line x1="${x + 4}" y1="${y - 29}" x2="${x + 26}" y2="${y - 42}"/><line x1="${x + 16}" y1="${y - 34}" x2="${x + 12}" y2="${y}"/><line x1="${x + 16}" y1="${y - 34}" x2="${x + 24}" y2="${y}"/></g><rect x="${x + 6}" y="${y - 46}" width="22" height="6" rx="3" transform="rotate(-30 ${x + 17} ${y - 43})" fill="${c}"/>`;
}
/** 日食めがねで見上げる二人（日食）。 */
function lookers(c: string, x: number, y: number): string {
  const one = (x: number, k: number) => `<g fill="${c}"><circle cx="${x}" cy="${y - 32 * k}" r="${5.4 * k}"/><path d="M${x - 7 * k} ${y} L${x - 6 * k} ${y - 18 * k} C ${x - 7 * k} ${y - 26 * k} ${x + 7 * k} ${y - 26 * k} ${x + 6 * k} ${y - 18 * k} L${x + 7 * k} ${y} Z"/></g><path d="M${x + 1 * k} ${y - 24 * k} L${x + 8 * k} ${y - 36 * k}" stroke="${c}" stroke-width="${2.4 * k}" stroke-linecap="round"/><rect x="${x - 2 * k}" y="${y - 40 * k}" width="${10 * k}" height="${4 * k}" rx="${1.2 * k}" fill="${c}" transform="rotate(-35 ${x + 3 * k} ${y - 38 * k})"/>`;
  return one(x, 1) + one(x + 24, 0.85);
}
/** トウモロコシの畑。 */
function corn(t: T): string {
  const p = PAL[t];
  const leaf = t === "navy" ? "#2f5a3a" : t === "warm" ? "#7a9a52" : "#5f8a5c";
  const leaf2 = t === "navy" ? "#24492f" : t === "warm" ? "#6a8a46" : "#507c4f";
  const ear = t === "navy" ? "#d9b54a" : "#e3bf55";
  let out = "";
  for (const [x, k] of [[30, 1], [62, 0.85], [150, 0.95], [178, 0.75]] as const) {
    const top = 150 - 92 * k;
    out += `<path d="M${x} 152 C ${x + 2} ${150 - 40 * k} ${x - 2} ${150 - 70 * k} ${x + 3} ${top}" stroke="${leaf2}" stroke-width="${3 * k}" fill="none" stroke-linecap="round"/>`;
    out += `<path d="M${x + 1} ${150 - 30 * k} C ${x + 22 * k} ${150 - 46 * k} ${x + 36 * k} ${150 - 40 * k} ${x + 44 * k} ${150 - 30 * k} C ${x + 30 * k} ${150 - 36 * k} ${x + 16 * k} ${150 - 34 * k} ${x + 1} ${150 - 26 * k} Z" fill="${leaf}"/>`;
    out += `<path d="M${x} ${150 - 48 * k} C ${x - 20 * k} ${150 - 66 * k} ${x - 34 * k} ${150 - 60 * k} ${x - 40 * k} ${150 - 50 * k} C ${x - 26 * k} ${150 - 56 * k} ${x - 12 * k} ${150 - 52 * k} ${x} ${150 - 44 * k} Z" fill="${leaf2}"/>`;
    out += `<path d="M${x + 1} ${150 - 64 * k} C ${x + 18 * k} ${150 - 84 * k} ${x + 30 * k} ${150 - 82 * k} ${x + 34 * k} ${150 - 74 * k} C ${x + 22 * k} ${150 - 76 * k} ${x + 12 * k} ${150 - 72 * k} ${x + 1} ${150 - 60 * k} Z" fill="${leaf}"/>`;
    out += `<ellipse cx="${x + 7 * k}" cy="${150 - 50 * k}" rx="${4.6 * k}" ry="${11 * k}" transform="rotate(18 ${x + 7 * k} ${150 - 50 * k})" fill="${ear}"/><path d="M${x + 3 * k} ${150 - 40 * k} C ${x + 10 * k} ${150 - 44 * k} ${x + 14 * k} ${150 - 52 * k} ${x + 12 * k} ${150 - 60 * k}" stroke="${leaf}" stroke-width="${2 * k}" fill="none"/>`;
    out += `<path d="M${x + 3} ${top} l -4 -8 M${x + 3} ${top} l 4 -9 M${x + 3} ${top} l 0 -10" stroke="${ear}" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  return out + `<g fill="${p.sil}" opacity=".0"></g>`;
}

function body(kind: string, id: string, t: T): string {
  const p = PAL[t];
  switch (kind) {
    case "corn":
      return glow(id, "#fff1bd", p.night ? 0.6 : 0.5) + moonDisc(id, "#fffbe6", "#f1d98f");
    case "lunar-total":
      return glow(id, "#c9502f", p.night ? 0.55 : 0.4) + moonDisc(id, "#e58a5d", "#8a2c1d", "#3a0e08") + `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#ffb08a" stroke-opacity=".35" stroke-width="1.5"/>`;
    case "lunar-partial":
      return glow(id, "#fff1bd", p.night ? 0.45 : 0.35) + moonDisc(id, "#fffbe6", "#efd894") + `<clipPath id="${id}-cl"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath><g clip-path="url(#${id}-cl)"><radialGradient id="${id}-um" cx=".35" cy=".5" r=".6"><stop offset=".85" stop-color="#5a1f16" stop-opacity=".92"/><stop offset="1" stop-color="#9a3f26" stop-opacity=".6"/></radialGradient><circle cx="${CX + R * 0.95}" cy="${CY - R * 0.35}" r="${R * 1.15}" fill="url(#${id}-um)"/></g>`;
    case "lunar-penumbral":
      return glow(id, "#fff1bd", p.night ? 0.4 : 0.3) + moonDisc(id, "#fbf4dc", "#ddc98e") + `<linearGradient id="${id}-pn" x1="1" x2="0"><stop offset="0" stop-color="#2a2430" stop-opacity=".55"/><stop offset=".6" stop-color="#2a2430" stop-opacity=".12"/><stop offset="1" stop-color="#2a2430" stop-opacity="0"/></linearGradient><circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#${id}-pn)"/>`;
    case "solar-total": {
      // 月は黒く塗らない（11/20 渡辺さん「背景色に若干溶け込むように」）：暗くなった空と同じ地を、少しだけ暗く。
      let rays = "";
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + 0.2, l = R * (1.5 + ((i * 7) % 5) * 0.18);
        rays += `<path d="M${(CX + Math.cos(a - 0.08) * R).toFixed(1)} ${(CY + Math.sin(a - 0.08) * R).toFixed(1)} L${(CX + Math.cos(a) * l).toFixed(1)} ${(CY + Math.sin(a) * l).toFixed(1)} L${(CX + Math.cos(a + 0.08) * R).toFixed(1)} ${(CY + Math.sin(a + 0.08) * R).toFixed(1)} Z" fill="#ffffff" opacity=".35"/>`;
      }
      return glow(id, "#eaf2ff", 0.9, 2.2) + rays + `<circle cx="${CX}" cy="${CY}" r="${R * 1.04}" fill="#ffffff" opacity=".9"/><circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#${id}-sky)"/><circle cx="${CX}" cy="${CY}" r="${R}" fill="${PAL[t].sil}" opacity="${t === "navy" ? 0.25 : 0.22}"/><circle cx="${CX + R * 0.72}" cy="${CY - R * 0.7}" r="3.2" fill="#ffffff"/><circle cx="${CX + R * 0.72}" cy="${CY - R * 0.7}" r="9" fill="#ffffff" opacity=".35"/>`;
    }
    case "solar-annular":
      // 月の所は空のまま（光の輪だけが残る）。ごく薄くかげらせる。
      return `<mask id="${id}-mk"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${CX + 1.5}" cy="${CY + 1}" r="${R * 0.86}" fill="#000"/></mask><g mask="url(#${id}-mk)">${glow(id, "#ffb347", 0.75, 2.4)}<circle cx="${CX}" cy="${CY}" r="${R}" fill="#ffcf5a"/><circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#ff9a2e" stroke-width="2"/></g><circle cx="${CX + 1.5}" cy="${CY + 1}" r="${R * 0.86}" fill="#000" opacity="${t === "navy" ? 0.18 : 0.06}"/>`;
    case "solar-partial":
      // 欠けた所は空の色（月は見えない）：太陽から月の円を抜く。光のにじみは抜かない（月の縁が浮かないように）。
      return `${glow(id, "#ffd27a", 0.6, 2.3)}<radialGradient id="${id}-sn" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#fff3b8"/><stop offset="1" stop-color="#ffc44a"/></radialGradient><mask id="${id}-mk"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${CX + R * 0.6}" cy="${CY - R * 0.22}" r="${R * 0.98}" fill="#000"/></mask><g mask="url(#${id}-mk)"><circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#${id}-sn)"/></g>`;
  }
  return "";
}

function skyOf(kind: string, t: T): [string, string, string] {
  const p = PAL[t];
  if (kind === "solar-total") return t === "navy" ? ["#0a1430", "#0b1a3c", "#132a55"] : t === "warm" ? ["#cfd6e2", "#dde2ea", "#ebe8e0"] : ["#c9d6cb", "#d6e2d5", "#e2ebdf"];
  if (kind === "lunar-total" && t === "navy") return ["#120f2e", "#1a1538", "#0b1024"];
  return p.sky;
}

function motif(kind: string, t: T): string {
  const p = PAL[t];
  if (kind === "corn") return corn(t);
  if (kind.startsWith("lunar")) return pines(p.sil, [[22, 150, 0.9], [40, 152, 1.15], [196, 150, 0.7]]) + watcher(p.sil, 160, 150);
  return pines(p.sil, [[200, 150, 0.8], [216, 152, 0.6]]) + lookers(p.sil, 28, 152);
}

export function art(kind: string, t: T): string {
  const id = `${kind}-${t}`;
  const [a, b, c] = skyOf(kind, t);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><linearGradient id="${id}-sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#${id}-sky)"/>${stars(t, PAL[t].night || kind === "solar-total" ? 22 : 10)}${body(kind, id, t)}${land(id, t)}${motif(kind, t)}</svg>`;
}

export const DRAWN = ["corn", "lunar-total", "lunar-partial", "lunar-penumbral", "solar-total", "solar-annular", "solar-partial"] as const;

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const k of DRAWN)
  for (const t of ["navy", "warm", "mist"] as T[]) {
    await page.setContent(`<html><body style="margin:0">${art(k, t)}</body></html>`);
    await page.screenshot({ path: `design-src/event/${k}-${t}.png`, clip: { x: 0, y: 0, width: W, height: H } });
  }
await browser.close();
console.log(`design-src/event に ${DRAWN.length * 3} 枚を描いた`);

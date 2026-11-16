// Measures each role of the three themes against its face with two yardsticks (#244 の比較):
// WCAG 2 contrast (what the tokens are tuned by) and APCA Lc (WCAG 3 draft; it reads light-on-dark
// and dark-on-light differently), plus the OKLab lightness gap. Colours composited first (an
// opacity, a veil) are measured as drawn. Run by hand; prints JSON.
//
//   npx --yes tsx@4.19.2 scripts/palette-measure.ts > palette-measure.json
//
// Color.js (MIT, devDependency only) does the colour maths: nothing of it reaches the app.

import Color from "colorjs.io";
import { themePalette, type ThemeName } from "../src/design/tokens";

const THEMES: ThemeName[] = ["navy", "mist", "warm"];

/** `fg` at `alpha` over `bg`, in sRGB as the browser composites it. */
function over(fg: string, alpha: number, bg: string): string {
  const f = new Color(fg).to("srgb");
  const b = new Color(bg).to("srgb");
  const a = f.alpha * alpha;
  const mix = f.coords.map((c, i) => c * a + b.coords[i] * (1 - a));
  return new Color("srgb", mix as [number, number, number]).toString({ format: "hex" });
}
function veilColor(v: string): { rgb: string; a: number } {
  const c = new Color(v).to("srgb");
  return { rgb: new Color("srgb", c.coords).toString({ format: "hex" }), a: c.alpha };
}
function measure(fg: string, bg: string) {
  const f = new Color(fg);
  const b = new Color(bg);
  return {
    color: fg,
    wcag: +f.contrast(b, "WCAG21").toFixed(2),
    apca: +Math.abs(f.contrast(b, "APCA")).toFixed(1),
    dL: +((f.to("oklab").coords[0] - b.to("oklab").coords[0]) * 100).toFixed(1),
  };
}

const out: Record<string, Record<string, ReturnType<typeof measure>>> = {};
for (const name of THEMES) {
  const t = themePalette(name);
  const base = t.surface.base;
  const veil = veilColor(t.effect.veil);
  const roles: Record<string, string> = {
    "面 カード": t.surface.raised,
    "面 シート": t.surface.overlay,
    "面 沈んだ面": t.surface.inset,
    "文字 主": t.ink.primary,
    "文字 補足": t.ink.secondary,
    "線 最高（主）": t.data.hot,
    "線 最低（主）": t.data.cold,
    "線 最高（比較日）": over(t.data.hot, t.compareOpacity, base),
    "線 参照": over(t.reference.color, t.reference.opacity, base),
    "網かけ": t.chart.hatch,
    "グリッド": t.chart.grid,
    "絵 太陽": t.icon.sun,
    "絵 月": t.icon.moon,
    "絵 雲": t.icon.cloud,
    "絵 雨": t.icon.rain,
    "絵の塗り（膜）": over(veil.rgb, veil.a, base),
    ...Object.fromEntries(t.feel.map((c, i) => [`肌感 ${i + 1}`, c])),
    "アクセント": t.accent.base,
  };
  out[name] = Object.fromEntries(
    Object.entries(roles).map(([k, c]) => [k, measure(c, base)]),
  );
}
console.log(JSON.stringify(out, null, 1));

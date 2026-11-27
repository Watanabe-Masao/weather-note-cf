// 「空を見上げる」の空の絵（見本、2026-11-27 渡辺さん「月がその方向にあることと、その時間の天気で見えにくそうなことを一目で」）。
// 窓の空を Canvas 2D で描くための、純粋な計算：空の色（方向ごと）、雲の広がり（方向ごと）、月の見えやすさの目安。
// 雲は時間ごとの天気（実績・予報）から描いた「イメージ」で、空のどこに雲があるかの観測ではない（1 時間の天気から分かるのは
// 空全体の雲の多さだけ。月の方角の雲を言い当てない）。出典の区別は SkyWeather.source（実績・予報・推定・なし）。
import type { SkyColour } from "./sky";

const RAD = Math.PI / 180;

/** その時間の天気（空の絵の元）。kind は天気の言葉から（晴れ・晴れ間のある曇り・曇り・雨・雪）。 */
export type SkyKind = "clear" | "partly" | "cloudy" | "rain" | "snow";
export interface SkyWeather {
  kind: SkyKind | null;
  /** 実績＝その時間の観測、予報、推定＝前後の時間の天気から、なし＝天気が無い。 */
  source: "実績" | "予報" | "推定" | "なし";
  /** 天気の言葉（気象庁の時別の天気など）と、何時台の値か。 */
  text: string | null;
  hour: number | null;
  /** 全雲量（0〜1）。予報・衛星解析から取れたときだけ。無いときは天気の言葉から雲の量のイメージを決める。 */
  cover?: number | null;
  /** 視程（km）。地平線近くのかすみに使う。 */
  visibilityKm?: number | null;
}

/** 天気の言葉 → 種類（hidesSky と同じ言葉の見分け方）。 */
export function skyKindOf(text: string | null): SkyKind | null {
  if (!text) return null;
  if (/雪/.test(text)) return "snow";
  if (/雨|雷/.test(text)) return "rain";
  if (/晴/.test(text) && /曇|くもり/.test(text)) return "partly";
  if (/晴/.test(text)) return "clear";
  if (/曇|くもり|霧/.test(text)) return "cloudy";
  return null;
}

/** 雲の量（0〜1）：全雲量があればそれ、無ければ天気の種類から描くためのイメージの量。天気が無いときは null（描かない）。 */
export function cloudAmount(wx: SkyWeather): number | null {
  if (wx.cover != null && Number.isFinite(wx.cover)) return Math.max(0, Math.min(1, wx.cover));
  switch (wx.kind) {
    case "clear":
      return 0.12;
    case "partly":
      return 0.5;
    case "cloudy":
      return 0.9;
    case "rain":
    case "snow":
      return 1;
    default:
      return null;
  }
}

/** 月の見えやすさの目安（空全体の雲の多さから。月の方角の雲を言い当てるものではない）。 */
export function moonOutlook(wx: SkyWeather, moonAlt: number): { level: "見える" | "切れ間から" | "見えにくそう" | "分からない" | "地平線の下"; note: string } {
  if (moonAlt < 0) return { level: "地平線の下", note: "月は地平線の下" };
  const c = cloudAmount(wx);
  const from = wx.source === "なし" ? "" : `（${wx.hour != null ? `${wx.hour - 1}時台 ` : ""}${wx.text ?? ""}・${wx.source}）`;
  if (c == null) return { level: "分からない", note: "この時間の天気が無いので、見えるかは分からない" };
  if (c >= 0.8) return { level: "見えにくそう", note: `雲が多く、見えにくそう${from}` };
  if (c >= 0.35) return { level: "切れ間から", note: `雲の切れ間から見えるかも${from}` };
  return { level: "見える", note: `晴れていれば見える${from}` };
}

/** 色（0〜1 の rgb）。 */
export type Rgb = [number, number, number];
export const hexRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** 二つの方向（方位・高さ°）の間の角（°）。 */
export function angleBetween(az1: number, alt1: number, az2: number, alt2: number): number {
  const c = Math.sin(alt1 * RAD) * Math.sin(alt2 * RAD) + Math.cos(alt1 * RAD) * Math.cos(alt2 * RAD) * Math.cos((az1 - az2) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

// 値の雑音（方向の単位ベクトルの 3 次元。種を固定して、同じ時刻・同じ天気ならいつも同じ雲の形）。
const hash = (x: number, y: number, z: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x: number, y: number, z: number, seed: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    s += a * noise3(x * f, y * f, z * f, seed + i * 17);
    a *= 0.5;
    f *= 2.03;
  }
  return s / 0.9375;
}

/** 雲の濃さ（0〜1）：その方向に雲を描く濃さ。高い所ほど大きな塊、地平線へ向かうほど細かく重なる（雲の層を見上げた形）。 */
export function cloudAt(az: number, alt: number, amount: number, seed: number, drift = 0): number {
  if (alt < -2 || amount <= 0) return 0;
  // 雲の層（高さ 1）を見上げた点：地平線へ向かうほど遠く（tan で引き伸ばす）。
  const a = Math.max(alt, 4) * RAD;
  const d = Math.min(4, 1 / Math.tan(a));
  const x = Math.sin(az * RAD) * d * 1.6 + drift;
  const y = Math.cos(az * RAD) * d * 1.6;
  const n = fbm(x, y, 0.37, seed);
  const lo = 1 - amount - 0.12;
  const v = smooth(lo, lo + 0.28, n);
  // 全面の雲（曇り・雨）は切れ間をほとんど残さない。地平線の近くは雲の塊を見分けず、平らな層にならす（縦の筋を作らない）。
  const flat = 1 - smooth(2, 12, alt);
  const dens = amount >= 0.95 ? Math.max(v, 0.82 + 0.18 * n) : v;
  return clamp01(dens * (1 - flat) + amount * 0.85 * flat);
}

export interface SceneInput {
  sky: SkyColour;
  sunAlt: number;
  sunAz: number;
  moonAlt: number;
  moonAz: number;
  /** 月の明るい部分（0〜1）。 */
  moonLit: number;
  wx: SkyWeather;
  /** 雲の形の種（日付と時間から）。 */
  seed: number;
}

/** 方向ごとの空の色（雲・かすみ込み）。地平線より下は描かない（窓の地面は SVG）。 */
export function skyRgb(s: SceneInput, az: number, alt: number): Rgb {
  const zen = hexRgb(s.sky.zenith);
  const hor = hexRgb(s.sky.horizon);
  let c = mix(hor, zen, smooth(0, 55, alt));
  const sunAng = angleBetween(az, alt, s.sunAz, s.sunAlt);
  // 太陽の側の地平線の明るさ：日の出・日の入りの前後（太陽が −10〜+10°）に、太陽の方角で暖色に。
  const twilight = smooth(-11, -2, s.sunAlt) * (1 - smooth(4, 14, s.sunAlt));
  const warm: Rgb = [1, 0.62, 0.36];
  const lowAlt = 1 - smooth(0, 28, alt);
  c = mix(c, warm, clamp01(twilight * Math.exp(-sunAng / 38) * lowAlt * 0.75));
  // 昼の太陽のまわりの明るさ。
  if (s.sunAlt > 0) c = mix(c, [1, 0.98, 0.92], clamp01(Math.exp(-sunAng / 10) * 0.5));
  // 夜の月のまわりの淡い明るさ。
  const night = 1 - smooth(-12, -4, s.sunAlt);
  const moonAng = angleBetween(az, alt, s.moonAz, s.moonAlt);
  if (s.moonAlt > 0) c = mix(c, [0.62, 0.68, 0.82], clamp01(night * s.moonLit * (Math.exp(-moonAng / 6) * 0.45 + Math.exp(-moonAng / 25) * 0.18)));
  // 雲。
  const amount = cloudAmount(s.wx);
  if (amount != null && amount > 0) {
    const dens = cloudAt(az, alt, amount, s.seed);
    if (dens > 0) {
      const day = smooth(-6, 6, s.sunAlt);
      const rainy = s.wx.kind === "rain" || s.wx.kind === "snow";
      // 雲の色：昼は白〜灰（雨は暗い灰）、夜は空より少し明るい灰青（街と月の明かりを受ける）、夕方は太陽の側が暖色。
      const dayCloud: Rgb = rainy ? [0.55, 0.58, 0.62] : amount >= 0.8 ? [0.78, 0.8, 0.83] : [0.97, 0.97, 0.98];
      // 夜の雲：空より暗い底と、月の明かりを受けて明るむ縁（月が明るく近いほど）。雨の夜はさらに暗く重い。
      const moonLight = s.moonAlt > 0 ? s.moonLit * (0.35 + 0.65 * Math.exp(-moonAng / 45)) : 0;
      const nightBase: Rgb = rainy ? [0.09, 0.1, 0.13] : [0.14, 0.16, 0.21];
      const nightLit: Rgb = rainy ? [0.3, 0.33, 0.4] : [0.5, 0.54, 0.62];
      const relief = 0.55 + 0.45 * dens; // 塊の中ほど明るく受ける（濃淡）
      const nightCloud = mix(nightBase, nightLit, clamp01(moonLight * relief));
      let cc = mix(nightCloud, dayCloud, day);
      cc = mix(cc, [1, 0.7, 0.5], clamp01(twilight * Math.exp(-sunAng / 50) * 0.7));
      c = mix(c, cc, dens * 0.95);
    }
  }
  // 地平線近くのかすみ（視程が短いほど）。視程が無いときは淡く。
  const vis = s.wx.visibilityKm;
  const haze = (vis != null ? 1 - smooth(4, 20, vis) : 0.15) * Math.exp(-Math.max(0, alt) / 7);
  c = mix(c, hor, clamp01(haze));
  return c;
}

/** 月の方向の雲の濃さ（0〜1）：窓の中で月にかける雲の覆い（空の絵と同じ雲の形）。 */
export function moonVeil(s: SceneInput): number {
  const amount = cloudAmount(s.wx);
  if (amount == null || s.moonAlt < 0) return 0;
  return cloudAt(s.moonAz, s.moonAlt, amount, s.seed);
}

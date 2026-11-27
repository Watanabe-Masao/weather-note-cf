// 「空を見上げる」の空の絵（β、2026-11-27）。空色エンジン バージョンアップ計画書（11/27）の段階 2「晴天大気と雲を分ける」：
// 晴天大気（雲のない空の色。今の空色モデル shared/sky.ts の天頂・地平の色に、太陽と月の方向を足す）と、雲（被覆・透過・色）を
// 別々に計算し、同じ時刻・同じ視線で、線形の光量で合成する（簡略合成：L表示 = T雲 × L晴天 + L雲。色の変換は最後にまとめる）。
// 雲は、その時間の天気（実績・予報、前後の時間＝推定）や全雲量から描いた「イメージ」で、空のどこに雲があるかの観測ではない。
// 生成した雲が月に重なるかは、実際の遮蔽を判断する材料にしない（月の見えやすさの目安 moonOutlook は空全体の雲の量だけから）。
// 雲の配置は、地点・対象時刻（1 時間）・入力・描画版から決まる種で固定し、同じ時刻に戻せば同じになる。
// 視程によるかすみは、遠景を描かない「空を見上げる」では初期状態で使わない（useVisibility を立てたときだけ）。
import type { SkyColour } from "./sky";

const RAD = Math.PI / 180;

/** 描画の版（雲の配置の種に入れる。描き方を変えたら上げる）。 */
export const SKY_SCENE_VERSION = 1;

/** その時間の天気（空の絵の元）。kind は天気の言葉から（晴れ・晴れ間のある曇り・曇り・雨・雪）。 */
export type SkyKind = "clear" | "partly" | "cloudy" | "rain" | "snow";
export interface SkyWeather {
  kind: SkyKind | null;
  /** 実績＝その時間の観測、予報、推定＝前後の時間の天気から、なし＝天気が無い。 */
  source: "実績" | "予報" | "推定" | "なし";
  /** 天気の言葉（気象庁の時別の天気など）と、何時台の値か（JMA の時間 n＝n−1〜n 時）。 */
  text: string | null;
  hour: number | null;
  /** 全雲量（0〜1）。予報・衛星解析から取れたときだけ。無いときは天気の言葉から雲の量のイメージを決める。 */
  cover?: number | null;
  /** 視程（km）。useVisibility のときだけ、地平線近くのかすみに使う。 */
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

/** 雲の量のイメージ（天気の言葉から。全雲量が無いとき）。 */
const KIND_AMOUNT: Record<SkyKind, number> = { clear: 0.12, partly: 0.5, cloudy: 0.9, rain: 1, snow: 1 };
/** これ以上は空一面の雲（不透明。背景が透けない）。 */
const OVERCAST = 0.95;

/** 雲の量（0〜1）：全雲量があればそれ、無ければ天気の種類から描くためのイメージの量。天気が無いときは null（描かない）。 */
export function cloudAmount(wx: SkyWeather): number | null {
  if (wx.cover != null && Number.isFinite(wx.cover)) return Math.max(0, Math.min(1, wx.cover));
  return wx.kind ? KIND_AMOUNT[wx.kind] : null;
}

/** 月の見えやすさの目安（空全体の雲の多さから。生成した雲の位置にはよらない。月の方角の雲を言い当てない）。 */
export function moonOutlook(wx: SkyWeather, moonAlt: number): { level: "見える" | "切れ間から" | "見えにくそう" | "分からない" | "地平線の下"; note: string } {
  if (moonAlt < 0) return { level: "地平線の下", note: "月は地平線の下" };
  const c = cloudAmount(wx);
  const from = wx.source === "なし" ? "" : `（${wx.hour != null ? `${wx.hour - 1}時台 ` : ""}${wx.text ?? (wx.cover != null ? `全雲量 ${Math.round(wx.cover * 100)}%` : "")}・${wx.source}）`;
  if (c == null) return { level: "分からない", note: "この時間の天気が無いので、見えるかは分からない" };
  if (c >= 0.8) return { level: "見えにくそう", note: `雲が多く、見えにくそう${from}` };
  if (c >= 0.35) return { level: "切れ間から", note: `雲の切れ間から見えるかも${from}` };
  return { level: "見える", note: `晴れていれば見える${from}` };
}

/** 色（0〜1）。sRGB と線形の光量を取り違えないよう、名前で分ける。 */
export type Rgb = [number, number, number];
export const hexRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const lin = (c: Rgb): Rgb => [toLin(c[0]), toLin(c[1]), toLin(c[2])];
const srgb = (c: Rgb): Rgb => [clamp01(toSrgb(clamp01(c[0]))), clamp01(toSrgb(clamp01(c[1]))), clamp01(toSrgb(clamp01(c[2])))];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
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

// 値の雑音（方向の 3 次元。種を固定して、同じ地点・時刻・入力・版ならいつも同じ雲の形）。
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

/** 雲の配置の種：地点・対象時刻（JST の日付と時間 n）・入力（雲の量）・描画の版から（同じなら同じ雲）。 */
export function sceneSeed(station: string, date: string, hour: number, amount: number | null): number {
  const key = `${station}|${date}|${hour}|${amount == null ? "-" : Math.round(amount * 100)}|v${SKY_SCENE_VERSION}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 1_000_003;
}

/**
 * 雲の被覆（0〜1）と濃淡（0〜1）：その方向に描く雲。高い所ほど大きな塊、地平線へ向かうほど細かく重なり、平らな層にならす。
 * 雲の量が OVERCAST 以上なら空一面（被覆 1、背景が透けない）。
 */
export function cloudAt(az: number, alt: number, amount: number, seed: number): { cover: number; shade: number } {
  if (alt < -2 || amount <= 0) return { cover: 0, shade: 0 };
  const a = Math.max(alt, 4) * RAD;
  const d = Math.min(4, 1 / Math.tan(a));
  const n = fbm(Math.sin(az * RAD) * d * 1.6, Math.cos(az * RAD) * d * 1.6, 0.37, seed);
  if (amount >= OVERCAST) return { cover: 1, shade: n };
  const lo = 1 - amount - 0.12;
  const v = smooth(lo, lo + 0.28, n);
  const flat = 1 - smooth(2, 12, alt);
  return { cover: clamp01(v * (1 - flat) + amount * 0.85 * flat), shade: n };
}

export interface SceneInput {
  /** 雲のない空（今の空色モデルを、雲の係数を晴れにして計算した天頂・地平の色）。 */
  clear: SkyColour;
  sunAlt: number;
  sunAz: number;
  moonAlt: number;
  moonAz: number;
  /** 月の明るい部分（0〜1）。 */
  moonLit: number;
  wx: SkyWeather;
  /** 雲の配置の種（sceneSeed）。 */
  seed: number;
  /** 視程のかすみを使う（初期状態は使わない）。 */
  useVisibility?: boolean;
}

/** 晴天大気（雲なし、線形の光量）：天頂・地平の色の間を高さで、太陽の側の地平線の暖色、昼の太陽のまわり、夜の月のまわり。 */
export function clearLin(s: SceneInput, az: number, alt: number): Rgb {
  let c = mix(lin(hexRgb(s.clear.horizon)), lin(hexRgb(s.clear.zenith)), smooth(0, 55, alt));
  const sunAng = angleBetween(az, alt, s.sunAz, s.sunAlt);
  const twilight = smooth(-11, -2, s.sunAlt) * (1 - smooth(4, 14, s.sunAlt));
  const lowAlt = 1 - smooth(0, 28, alt);
  c = mix(c, lin([1, 0.62, 0.36]), clamp01(twilight * Math.exp(-sunAng / 38) * lowAlt * 0.75));
  if (s.sunAlt > 0) c = mix(c, lin([1, 0.98, 0.92]), clamp01(Math.exp(-sunAng / 10) * 0.5));
  const night = 1 - smooth(-12, -4, s.sunAlt);
  if (s.moonAlt > 0) {
    const moonAng = angleBetween(az, alt, s.moonAz, s.moonAlt);
    c = add(c, lin([0.62, 0.68, 0.82]), night * s.moonLit * (Math.exp(-moonAng / 6) * 0.12 + Math.exp(-moonAng / 25) * 0.03));
  }
  return c;
}

/** 雲のレイヤー：その方向の雲の不透明さ（1 − 透過）と、雲の色（線形）。雲を描かないときは null。 */
export function cloudLayer(s: SceneInput, az: number, alt: number): { alpha: number; colour: Rgb } | null {
  const amount = cloudAmount(s.wx);
  if (amount == null || amount <= 0) return null;
  const { cover, shade } = cloudAt(az, alt, amount, s.seed);
  if (cover <= 0) return null;
  const overcast = amount >= OVERCAST;
  const alpha = overcast ? 1 : cover * 0.92;
  const day = smooth(-6, 6, s.sunAlt);
  const rainy = s.wx.kind === "rain" || s.wx.kind === "snow";
  const sunAng = angleBetween(az, alt, s.sunAz, s.sunAlt);
  const twilight = smooth(-11, -2, s.sunAlt) * (1 - smooth(4, 14, s.sunAlt));
  // 昼は白〜灰（雨は暗い灰）。夜は暗い底と、月の明かりを受けて明るむ所（月が明るく近いほど。塊の濃淡も）。
  const dayCloud = lin(rainy ? [0.55, 0.58, 0.62] : amount >= 0.8 ? [0.78, 0.8, 0.83] : [0.97, 0.97, 0.98]);
  const moonAng = s.moonAlt > 0 ? angleBetween(az, alt, s.moonAz, s.moonAlt) : 180;
  const moonLight = s.moonAlt > 0 ? s.moonLit * (0.35 + 0.65 * Math.exp(-moonAng / 45)) : 0;
  const nightCloud = mix(lin(rainy ? [0.09, 0.1, 0.13] : [0.14, 0.16, 0.21]), lin(rainy ? [0.3, 0.33, 0.4] : [0.5, 0.54, 0.62]), clamp01(moonLight * (0.55 + 0.45 * shade)));
  let colour = mix(nightCloud, dayCloud, day);
  // 一面の雲は濃淡で塊を見せる（明るさだけ少し変える）。
  if (overcast) colour = colour.map((v) => v * (0.82 + 0.36 * shade)) as Rgb;
  colour = mix(colour, lin([1, 0.7, 0.5]), clamp01(twilight * Math.exp(-sunAng / 50) * 0.7));
  return { alpha, colour };
}

/** その方向の雲の透過（1＝雲なし、0＝不透明）。 */
export function cloudTransmittance(s: SceneInput, az: number, alt: number): number {
  const c = cloudLayer(s, az, alt);
  return c ? 1 - c.alpha : 1;
}

/** 表示する色（sRGB 0〜1）：L表示 = T雲 × L晴天 + L雲（線形で合成し、最後に変換）。かすみは useVisibility のときだけ。 */
export function skyRgb(s: SceneInput, az: number, alt: number): Rgb {
  const clear = clearLin(s, az, alt);
  const c = cloudLayer(s, az, alt);
  let out = c ? add(clear.map((v) => v * (1 - c.alpha)) as Rgb, c.colour, c.alpha) : clear;
  if (s.useVisibility && s.wx.visibilityKm != null) {
    const haze = (1 - smooth(4, 20, s.wx.visibilityKm)) * Math.exp(-Math.max(0, alt) / 7);
    out = mix(out, lin(hexRgb(s.clear.horizon)), clamp01(haze));
  }
  return srgb(out);
}

/** 月の見え方（シミュレーション）：月の方向の雲の透過。案内の印（輪・名前）はこれによらず出す。 */
export function moonVeil(s: SceneInput): number {
  if (s.moonAlt < 0) return 0;
  return 1 - cloudTransmittance(s, s.moonAz, s.moonAlt);
}

/** どの入力で描いたか（計算の追跡）：レイヤーごとに、使ったか・入力・出典。 */
export function sceneTrace(s: SceneInput): { layer: string; used: boolean; note: string }[] {
  const amount = cloudAmount(s.wx);
  const when = s.wx.hour != null ? `${s.wx.hour - 1}時台の` : "";
  return [
    { layer: "晴天の空", used: true, note: `今の空色モデル（雲の係数を晴れにして計算した天頂・地平の色）に、太陽 ${Math.round(s.sunAlt)}°・月 ${Math.round(s.moonAlt)}° の方向の明るさ` },
    {
      layer: "雲",
      used: amount != null && amount > 0,
      note:
        amount == null
          ? "この時間の天気が無いので描いていない"
          : s.wx.cover != null
            ? `${when}全雲量 ${Math.round(s.wx.cover * 100)}%（${s.wx.source}）に基づくイメージ`
            : `${when}${s.wx.text ?? ""}（${s.wx.source}）から決めた雲の量 ${Math.round(amount * 100)}% のイメージ${amount >= OVERCAST ? "（空一面）" : ""}`,
    },
    { layer: "かすみ", used: !!s.useVisibility && s.wx.visibilityKm != null, note: s.useVisibility ? `視程 ${s.wx.visibilityKm ?? "なし"} km` : "使っていない（遠景を描かない画面なので、視程による補正は初期状態で使わない）" },
  ];
}

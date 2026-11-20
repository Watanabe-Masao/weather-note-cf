// 月の見え方（明るさと背景）：調査 MA-02（research/moon-appearance/README.md「MA-02」、ma02_visibility.py）をアプリで使う形に。
// 11/20 渡辺さん「視野と明るさから求めた方が後戻りしない」：物理の量 → 背景との比 → 見え方 の順で計算する。
//   1. 月の輝度（大気の外）：Krisciunas & Schaefer 1991 の位相の式 → 光っている部分の cd/m²
//   2. 大気の透過：MA-01 の大気（β 0.05）を目の感度で重み付けした表（下の T）
//   3. 背景の空の輝度：昼は CIE 標準一般天空の型12を水平面照度で絶対値に、薄明は照度の表、夜は街の空＋月の散乱
//   4. コントラスト C ＝ 月 ÷ 背景 → 色の濃さ C/(C+1)（C < 0.02 は 0）、明るさ (1+C)^(1/3)
//   5. 赤み：月の光と手前の空の光を足した色が、目の白（昼 D65 → 夜 天頂の月）から赤い向きへどれだけ離れているか
// 表（T・色度・昼の空の積分）は ma02_visibility.py で作った値（同じ式・同じ大気）。値の多くは推測を含み、実際の空との
// 見比べはこれから（11/20 渡辺さんの OK：見本で見比べて式の形を合わせる。CAM16 は今は使わない）。
// 天文の量（高さ・方位・位相角）は呼ぶ側から（Astronomy Engine）。色はここで決めず、白との混ぜ具合だけを返す。

import { moonPhase, moonTint, moonTopo } from "./moon";
import { solarAltitude, solarAzimuth } from "./sunTimes";

const RAD = Math.PI / 180;

/** 月の高さ（°）ごとの、大気を通ったあとの明るさの割合と、色度 xy（MA-01 の大気 β 0.05、オゾン 300DU）。 */
const HS = [
  0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60,
  75, 90,
];
const T = [
  0.00036, 0.0007, 0.00127, 0.00347, 0.00763, 0.01425, 0.03525, 0.06499,
  0.10027, 0.13816, 0.21405, 0.28384, 0.34517, 0.42193, 0.51771, 0.58572,
  0.63562, 0.70235, 0.74318, 0.76896, 0.79005, 0.79639,
];
const XY: [number, number][] = [
  [0.63271, 0.36225],
  [0.62115, 0.37161],
  [0.60951, 0.38052],
  [0.58708, 0.39595],
  [0.56668, 0.40763],
  [0.54857, 0.41582],
  [0.51863, 0.42437],
  [0.49549, 0.42645],
  [0.47741, 0.42531],
  [0.46308, 0.42269],
  [0.44211, 0.41622],
  [0.42772, 0.41001],
  [0.41736, 0.40467],
  [0.40641, 0.39826],
  [0.39495, 0.39071],
  [0.3879, 0.38566],
  [0.38317, 0.38209],
  [0.37735, 0.37751],
  [0.37403, 0.37481],
  [0.37203, 0.37313],
  [0.37043, 0.37179],
  [0.36996, 0.37138],
];
/** 太陽の高さ（°）ごとの、CIE 型12 の相対分布を空全体で積分した値（水平面照度から天頂の輝度を出すため）。 */
const SUN = [0.5, 1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 60, 70, 80, 90];
const SUN_E = [
  6.98666, 7.00692, 7.04568, 7.08184, 7.14515, 7.21279, 7.24142, 7.19051,
  7.05725, 6.78081, 6.39826, 5.40873, 4.28408, 3.19289, 2.2496, 1.50767,
  0.96883,
];
const D65: Xyz = [0.95047, 1, 1.08883];

type Xyz = [number, number, number];

function lerpTable(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i])
      return (
        ys[i - 1] +
        ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1])
      );
  return ys[ys.length - 1];
}
const xyAt = (h: number): [number, number] => [
  lerpTable(
    HS,
    XY.map((p) => p[0]),
    h,
  ),
  lerpTable(
    HS,
    XY.map((p) => p[1]),
    h,
  ),
];
const xyToXyz = (x: number, y: number, Y: number): Xyz => [
  (x / y) * Y,
  Y,
  ((1 - x - y) / y) * Y,
];
const uv = ([X, Y, Z]: Xyz): [number, number] => {
  const d = X + 15 * Y + 3 * Z || 1;
  return [(4 * X) / d, (9 * Y) / d];
};

/** 月全体の V 等級（Krisciunas & Schaefer 1991）。距離の2乗で直す。 */
function moonVmag(phaseAngle: number, km: number): number {
  const a = Math.abs(phaseAngle);
  return -12.73 + 0.026 * a + 4e-9 * a ** 4 + 5 * Math.log10(km / 384_400);
}
/** 大気の外での、光っている部分の平均の輝度（cd/m²）。0 等星の照度 2.54×10⁻⁶ lx（推測：よく使われる換算）。 */
function moonLuminance0(
  phaseAngle: number,
  fraction: number,
  km: number,
): number {
  const E = 2.54e-6 * 10 ** (-0.4 * moonVmag(phaseAngle, km));
  const omega = Math.PI * (1737.4 / km) ** 2;
  return E / (omega * Math.max(fraction, 1e-3));
}

/** 空の2点の離角（rad）。 */
function sep(alt1: number, az1: number, alt2: number, az2: number): number {
  const v = (h: number, a: number) => [
    Math.cos(h * RAD) * Math.sin(a * RAD),
    Math.cos(h * RAD) * Math.cos(a * RAD),
    Math.sin(h * RAD),
  ];
  const p = v(alt1, az1);
  const q = v(alt2, az2);
  return Math.acos(
    Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])),
  );
}
/** CIE 標準一般天空 型12（晴れ）の相対輝度。Z：空の点の天頂角、chi：太陽との離角、Zs：太陽の天頂角（rad）。 */
function cieRel(Z: number, chi: number, Zs: number): number {
  const [a, b, c, d, e] = [-1, -0.32, 10, -3, 0.45];
  const phi = (z: number) => 1 + a * Math.exp(b / Math.max(Math.cos(z), 1e-3));
  const f = (x: number) =>
    1 +
    c * (Math.exp(d * x) - Math.exp((d * Math.PI) / 2)) +
    e * Math.cos(x) ** 2;
  return (f(chi) * phi(Z)) / (f(Zs) * phi(0));
}
/** 昼：月の方向の空の輝度（cd/m²）。空からの水平面照度 400 + 15000 sin(h)^0.6 lx（推測の式）に合わせる。 */
function skyDay(
  sunAlt: number,
  sunAz: number,
  alt: number,
  az: number,
): number {
  const hs = Math.max(sunAlt, 0.5);
  const Zs = (90 - hs) * RAD;
  const Ed = 400 + 15000 * Math.max(Math.sin(sunAlt * RAD), 0) ** 0.6;
  const Lz = Ed / lerpTable(SUN, SUN_E, hs);
  const h = Math.max(alt, 0.5);
  return Lz * cieRel((90 - h) * RAD, sep(h, az, hs, sunAz), Zs);
}
/** 薄明：水平面照度（lx）を対数で補間し、空を一様と見て L = E/π（推測）。 */
const TWILIGHT: [number, number][] = [
  [0, 400],
  [-6, 3.4],
  [-12, 0.008],
  [-18, 6e-4],
];
function skyTwilight(sunAlt: number): number {
  for (let i = 0; i < TWILIGHT.length - 1; i++) {
    const [h1, e1] = TWILIGHT[i];
    const [h2, e2] = TWILIGHT[i + 1];
    if (sunAlt <= h1 && sunAlt >= h2) {
      const w = (sunAlt - h1) / (h2 - h1);
      return (
        10 ** (Math.log10(e1) + w * (Math.log10(e2) - Math.log10(e1))) / Math.PI
      );
    }
  }
  return 0;
}
/** 夜：街の明かりの空（高知市を 18.5 等/平方秒角と仮定）＋ 月の光が散った分（満月で 18 等/平方秒角、位相で弱める）。 */
function skyNight(phaseAngle: number): number {
  const a = Math.abs(phaseAngle);
  return (
    10.8e4 * 10 ** (-0.4 * 18.5) +
    10.8e4 * 10 ** (-0.4 * 18) * 10 ** (-0.4 * (0.026 * a + 4e-9 * a ** 4))
  );
}

export type MoonLookInput = {
  sunAlt: number;
  sunAz: number;
  moonAlt: number;
  moonAz: number;
  /** 位相角（°、0 が満月）。 */
  phaseAngle: number;
  /** 光っている部分の割合（0〜1）。 */
  fraction: number;
  /** 観測地からの距離（km）。 */
  km: number;
  /** 厚い雲（月は見えない）。 */
  overcast?: boolean;
};

export type MoonLook = {
  /** 月の輝度 ÷ 背景の空の輝度（ウェーバーコントラスト）。 */
  contrast: number;
  /** 色の濃さ（0〜1）：絵の不透明度に使う。0 は「空が明るく見えない」。 */
  strength: number;
  /** 背景に対する明るさ（1〜）：光の輪などに。 */
  bright: number;
  /** 赤み（0〜1、1 ＝ 夜の目で見た高さ 5° の月の色）：白と高さの色を混ぜる割合。 */
  red: number;
};

/** 月の見え方（MA-02）。 */
export function moonLook(p: MoonLookInput): MoonLook {
  const L0 = moonLuminance0(p.phaseAngle, p.fraction, p.km);
  const Tm = p.moonAlt > -0.5 ? lerpTable(HS, T, Math.max(0, p.moonAlt)) : 0;
  let Lm = L0 * Tm;
  const day =
    p.sunAlt >= 0 ? skyDay(p.sunAlt, p.sunAz, p.moonAlt, p.moonAz) : 0;
  const tw = p.sunAlt < 0 && p.sunAlt >= -18 ? skyTwilight(p.sunAlt) : 0;
  let Lb = Math.max(day, tw) + skyNight(p.phaseAngle);
  if (p.overcast) {
    Lm = 0;
    Lb *= 0.3;
  }
  const C = Lm / Lb;
  const strength = C < 0.02 ? 0 : C / (C + 1);
  const bright = (1 + C) ** (1 / 3);
  // 赤み：月の光（その高さの色）＋ 手前の空の光（空の色は推測：昼 0.290,0.300、薄明 0.300,0.300、夜の街 0.360,0.360）
  const [mx, my] = xyAt(Math.max(0, p.moonAlt));
  const moon = xyToXyz(mx, my, Lm);
  const skyXy: [number, number] =
    p.sunAlt >= 0 ? [0.29, 0.3] : p.sunAlt >= -12 ? [0.3, 0.3] : [0.36, 0.36];
  const sky = xyToXyz(skyXy[0], skyXy[1], Lb);
  const mix: Xyz = [moon[0] + sky[0], moon[1] + sky[1], moon[2] + sky[2]];
  const [zx, zy] = XY[XY.length - 1];
  const wn = xyToXyz(zx, zy, 1);
  // 目の白：昼（太陽 0° 以上）は D65、夜（−6° 以下）は天頂の月、その間は直線（推測）
  const w = Math.min(1, Math.max(0, -p.sunAlt / 6));
  const white: Xyz = [
    D65[0] * (1 - w) + wn[0] * w,
    1,
    D65[2] * (1 - w) + wn[2] * w,
  ];
  const [r5x, r5y] = xyAt(5);
  const [ur, vr] = uv(xyToXyz(r5x, r5y, 1));
  const [uw0, vw0] = uv(wn);
  const dr = [ur - uw0, vr - vw0];
  const ref = Math.hypot(dr[0], dr[1]);
  const [um, vm] = uv(mix);
  const [uw, vw] = uv(white);
  const red = Math.max(0, ((um - uw) * dr[0] + (vm - vw) * dr[1]) / ref / ref);
  return { contrast: C, strength, bright, red };
}

/**
 * その時刻・その場所の月の見え方（11/20 渡辺さんの OK：見本として画面に入れて、実際の空と見比べる）：
 * 色（白と、その高さの夜の目の色を、赤みで混ぜる）と、色の濃さ（絵の不透明度）。
 */
export function moonSeen(
  ms: number,
  date: string,
  minJst: number,
  lat: number,
  lon: number,
  overcast = false,
): MoonLook & { tint: string } {
  const topo = moonTopo(ms, lat, lon);
  const ph = moonPhase(ms);
  const look = moonLook({
    sunAlt: solarAltitude(date, minJst, lat, lon),
    sunAz: solarAzimuth(date, minJst, lat, lon),
    moonAlt: topo.altitude,
    moonAz: topo.azimuth,
    phaseAngle: ph.phaseAngle,
    fraction: ph.illuminated,
    km: topo.km,
    overcast,
  });
  return {
    ...look,
    tint: mixHex("#ffffff", moonTint(topo.altitude), Math.min(1, look.red)),
  };
}

function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// 端末を向けた方向（センサー連動、2026-11-18）：iPhone の向きのセンサーの値から、カメラ（端末の背面）が向いている
// 方位（真北 0・東 90）と高さ（地平線 0・天頂 90）を出す。磁北から真北へは偏角で直す。画面は縦向きだけを前提にする。
// どれも純粋な関数（テスト：test/data/sky-look.test.ts）。センサーそのものの扱いは src/ui/useSkyLook.ts。

const RAD = Math.PI / 180;

/**
 * 磁気偏角（°、西偏が正）：国土地理院の2020.0年値の近似式（日本の中、緯度・経度の2次式）。
 * 高知 7.6°・東京 7.6° ほど。真北の方位 = 磁北の方位 − 偏角。
 */
export function magneticDeclination(lat: number, lon: number): number {
  const dp = lat - 37;
  const dl = lon - 138;
  const minutes = 8 * 60 + 15.822 + 18.462 * dp - 7.726 * dl + 0.007 * dp * dp - 0.007 * dp * dl - 0.655 * dl * dl;
  return minutes / 60;
}

export interface Orientation {
  /** 端末の z 軸まわり（°、反時計回り）。absolute のとき北が基準。 */
  alpha: number | null;
  /** 前後の傾き（°）：画面を上に寝かせて 0、縦に立てて 90。 */
  beta: number | null;
  /** 左右の傾き（°）。 */
  gamma: number | null;
  /** iPhone（Safari）：磁北からの方位（°、時計回り）。あればこれを使う。 */
  webkitCompassHeading?: number | null;
  /** alpha が北を基準にしているか（deviceorientationabsolute）。 */
  absolute?: boolean;
}

/**
 * 背面カメラの向き：方位（真北 0、時計回り）と高さ（°）。分からないときは null。
 * 縦に立てた端末の背面の方向を、回転行列（alpha・beta・gamma、Z-X'-Y''）で地面の座標（東・北・上）に直して出す。
 * 方位は、iPhone の値（磁北基準）があればそれを使い、偏角で真北へ直す。
 */
export function lookFrom(o: Orientation, declination: number): { azimuth: number; altitude: number } | null {
  if (o.beta == null || o.gamma == null) return null;
  const a = (o.alpha ?? 0) * RAD;
  const b = o.beta * RAD;
  const g = o.gamma * RAD;
  // 端末の背面（−z）を地面の座標へ：R = Rz(α)·Rx(β)·Ry(γ) の第3列の符号を変えたもの。
  const x = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const y = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
  const z = -(Math.cos(b) * Math.cos(g));
  const altitude = Math.asin(Math.max(-1, Math.min(1, z))) / RAD;
  let azimuth: number | null = null;
  if (o.webkitCompassHeading != null && Number.isFinite(o.webkitCompassHeading)) azimuth = o.webkitCompassHeading - declination;
  else if (o.absolute && o.alpha != null) azimuth = Math.atan2(x, y) / RAD - declination;
  if (azimuth == null) return null;
  return { azimuth: ((azimuth % 360) + 360) % 360, altitude };
}

/** 方位の差（°、−180〜180）。 */
export const azDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** ならす（指数平滑）：方位は 360° をまたいでも近い方へ。k は新しい値の重み（0〜1）。 */
export function smooth(prev: { azimuth: number; altitude: number } | null, next: { azimuth: number; altitude: number }, k: number) {
  if (!prev) return next;
  const azimuth = (((prev.azimuth + azDiff(next.azimuth, prev.azimuth) * k) % 360) + 360) % 360;
  return { azimuth, altitude: prev.altitude + (next.altitude - prev.altitude) * k };
}

/**
 * 向いている方向を真ん中にした窓の中の位置：横 fov°・縦 fov×縦横比 の窓へ、方位と高さをそのまま比例で置く
 * （小さい窓なので、平らに広げてもずれは小さい）。窓の外なら inside=false（端に矢印を出すため）。
 */
export function placeIn(look: { azimuth: number; altitude: number }, body: { azimuth: number; altitude: number }, fov: number, w: number, h: number) {
  const vfov = (fov * h) / w;
  const dx = azDiff(body.azimuth, look.azimuth);
  const dy = body.altitude - look.altitude;
  const x = w / 2 + (dx / fov) * w;
  const y = h / 2 - (dy / vfov) * h;
  return { x, y, inside: Math.abs(dx) <= fov / 2 && Math.abs(dy) <= vfov / 2, dx, dy };
}

/** 方位と高さ（°）から単位ベクトル（東・北・上）。 */
const vec = (az: number, alt: number) => [Math.cos(alt * RAD) * Math.sin(az * RAD), Math.cos(alt * RAD) * Math.cos(az * RAD), Math.sin(alt * RAD)];

/**
 * カメラと同じ見え方（透視、2026-11-19）：向いている方向（look）を真ん中に、focal（画面の上の1単位＝px）で、天体の方向を
 * 画面の位置へ。端末はまっすぐ立てている（左右に傾けていない）とする。後ろ側（90°より外）は front=false。
 * focal は、縦の画角 vfov（°）を高さ h に合わせると (h/2)/tan(vfov/2)。
 */
export function project(look: { azimuth: number; altitude: number }, body: { azimuth: number; altitude: number }, focal: number, w: number, h: number) {
  const f = vec(look.azimuth, look.altitude);
  const up0 = [0, 0, 1];
  // 右 = 前 × 上、上 = 右 × 前（真上・真下を向いたときは方位から右を決める）
  let r = [f[1] * up0[2] - f[2] * up0[1], f[2] * up0[0] - f[0] * up0[2], f[0] * up0[1] - f[1] * up0[0]];
  const rl = Math.hypot(r[0], r[1], r[2]);
  r = rl < 1e-6 ? [Math.cos(look.azimuth * RAD), -Math.sin(look.azimuth * RAD), 0] : r.map((v) => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const v = vec(body.azimuth, body.altitude);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = dot(v, f);
  const front = z > 1e-3;
  const x = w / 2 + (dot(v, r) / Math.max(z, 1e-3)) * focal;
  const y = h / 2 - (dot(v, u) / Math.max(z, 1e-3)) * focal;
  return { x, y, front, inside: front && x >= 0 && x <= w && y >= 0 && y <= h, sx: dot(v, r), sy: dot(v, u) };
}

/** 縦の画角（°）から、高さ h の画面での focal。 */
export const focalOf = (vfov: number, h: number) => h / 2 / Math.tan((vfov / 2) * RAD);

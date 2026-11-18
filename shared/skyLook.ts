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

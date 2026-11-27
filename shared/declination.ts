// 磁北の方位を真北にそろえる（空の写真、段階 1a。2026-11-28）。
// 国土地理院「磁気偏角の近似式（2020.0 年値）」をそのまま使う（「空を見上げる」の shared/skyLook.ts と同じ式。1 か所にまとめた）（原典：国土地理院 地磁気 近似式のページ、11/28 に読んだ）。
//   D = 8°15.822′ + 18.462′Δφ − 7.726′Δλ + 0.007′Δφ² − 0.007′ΔφΔλ − 0.655′Δλ²
//   Δφ = 緯度 − 37°、Δλ = 経度 − 138°（度）。D は真北から反時計回り（西）を正。
// 原典の注意：日本のまわりの広い分布の 2 次近似で、局所的な異常は入らない。離島では精度が落ちる。
// 原典の例（東京 35°41′N・139°42′E → 西偏 7°36.5′）と同じになることをテストで確かめる。高知（33.5667, 133.5483）は 7°33.8′。
// 2020.0 年からの年ごとの変化は入れていない（その分のずれは残る。版の名前で区別する）。

import { magneticDeclination } from "./skyLook";

export const DECLINATION_MODEL = "gsi2020.0";

/** 近似式を使う範囲（日本のまわり、おおよそ）。外は「直せない」。 */
const inJapan = (lat: number, lon: number) => lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154;

/** 西偏を正にした偏角（度）。式は「空を見上げる」と同じもの（shared/skyLook.ts の magneticDeclination）を使う。範囲の外は null。 */
export function westDeclination(lat: number, lon: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inJapan(lat, lon)) return null;
  return magneticDeclination(lat, lon);
}

export interface TrueBearing {
  /** 真北から東回りの方位（0〜360）。直せなければ null */
  deg: number | null;
  /** 推定か（基準が分からない・場所が無く高知で補正した・範囲の外） */
  estimated: boolean;
  /** 使った偏角（西を正、度）。足していなければ null */
  declination: number | null;
  model: string | null;
}

const norm = (d: number) => ((d % 360) + 360) % 360;

/**
 * 写真の方位（EXIF の GPSImgDirection と基準 T／M）を真北にそろえる。
 * - T（真北）：そのまま。
 * - M（磁北）：撮影地点の偏角を引く（真北 = 磁北の方位 − 西偏）。場所が無ければ `fallback`（観測所）で補正して「推定」。
 * - 基準が分からない：そのまま使い「推定」。
 */
export function toTrueNorth(dir: number, ref: string | null, at: { lat: number; lon: number } | null, fallback: { lat: number; lon: number }): TrueBearing {
  if (!Number.isFinite(dir)) return { deg: null, estimated: true, declination: null, model: null };
  if (ref === "T") return { deg: norm(dir), estimated: false, declination: null, model: null };
  if (ref === "M") {
    const p = at ?? fallback;
    const d = westDeclination(p.lat, p.lon);
    if (d == null) return { deg: null, estimated: true, declination: null, model: null };
    return { deg: norm(dir - d), estimated: !at, declination: d, model: DECLINATION_MODEL };
  }
  return { deg: norm(dir), estimated: true, declination: null, model: null };
}

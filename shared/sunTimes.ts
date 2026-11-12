// Sunrise and sunset by calculation, for when the stored ones are missing (reports made before they
// were kept, or the sun API not answering). NOAA's simplified solar position (declination and the
// equation of time from the fractional year) with −0.833° for refraction and the sun's radius: within
// a few minutes of the published times across Japan, which is enough to say day or night.

import stationList from "./stations.json";
import type { Station } from "./types";

const stations = stationList as Station[];

/** Decimal degrees of a station ([degrees, minutes] in the list), or null for an unknown one. */
export function stationLatLon(blockNo: string | null | undefined): { lat: number; lon: number } | null {
  const s = blockNo ? stations.find((x) => x.blockNo === blockNo) : undefined;
  return s ? { lat: s.lat[0] + s.lat[1] / 60, lon: s.lon[0] + s.lon[1] / 60 } : null;
}

/** Japan's middle, for a station not in the list (135° E is JST's own meridian). */
export const DEFAULT_LAT_LON = { lat: 35, lon: 135 };

/** Sunrise and sunset of a date "YYYY-MM-DD" in minutes after midnight JST. */
export function solarTimes(date: string, lat: number, lon: number): { rise: number; set: number } {
  const t = Date.parse(`${date}T12:00:00Z`);
  const doy = Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 0)) / 86_400_000);
  const g = ((2 * Math.PI) / 365) * (doy - 1); // fractional year at noon (radians)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const phi = (lat * Math.PI) / 180;
  const cosH = (Math.cos((90.833 * Math.PI) / 180) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  const H = (Math.acos(Math.max(-1, Math.min(1, cosH))) * 180) / Math.PI; // degrees
  // Solar noon in minutes UTC, then JST (+540).
  const noon = 720 - 4 * lon - eqTime + 540;
  return { rise: noon - 4 * H, set: noon + 4 * H };
}

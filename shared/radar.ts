// 雨雲レーダー (RD-01/02, research/weather-map-radar): JMA's 高解像度降水ナウキャスト as 256px map tiles.
//   一覧：www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json — 5分ごと、約3時間分（時刻は UTC の yyyyMMddHHmmss）
//   タイル：…/nowc/{basetime}/none/{validtime}/surf/hrpns/{z}/{x}/{y}.png — PNG 256×256
// What is kept (2026-11-17, 渡辺さん): the 実況 every 30 minutes (毎時0分・30分 JST, as 解析雨量), the tiles
// around Kochi at zoom 8 (3×3, about 390 km square: 四国全体). The tiles are kept as JMA gives them.
// 出典：気象庁ホームページ「雨雲の動き」。The rain here is an intensity at that moment (mm/h), never an
// amount (mm): it is not put in the same column or line as AMeDAS's hourly precipitation (R4).

export const RADAR_LIST_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
export const radarTileUrl = (basetime: string, validtime: string, z: number, x: number, y: number) =>
  `https://www.jma.go.jp/bosai/jmatile/data/nowc/${basetime}/none/${validtime}/surf/hrpns/${z}/${x}/${y}.png`;

/** The usual web-map tile (x, y) that holds a point at zoom z. */
export function tileOf(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

/** The place kept: Kochi (高知市, the station 47893) and the 3×3 tiles around its tile at zoom 8. */
export const RADAR_PLACE = { name: "高知", lat: 33.56, lon: 133.53, z: 8, around: 1 };

export function radarTiles(place = RADAR_PLACE): { z: number; x: number; y: number }[] {
  const c = tileOf(place.lat, place.lon, place.z);
  const out: { z: number; x: number; y: number }[] = [];
  for (let dy = -place.around; dy <= place.around; dy++)
    for (let dx = -place.around; dx <= place.around; dx++) out.push({ z: place.z, x: c.x + dx, y: c.y + dy });
  return out;
}

/** JMA's UTC name (yyyyMMddHHmmss) as a JST time ("2026-11-17T22:30:00+09:00", R4: times kept in JST). */
export function jstOfRadarTime(utc: string): string {
  const t = Date.UTC(+utc.slice(0, 4), +utc.slice(4, 6) - 1, +utc.slice(6, 8), +utc.slice(8, 10), +utc.slice(10, 12), +utc.slice(12, 14));
  return `${new Date(t + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;
}

/** The kept times: on the hour and the half hour (JST minutes 00 and 30; JST is a whole number of hours ahead). */
export const isKeptRadarTime = (utc: string) => /^\d{10}(00|30)00$/.test(utc);

/** One entry of the list: the 実況 has basetime = validtime. */
export interface RadarListItem {
  basetime: string;
  validtime: string;
  elements?: string[];
}

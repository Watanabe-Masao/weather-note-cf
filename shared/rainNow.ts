// 雨の見込み（確認用）(research/rain-now, 2026-11-18)：気象庁の「雨雲の動き」と「今後の雨」を、その場で読んで見る。
// 保存はしない（保存は radarArchive.ts）。見る人の端末がアプリの Worker を通して、要る分のタイルだけを読む。
//   雨雲の動き：一覧 nowc/targetTimes_N1.json（実況、5分ごと・約3時間）・_N2.json（予測、5分ごと・1時間先まで）
//     タイル …/nowc/{basetime}/none/{validtime}/surf/hrpns/{z}/{x}/{y}.png ＝ 雨の強さ（mm/h）
//   今後の雨：一覧 rasrf/targetTimes.json（解析は basetime = validtime、予報は最新の basetime から15時間先まで）
//     タイル …/rasrf/{basetime}/{member}/{validtime}/surf/rasrf/{z}/{x}/{y}.png ＝ その1時間の量（mm）
// 強さ（mm/h）と量（mm）は別の物で、同じ段・同じ線に混ぜない（R4）。時刻は気象庁の UTC の名前のまま持ち、
// 見せるときに日本時間にする（R4）。出典：気象庁ホームページ「雨雲の動き」「今後の雨」（加工して作成）。

import { tileOf } from "./radar";
import { STATION_PLACES } from "./stationPlaces";

export const NOWC_BASE = "https://www.jma.go.jp/bosai/jmatile/data/nowc";
export const RASRF_BASE = "https://www.jma.go.jp/bosai/jmatile/data/rasrf";
export const RAIN_LISTS = {
  obs: `${NOWC_BASE}/targetTimes_N1.json`,
  nowcast: `${NOWC_BASE}/targetTimes_N2.json`,
  rasrf: `${RASRF_BASE}/targetTimes.json`,
} as const;

/** 見る場所：地点（雨雲の行、shared/stationPlaces.ts）。地図は段階 8〜10。 */
export const RAIN_ZOOMS = [8, 9, 10] as const;
export type RainZoom = (typeof RAIN_ZOOMS)[number];
export const rainPlace = (station = "47893") => STATION_PLACES[station]?.radar ?? null;

/** 中継してよいタイル：段階 8〜10 で、地点のタイルから縦横3枚以内（地図が要る分だけ。何でも中継する口にしない）。 */
export const TILE_REACH = 3;
export function isAllowedTile(z: number, x: number, y: number, station = "47893"): boolean {
  const p = rainPlace(station);
  if (!p || !(RAIN_ZOOMS as readonly number[]).includes(z)) return false;
  const c = tileOf(p.lat, p.lon, z);
  return Math.abs(x - c.x) <= TILE_REACH && Math.abs(y - c.y) <= TILE_REACH;
}

export type RainProduct = "hrpns" | "rasrf";
const TIME = /^\d{14}$/;
const MEMBER = /^[a-z0-9_]{1,16}$/;
export function rainTileUrl(p: RainProduct, basetime: string, member: string, validtime: string, z: number, x: number, y: number): string | null {
  if (!TIME.test(basetime) || !TIME.test(validtime) || !MEMBER.test(member)) return null;
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  return p === "hrpns"
    ? `${NOWC_BASE}/${basetime}/none/${validtime}/surf/hrpns/${z}/${x}/${y}.png`
    : `${RASRF_BASE}/${basetime}/${member}/${validtime}/surf/rasrf/${z}/${x}/${y}.png`;
}

/** 一覧の1行。 */
export interface JmaListItem {
  basetime: string;
  validtime: string;
  member?: string;
  elements?: string[];
}

/** 地図の1こま。m は「今」（実況のいちばん新しい時刻）からの分。1時間の量のこまは、その1時間の終わり。 */
export interface RainFrame {
  m: number;
  kind: "obs" | "nowcast" | "hourly";
  product: RainProduct;
  basetime: string;
  validtime: string;
  member: string;
}

/** 一つの一覧がどうだったか（読めなかった・空だった、を分けて見せる）。 */
export interface ListState {
  ok: boolean;
  /** 一覧の中の、使った行の数。 */
  count: number;
  /** 発表（basetime）のいちばん新しい時刻（UTC の名前）。 */
  latest: string | null;
  error?: string;
}

export interface RainNowResponse {
  v: 1;
  station: string;
  supported: boolean;
  /** 「今」：実況のいちばん新しい時刻（UTC の名前）。実況が読めないときは null。 */
  now: string | null;
  frames: RainFrame[];
  /**
   * グラフの下の段（1時間の量）：これまでは解析雨量（毎正時、6時間前まで）、これからは今後の雨（地図のこまと違い、
   * 雨雲の動きの予測と重なる1時間も入れる）。
   */
  hours: RainFrame[];
  lists: { obs: ListState; nowcast: ListState; rasrf: ListState };
  fetchedAt: string;
  source: string;
}

/** UTC の名前（yyyyMMddHHmmss）を ms に。 */
export const msOf = (t: string) =>
  Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12), +t.slice(12, 14));
const minutesBetween = (a: string, b: string) => Math.round((msOf(b) - msOf(a)) / 60_000);
const onHour = (t: string) => t.slice(10, 14) === "0000";

/** 15時間先まで（今後の雨）。過去の1時間の量は6時間前まで（グラフの24時間の幅の左端）。 */
export const HOURLY_AHEAD_MIN = 15 * 60;
export const PAST_HOURS_MIN = 6 * 60;

/**
 * 一覧から地図のこまを組む（純粋な関数、テストあり）。
 * - 実況：N1 の basetime = validtime、3時間前まで、5分ごと。いちばん新しいものが「今」。
 * - 雨雲の動きの予測：N2 のいちばん新しい basetime の、今より先、1時間先まで。
 * - 今後の雨：いちばん新しい basetime から1時間ずつ、雨雲の動きの予測の先（重なりは30分まで）、15時間先まで（1時間の量）。
 * - グラフの1時間の量：解析（basetime = validtime）の毎正時、6時間前〜今と、今後の雨の15時間先まで全部。
 * 同じ時刻が2つあるときは member の名前の順で最初のもの（none があれば none）。
 */
export function buildFrames(obs: JmaListItem[], nowcast: JmaListItem[], rasrf: JmaListItem[]) {
  const latest = (xs: JmaListItem[]) => xs.reduce<string | null>((a, i) => (a == null || i.basetime > a ? i.basetime : a), null);
  const obsTimes = [...new Set(obs.filter((i) => i.basetime === i.validtime && TIME.test(i.validtime)).map((i) => i.validtime))].sort();
  const now = obsTimes.at(-1) ?? null;
  const frames: RainFrame[] = [];
  const hours: RainFrame[] = [];
  if (!now) return { now, frames, hours };
  for (const t of obsTimes) {
    const m = minutesBetween(now, t);
    if (m >= -180) frames.push({ m, kind: "obs", product: "hrpns", basetime: t, validtime: t, member: "none" });
  }
  const nb = latest(nowcast.filter((i) => TIME.test(i.basetime) && TIME.test(i.validtime)));
  let nowcastEnd = 0;
  if (nb) {
    const ts = [...new Set(nowcast.filter((i) => i.basetime === nb && i.validtime > nb).map((i) => i.validtime))].sort();
    for (const t of ts) {
      const m = minutesBetween(now, t);
      if (m > 0 && m <= 60) {
        frames.push({ m, kind: "nowcast", product: "hrpns", basetime: nb, validtime: t, member: "none" });
        nowcastEnd = Math.max(nowcastEnd, m);
      }
    }
  }
  const rr = rasrf.filter((i) => TIME.test(i.basetime) && TIME.test(i.validtime) && (!i.elements || i.elements.includes("rasrf")));
  const pick = (xs: JmaListItem[]) => {
    const by = new Map<string, JmaListItem>();
    for (const i of [...xs].sort((a, b) => ((a.member ?? "none") === "none" ? -1 : (b.member ?? "none") === "none" ? 1 : (a.member ?? "").localeCompare(b.member ?? ""))))
      if (!by.has(i.validtime)) by.set(i.validtime, i);
    return [...by.values()].sort((a, b) => (a.validtime < b.validtime ? -1 : 1));
  };
  const rb = latest(rr.filter((i) => i.validtime > i.basetime));
  if (rb) {
    // 発表から1時間ずつ（発表が :30 なら :30 で区切る）。一覧が30分ごとでも、1時間の量が重ならないように。
    for (const i of pick(rr.filter((i) => i.basetime === rb && i.validtime > rb && minutesBetween(rb, i.validtime) % 60 === 0))) {
      const m = minutesBetween(now, i.validtime);
      const f: RainFrame = { m, kind: "hourly", product: "rasrf", basetime: rb, validtime: i.validtime, member: i.member ?? "none" };
      if (m > 0 && m <= HOURLY_AHEAD_MIN) hours.push(f);
      // 1時間の量は「終わり」の時刻で呼ぶ。雨雲の動きの予測と重なるのは30分まで（その1時間の始まりが予測の終わりの30分前以降）。
      if (m - 60 >= Math.max(0, nowcastEnd - 30) && m <= HOURLY_AHEAD_MIN)
        frames.push(f);
    }
  }
  for (const i of pick(rr.filter((i) => i.basetime === i.validtime && onHour(i.validtime)))) {
    const m = minutesBetween(now, i.validtime);
    if (m <= 0 && m >= -PAST_HOURS_MIN) hours.push({ m, kind: "hourly", product: "rasrf", basetime: i.basetime, validtime: i.validtime, member: i.member ?? "none" });
  }
  frames.sort((a, b) => a.m - b.m);
  hours.sort((a, b) => a.m - b.m);
  return { now, frames, hours };
}

/**
 * 気象庁の雨の色の段（強さ mm/h、今後の雨は同じ段で1時間の量 mm）。タイルの色から段を読む（画像から読めるのは
 * 段まで：値そのもの（12.5mm/h など）は読めない）。from の値以上、to 未満。
 */
export const RAIN_LEVELS = [
  { from: 0, to: 1, rgb: [242, 242, 255], label: "1未満" },
  { from: 1, to: 5, rgb: [160, 210, 255], label: "1〜5" },
  { from: 5, to: 10, rgb: [33, 140, 255], label: "5〜10" },
  { from: 10, to: 20, rgb: [0, 65, 255], label: "10〜20" },
  { from: 20, to: 30, rgb: [250, 245, 0], label: "20〜30" },
  { from: 30, to: 50, rgb: [255, 153, 0], label: "30〜50" },
  { from: 50, to: 80, rgb: [255, 40, 0], label: "50〜80" },
  { from: 80, to: Infinity, rgb: [180, 0, 104], label: "80以上" },
] as const;
export const levelHex = (i: number) => `#${RAIN_LEVELS[i].rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * 画素の色から段（0〜7）を読む。透明（または薄すぎる）は雨なし（-1）。いちばん近い色の段にし、どれからも遠い色
 * （地図の線など、見込んでいない色）は null（読めない）。
 */
export function levelOfPixel(r: number, g: number, b: number, a: number): number | null {
  if (a < 64) return -1;
  let best = -1;
  let dist = Infinity;
  RAIN_LEVELS.forEach((l, i) => {
    const d = (l.rgb[0] - r) ** 2 + (l.rgb[1] - g) ** 2 + (l.rgb[2] - b) ** 2;
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return dist <= 40 * 40 ? best : null;
}

/** 地点がタイルのどの画素か（段階 z、256px）。 */
export function pixelOf(lat: number, lon: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.floor((fx % 1) * 256), py: Math.floor((fy % 1) * 256) };
}

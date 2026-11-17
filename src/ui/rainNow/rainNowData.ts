// 雨の見込み（確認用）のデータ：こまの一覧（/api/rain-now）と、タイル（/api/rain-tile/…）を読む。
// タイルは一度読んだらこの画面を開いている間は持つ（同じ名前の中身は変わらない）。読めなかったタイルは
// 「取れなかった」として持ち、雨なしとは分ける（R5-1）。地点の値は、段階8 のタイルの地点の画素の色から段を読む
// （画像から読めるのは段まで。shared/rainNow.ts の RAIN_LEVELS）。

import { useEffect, useState } from "react";
import { levelOfPixel, msOf, pixelOf, type RainFrame, type RainNowResponse, rainPlace, RAIN_LEVELS } from "../../../shared/rainNow";

export type Tile = { s: "ok"; img: ImageBitmap } | { s: "missing"; code: number };
const tiles = new Map<string, Promise<Tile>>();

export const tilePath = (f: RainFrame, z: number, x: number, y: number) =>
  `/api/rain-tile/${f.product}/${f.basetime}/${f.member}/${f.validtime}/${z}/${x}/${y}.png`;

export function loadTile(path: string): Promise<Tile> {
  let p = tiles.get(path);
  if (!p) {
    p = fetch(path)
      .then(async (r): Promise<Tile> => (r.ok ? { s: "ok", img: await createImageBitmap(await r.blob()) } : { s: "missing", code: r.status }))
      .catch((): Tile => ({ s: "missing", code: 0 }));
    tiles.set(path, p);
    // 読めなかったものは、次に開いたとき読み直せるように持たない
    p.then((t) => t.s === "missing" && tiles.delete(path));
  }
  return p;
}

/** 地点の段：-1＝雨なし、0〜7＝段、"unread"＝色が読めない、"missing"＝取れなかった。 */
export type Level = number | "unread" | "missing";
const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;
async function levelAt(f: RainFrame, lat: number, lon: number): Promise<Level> {
  const p = pixelOf(lat, lon, 8);
  const t = await loadTile(tilePath(f, 8, p.x, p.y));
  if (t.s !== "ok" || !scratch) return "missing";
  scratch.width = 256;
  scratch.height = 256;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "unread";
  ctx.clearRect(0, 0, 256, 256);
  ctx.drawImage(t.img, 0, 0);
  const d = ctx.getImageData(p.px, p.py, 1, 1).data;
  return levelOfPixel(d[0], d[1], d[2], d[3]) ?? "unread";
}

export type Loaded = { s: "loading" } | { s: "ok"; data: RainNowResponse } | { s: "failed"; message: string };
export function useRainNow(station: string): [Loaded, () => void] {
  const [v, setV] = useState<Loaded>({ s: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setV({ s: "loading" });
    fetch(`/api/rain-now?station=${station}`)
      .then(async (r) => (r.ok ? ((await r.json()) as RainNowResponse) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => live && setV({ s: "ok", data }))
      .catch((e) => live && setV({ s: "failed", message: String(e instanceof Error ? e.message : e) }));
    return () => {
      live = false;
    };
  }, [station, n]);
  return [v, () => setN((x) => x + 1)];
}

/** 地点の段を、こまと1時間の量のぜんぶについて読む（同時に6枚まで）。読めた順に返す。 */
export function useLevels(station: string, frames: RainFrame[]): Map<string, Level> {
  const [levels, setLevels] = useState<Map<string, Level>>(new Map());
  const key = frames.map(frameKey).join(",");
  useEffect(() => {
    const place = rainPlace(station);
    if (!place) return;
    let live = true;
    setLevels(new Map());
    const queue = [...frames];
    const work = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const l = await levelAt(f, place.lat, place.lon);
        if (!live) return;
        const k = frameKey(f);
        setLevels((prev) => new Map(prev).set(k, l));
      }
    };
    for (let i = 0; i < 6; i++) void work();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the frames
  }, [station, key]);
  return levels;
}
export const frameKey = (f: RainFrame) => `${f.product}/${f.basetime}/${f.member}/${f.validtime}`;

// ---- 言葉と時刻 ------------------------------------------------------------------------------------
const jst = (ms: number) => new Date(ms + 9 * 3_600_000);
/** 「今」（UTC の名前）から m 分の時刻を「15:05」に。 */
export const clockOf = (now: string, m: number) => {
  const d = jst(msOf(now) + m * 60_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
export const clockOfName = (t: string) => {
  const d = jst(msOf(t));
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
export const frameLabel = (now: string, f: Pick<RainFrame, "m" | "kind">) =>
  f.kind === "hourly" ? `${clockOf(now, f.m - 60)}〜${clockOf(now, f.m)}` : clockOf(now, f.m);
const span = (min: number) => {
  const h = Math.floor(min / 60);
  const r = min % 60;
  return h && r ? `${h}時間${r}分` : h ? `${h}時間` : `${r}分`;
};
/** 今からの隔たり（「40分前」「1時間後」「2〜3時間後」「30分〜1時間30分後」）。 */
export function relLabel(f: Pick<RainFrame, "m" | "kind">): string {
  if (f.kind === "hourly") {
    const a = f.m - 60;
    if (a < 0) return `${span(-a)}前〜${span(f.m)}後`;
    return a % 60 === 0 ? `${a / 60}〜${f.m / 60}時間後` : `${a === 0 ? "今" : span(a)}〜${span(f.m)}後`;
  }
  return f.m === 0 ? "今" : f.m < 0 ? `${span(-f.m)}前` : `${span(f.m)}後`;
}
export const levelLabel = (l: number) => (l < 0 ? "なし" : RAIN_LEVELS[l].label);
/** 強さの段の呼び方（気象庁の「雨の強さと降り方」：10〜20 やや強い、20〜30 強い、30〜50 激しい、50〜80 非常に激しい、80以上 猛烈な）。 */
export const strengthOf = (l: number) =>
  l >= 7 ? "猛烈な雨" : l >= 6 ? "非常に激しい雨" : l >= 5 ? "激しい雨" : l >= 4 ? "強い雨" : l >= 3 ? "やや強い雨" : l >= 1 ? "雨" : "弱い雨";

/** 再生の速さ（1こまを出す時間、ミリ秒）：5分＝0.3秒、1時間＝1.2秒。1時間ごとは時間が3倍速く進む。 */
export const STEP_MS = { five: 300, hour: 1200 };
export const SPEED_UP = 60 / STEP_MS.hour / (5 / STEP_MS.five);
/** 古いとする長さ（分）：仮。気象庁の一覧の出方を本物で見て決める。 */
export const STALE_AFTER = { nowcast: 15, hourly: 90 };

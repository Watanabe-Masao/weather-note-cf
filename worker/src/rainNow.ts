// 雨の見込み（確認用）(shared/rainNow.ts)：気象庁の一覧を読んで地図のこまを返す口と、タイルを中継する口。
// 保存はしない。中継は地点のまわりのタイルだけ（isAllowedTile）、気象庁の画像をそのまま返す。
// - 一覧：1分ごとに1回だけ気象庁に読みに行き、あとは端の置き場（cachedFor）から。
// - タイル：時刻つきの名前なので中身は変わらない。読めたものは端に1日置く（何度見ても気象庁へは1回）。
//   読めなかったものは置かない（すぐ後に読めるかもしれないため）。端末には、読めなかったことを状態で返す
//   （404＝気象庁に無い、502＝読みに行けなかった）。画面はどちらも「取れなかった」と出し、雨なしとは見せない。

import { buildFrames, isAllowedTile, type JmaListItem, type ListState, RAIN_LISTS, type RainNowResponse, rainPlace, type RainProduct, rainTileUrl } from "../../shared/rainNow";

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(10_000) });

async function readList(url: string, get: Fetcher): Promise<{ items: JmaListItem[]; error?: string }> {
  try {
    const r = await get(url);
    if (!r.ok) return { items: [], error: `HTTP ${r.status}` };
    const j = (await r.json()) as unknown;
    if (!Array.isArray(j)) return { items: [], error: "一覧の形が違う" };
    return { items: j as JmaListItem[] };
  } catch (e) {
    return { items: [], error: String(e instanceof Error ? e.message : e).slice(0, 120) };
  }
}

export async function rainNow(station: string, get: Fetcher = defaultFetch, now = Date.now()): Promise<RainNowResponse> {
  const fetchedAt = new Date(now).toISOString();
  const source = "気象庁ホームページ「雨雲の動き」「今後の雨」";
  const empty: ListState = { ok: false, count: 0, latest: null };
  if (!rainPlace(station))
    return { v: 1, station, supported: false, now: null, frames: [], hours: [], lists: { obs: empty, nowcast: empty, rasrf: empty }, fetchedAt, source };
  const [obs, nowcast, rasrf] = await Promise.all([readList(RAIN_LISTS.obs, get), readList(RAIN_LISTS.nowcast, get), readList(RAIN_LISTS.rasrf, get)]);
  const built = buildFrames(obs.items, nowcast.items, rasrf.items);
  const state = (l: { items: JmaListItem[]; error?: string }, kind: "obs" | "nowcast" | "hourly"): ListState => {
    const used = built.frames.filter((f) => f.kind === kind);
    return {
      ok: !l.error,
      count: used.length,
      latest: used.reduce<string | null>((a, f) => (a == null || f.basetime > a ? f.basetime : a), null),
      ...(l.error ? { error: l.error } : {}),
    };
  };
  // 今後の雨の発表ごとのまとめ（確認用：発表がどこまで先を持っているか）
  const byBase = new Map<string, string[]>();
  for (const i of rasrf.items) if (i.validtime > i.basetime) byBase.set(i.basetime, [...(byBase.get(i.basetime) ?? []), i.validtime]);
  const bases = [...byBase.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 4)
    .map(([basetime, vs]) => ({ basetime, count: vs.length, first: vs.reduce((a, b) => (b < a ? b : a)), last: vs.reduce((a, b) => (b > a ? b : a)) }));
  return {
    v: 1,
    station,
    supported: true,
    now: built.now,
    frames: built.frames,
    hours: built.hours,
    lists: { obs: state(obs, "obs"), nowcast: state(nowcast, "nowcast"), rasrf: { ...state(rasrf, "hourly"), bases } },
    fetchedAt,
    source,
  };
}

const TILE_PATH = /^\/api\/rain-tile\/(hrpns|rasrf)\/(\d{14})\/([a-z0-9_]{1,16})\/(\d{14})\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.png$/;
const TILE_TTL = 24 * 60 * 60;

/** /api/rain-tile/<product>/<basetime>/<member>/<validtime>/<z>/<x>/<y>.png → 気象庁のタイル（地点のまわりだけ）。 */
export async function rainTile(
  pathname: string,
  origin: string,
  waitUntil: (p: Promise<unknown>) => void,
  get: Fetcher = defaultFetch,
  cache: Cache | null = (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null,
): Promise<Response> {
  const m = TILE_PATH.exec(pathname);
  const plain = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (!m) return plain(400, "タイルの指定が正しくありません。");
  const [, product, basetime, member, validtime, zs, xs, ys] = m;
  const [z, x, y] = [Number(zs), Number(xs), Number(ys)];
  if (!isAllowedTile(z, x, y)) return plain(403, "この場所のタイルは中継しません。");
  const url = rainTileUrl(product as RainProduct, basetime, member, validtime, z, x, y);
  if (!url) return plain(400, "タイルの指定が正しくありません。");
  const key = new Request(`${origin}/__cache/rain-tile/${product}/${basetime}/${member}/${validtime}/${z}/${x}/${y}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers: { "content-type": "image/png", "cache-control": `private, max-age=${TILE_TTL}` } });
  }
  let r: Response;
  try {
    r = await get(url);
  } catch {
    return plain(502, "気象庁に読みに行けませんでした。");
  }
  if (r.status === 404) return plain(404, "気象庁にこのタイルはありません。");
  if (!r.ok) return plain(502, `気象庁から HTTP ${r.status}`);
  const body = new Uint8Array(await r.arrayBuffer());
  if (body.length < 50 || body[0] !== 0x89 || body[1] !== 0x50) return plain(502, "画像ではありませんでした。");
  if (cache) waitUntil(cache.put(key, new Response(body, { headers: { "content-type": "image/png", "cache-control": `public, max-age=${TILE_TTL}` } })));
  return new Response(body, { headers: { "content-type": "image/png", "cache-control": `private, max-age=${TILE_TTL}` } });
}

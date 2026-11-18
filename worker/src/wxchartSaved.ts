// 天気図を予報の移り変わりと連動させる (2026-11-18 渡辺さん「これとセットで連動して動くのもあり？」)：
// 発表を選ぶと、その発表の時点で出ていた予想天気図（24・48時間後）を出す。気象庁は最新の1回しか置かないので、
// 保存した分（r2Archive.ts の saveCharts、R2 の wxchart/forecast/…、D1 の wxchart_saved）から読む。
// 保存を始める前の発表には無い（無いと書く）。実況の天気図（3時間ごと）は気象庁が 2024-10 から置いているので
// 画面が直接読む（shared/wxchart.ts）。

import type { Db } from "./accounts";
import type { Bucket } from "./r2Archive";

const FILE = /^\/api\/wxchart-file\/(wxchart\/(?:forecast|quick)\/\d{4}-\d{2}\/[\w.-]+\.png)$/;
/** The saved pictures never change (a name is one issue), so the edge and the phone keep them. */
const FILE_TTL = 365 * 24 * 3600;

export interface SavedForecastChart {
  hours: number;
  /** The analysis time it was drawn from, and the time it shows (Japan time, "2026-11-16T21:00+09:00"). */
  base: string;
  valid: string;
  /** Where the app reads the picture (this Worker, from R2). */
  src: string;
}

/** The 予想天気図 that were out at a moment: the latest saved issue drawn at or before `at` (Japan time ISO). */
export async function forecastChartsAt(db: Db, at: string): Promise<{ v: 1; at: string; charts: SavedForecastChart[] }> {
  let rows: { key: string; valid_at: string; base_at: string }[] = [];
  try {
    rows = (
      await db
        .prepare(
          "SELECT key, valid_at, base_at FROM wxchart_saved WHERE kind = 'forecast' AND base_at IS NOT NULL AND substr(base_at, 1, 16) <= substr(?, 1, 16) ORDER BY base_at DESC, valid_at LIMIT 4",
        )
        .bind(at)
        .all<{ key: string; valid_at: string; base_at: string }>()
    ).results;
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  }
  const base = rows[0]?.base_at;
  const charts = rows
    .filter((r) => r.base_at === base)
    .map((r) => ({ hours: Math.round((Date.parse(r.valid_at) - Date.parse(r.base_at)) / 3_600_000), base: r.base_at, valid: r.valid_at, src: `/api/wxchart-file/${r.key}` }));
  return { v: 1, at, charts };
}

/** A saved weather chart picture from R2 (only the wxchart/ pictures, by their kept names). */
export async function wxchartFile(pathname: string, bucket: Bucket | undefined): Promise<Response> {
  const plain = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const m = FILE.exec(pathname);
  if (!m) return plain(400, "天気図の指定が正しくありません。");
  if (!bucket) return plain(503, "保存した天気図を読めません。");
  const got = await bucket.get(m[1]);
  if (!got) return plain(404, "この天気図は保存されていません。");
  return new Response(await got.arrayBuffer(), { headers: { "content-type": "image/png", "cache-control": `public, max-age=${FILE_TTL}, immutable` } });
}

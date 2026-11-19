// 欠けの発見 (#299 P0, 2026-11-18)：「最新が取れた」と「履歴が完全」を分けて確かめる。
//   予報の電文：定時の発表（府県天気予報 5・11・17時、週間 11・17時。forecastWatch.ts の FORECAST_SCHEDULE）の1回1回が
//     保存されているか。最新が届いても、間の1回が抜けていれば欠け。
//   雨雲レーダー・解析雨量：30分ごとの時刻の1つ1つに、9枚そろっているか。連続して確かめられた位置（ウォーター
//     マーク）＝ 見る範囲の初めから、欠けの無い最後の時刻。
// 欠けは2つに分ける：
//   pending  まだ取り戻せる（提供元の一覧に載っている間）。次の回で取れるはず
//   lost     取り戻せない（一覧から外れた）。data_gaps に1度だけ残し、消さない（明示する）
// 一覧に載っている長さ：予報の電文 7日（長い一覧）、雨雲レーダー 約3時間、解析雨量 約12時間（docs/runbook.md）。
// 見る範囲：保存を始めた時刻から、最大 AUDIT_DAYS 日前まで（それより前の lost は data_gaps に残っている）。
// 今から猶予（予報 60分＝forecastWatch と同じ、雨雲 60分）以内の回は、まだ途中かもしれないので数えない。

import type { Db } from "./accounts";
import { FORECAST_GRACE_MS, FORECAST_SCHEDULE, FORECAST_WATCH_OFFICE } from "./forecastWatch";
import { doneOnce } from "./once";

export const AUDIT_DAYS = 14;
const H = 3_600_000;
export const FEED_REACH_MS = { forecast: 7 * 24 * H, hrpns: 3 * H, rasrf: 12 * H } as const;
const RADAR_GRACE_MS = H;

export const COMPLETENESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS data_gaps (
    source TEXT NOT NULL,
    item TEXT NOT NULL,
    found_at TEXT NOT NULL,
    detail TEXT NOT NULL,
    PRIMARY KEY (source, item)
  )`,
];
const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureCompletenessSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of COMPLETENESS_SCHEMA) await db.prepare(q).run();
  });
}

/** 日本時間の ISO（+09:00）。 */
const jstIso = (ms: number) => `${new Date(ms + 9 * H).toISOString().slice(0, 19)}+09:00`;

export interface SeriesAudit {
  /** 見た範囲（日本時間）。保存を始める前は null。 */
  from: string | null;
  to: string | null;
  expected: number;
  kept: number;
  /** 連続して確かめられた最後の時刻（見た範囲の初めから欠けの無い最後）。 */
  watermark: string | null;
  pending: string[];
  lost: string[];
}

/** 予報の定時の発表の時刻（日本時間の ISO）を、from〜to の間で古い順に。 */
export function scheduledTimes(kind: keyof typeof FORECAST_SCHEDULE, fromMs: number, toMs: number): string[] {
  const out: string[] = [];
  const day0 = Math.floor((fromMs + 9 * H) / (24 * H)) * 24 * H - 9 * H; // JST midnight at or before from
  for (let d = day0; d <= toMs; d += 24 * H)
    for (const h of FORECAST_SCHEDULE[kind]) {
      const t = d + h * H;
      if (t >= fromMs && t <= toMs) out.push(jstIso(t));
    }
  return out;
}

const audit = (times: string[], have: (t: string) => boolean, lostBefore: number): SeriesAudit => {
  const pending: string[] = [];
  const lost: string[] = [];
  let watermark: string | null = null;
  let broken = false;
  for (const t of times) {
    if (have(t)) {
      if (!broken) watermark = t;
      continue;
    }
    broken = true;
    (Date.parse(t) < lostBefore ? lost : pending).push(t);
  }
  return { from: times[0] ?? null, to: times.at(-1) ?? null, expected: times.length, kept: times.length - pending.length - lost.length, watermark, pending, lost };
};

/** 予報の電文の定時の発表が、1回ずつ保存されているか（種類ごと）。保存を始める前の時刻は数えない。 */
export async function auditForecasts(db: Db, now: number): Promise<Record<string, SeriesAudit>> {
  const out: Record<string, SeriesAudit> = {};
  for (const kind of Object.keys(FORECAST_SCHEDULE) as (keyof typeof FORECAST_SCHEDULE)[]) {
    const first = await db
      .prepare("SELECT MIN(issued_at) AS t FROM forecast_telegrams WHERE office = ? AND kind = ?")
      .bind(FORECAST_WATCH_OFFICE, kind)
      .first<{ t: string | null }>();
    if (!first?.t) {
      out[kind] = { from: null, to: null, expected: 0, kept: 0, watermark: null, pending: [], lost: [] };
      continue;
    }
    const fromMs = Math.max(Date.parse(first.t), now - AUDIT_DAYS * 24 * H);
    const times = scheduledTimes(kind, fromMs, now - FORECAST_GRACE_MS);
    const kept = (
      await db
        .prepare("SELECT issued_at FROM forecast_telegrams WHERE office = ? AND kind = ? AND issued_at >= ?")
        .bind(FORECAST_WATCH_OFFICE, kind, jstIso(fromMs - H))
        .all<{ issued_at: string }>()
    ).results.map((r) => Date.parse(r.issued_at));
    // その時刻から1時間の内に発表されたものがあれば、その回は保存されている（訂正などで数分ずれても）。
    const have = (t: string) => kept.some((k) => k >= Date.parse(t) && k < Date.parse(t) + H);
    out[kind] = audit(times, have, now - FEED_REACH_MS.forecast);
  }
  return out;
}

/** 雨雲レーダー・解析雨量の30分ごとの時刻が、9枚そろって保存されているか。保存を始める前の時刻は数えない。 */
export async function auditRadar(db: Db, now: number): Promise<Record<"hrpns" | "rasrf", SeriesAudit>> {
  const out = {} as Record<"hrpns" | "rasrf", SeriesAudit>;
  for (const product of ["hrpns", "rasrf"] as const) {
    const first = await db.prepare("SELECT MIN(valid_at) AS t FROM radar_saved WHERE key LIKE ?").bind(`radar/${product}/%`).first<{ t: string | null }>();
    if (!first?.t) {
      out[product] = { from: null, to: null, expected: 0, kept: 0, watermark: null, pending: [], lost: [] };
      continue;
    }
    const fromMs = Math.max(Date.parse(first.t), Math.ceil((now - AUDIT_DAYS * 24 * H) / (H / 2)) * (H / 2));
    const toMs = Math.floor((now - RADAR_GRACE_MS) / (H / 2)) * (H / 2);
    const times: string[] = [];
    for (let t = fromMs; t <= toMs; t += H / 2) times.push(jstIso(t));
    const full = new Set(
      (
        await db
          .prepare("SELECT valid_at, COUNT(*) AS n FROM radar_saved WHERE key LIKE ? AND valid_at >= ? GROUP BY valid_at")
          .bind(`radar/${product}/%`, jstIso(fromMs))
          .all<{ valid_at: string; n: number }>()
      ).results
        .filter((r) => r.n >= 9)
        .map((r) => r.valid_at),
    );
    out[product] = audit(times, (t) => full.has(t), now - FEED_REACH_MS[product]);
  }
  return out;
}

/** 欠けを確かめ、取り戻せない欠けを data_gaps に1度だけ残す（消さない）。新しく残した数を返す。 */
export async function auditCompleteness(db: Db, now: number) {
  await ensureCompletenessSchema(db);
  const forecast: Record<string, SeriesAudit> = await auditForecasts(db, now).catch((e) => (/no such table/i.test(String(e)) ? {} : Promise.reject(e)));
  const radar = await auditRadar(db, now).catch((e) => (/no such table/i.test(String(e)) ? ({} as Record<string, SeriesAudit>) : Promise.reject(e)));
  const at = new Date(now).toISOString();
  let newlyLost = 0;
  for (const [source, a] of [...Object.entries(forecast).map(([k, v]) => [`forecast:${k}`, v] as const), ...Object.entries(radar).map(([k, v]) => [`radar:${k}`, v] as const)])
    for (const item of a.lost) {
      const r = await db
        .prepare("INSERT OR IGNORE INTO data_gaps (source, item, found_at, detail) VALUES (?, ?, ?, ?)")
        .bind(source, item, at, "提供元の一覧から外れ、取り戻せない")
        .run();
      newlyLost += r.meta.changes ?? 0;
    }
  return { forecast, radar, newlyLost };
}

/** 長い一覧を短く（新しい順に6つまで）。 */
const short = (a: SeriesAudit) => ({ ...a, pending: a.pending.slice(-6).reverse(), lost: a.lost.slice(-6).reverse(), pendingCount: a.pending.length, lostCount: a.lost.length });

/**
 * /api/health と毎朝の点検のための、数と時刻だけのまとめ（読むだけ。data_gaps に書くのは毎時の見張りの
 * auditCompleteness）。表がまだ無いときは、その部分を空で返す。
 */
export async function readCompleteness(db: Db, now: number) {
  const safe = async <T>(f: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (/no such table/i.test(String(e))) return empty;
      throw e;
    }
  };
  const forecast = await safe(() => auditForecasts(db, now), {} as Record<string, SeriesAudit>);
  const radar = await safe(() => auditRadar(db, now), {} as Record<string, SeriesAudit>);
  const lostLastDay = await safe(
    async () => (await db.prepare("SELECT source, COUNT(*) AS n FROM data_gaps WHERE found_at >= ? GROUP BY source").bind(new Date(now - 24 * H).toISOString()).all<{ source: string; n: number }>()).results,
    [],
  );
  const lostAll = await safe(async () => (await db.prepare("SELECT source, COUNT(*) AS n FROM data_gaps GROUP BY source").all<{ source: string; n: number }>()).results, []);
  return {
    forecast: Object.fromEntries(Object.entries(forecast).map(([k, v]) => [k, short(v)])),
    radar: Object.fromEntries(Object.entries(radar).map(([k, v]) => [k, short(v)])),
    lostLastDay,
    lostAll,
  };
}
export type Completeness = Awaited<ReturnType<typeof readCompleteness>>;

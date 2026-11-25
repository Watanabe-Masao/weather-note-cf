// 欠けの発見 (#299 P0, 2026-11-18)：「最新が取れた」と「履歴が完全」を分けて確かめる。
//   予報の電文：定時の発表（府県天気予報 5・11・17時、週間 11・17時。forecastWatch.ts の FORECAST_SCHEDULE）の1回1回が
//     保存されているか。最新が届いても、間の1回が抜けていれば欠け。
//   雨雲レーダー・解析雨量：30分ごとの時刻の1つ1つに、9枚そろっているか。連続して確かめられた位置（ウォーター
//     マーク）＝ 見る範囲の初めから、欠けの無い最後の時刻。
// 欠けは2つに分ける：
//   pending  まだ取り戻せる（提供元の一覧に載っている間）。次の回で取れるはず
//   lost     取り戻せない（一覧から外れた）。data_gaps に1度だけ残し、消さない（明示する）。後で埋まったら
//            recovered_at・recovered_by を付ける（recoverGaps。欠けた事実は残す）
//   absent   提供元が出していない（2026-11-19、#299 P1）：一覧を読めた回があったのに、その時刻が一度も載らなかった。
//            証拠は listed.ts の source_listed（載っていた時刻）と、取得の記録（読めた回）。証拠を取り始める前の時刻は
//            分けられないので lost のまま。data_absent に1度だけ残す。欠けではないので、続けて確かめられた位置は止めない。
// 一覧に載っている長さ：予報の電文 7日（長い一覧）、雨雲レーダー 約3時間、解析雨量 約12時間（docs/runbook.md）。
// 見る範囲：保存を始めた時刻から、最大 AUDIT_DAYS 日前まで（それより前の lost は data_gaps に残っている）。
// 今から猶予（予報 60分＝forecastWatch と同じ、雨雲 60分）以内の回は、まだ途中かもしれないので数えない。

import type { Db } from "./accounts";
import { FORECAST_GRACE_MS, FORECAST_SCHEDULE, FORECAST_WATCH_OFFICE } from "./forecastWatch";
import { doneOnce } from "./once";
import { migrate } from "./migrate";
import { auditAir } from "./airAudit";

export const AUDIT_DAYS = 14;
const H = 3_600_000;
export const FEED_REACH_MS = { forecast: 7 * 24 * H, hrpns: 3 * H, rasrf: 12 * H } as const;
/** 予報の短い一覧の長さ（約10時間。forecastArchive.ts の SHORT_REACH_MS と同じ、控えめに8時間）。 */
const FEED_SHORT_REACH_MS = 8 * H;
const RADAR_GRACE_MS = H;

export const COMPLETENESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS data_absent (
    source TEXT NOT NULL,
    item TEXT NOT NULL,
    found_at TEXT NOT NULL,
    PRIMARY KEY (source, item)
  )`,
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
    // 作ったあとの変更は版で（migrate.ts）：v1 取り戻した印（2026-11-19、DB 設計の提案の Recovered）。
    await migrate(db, "completeness", [["ALTER TABLE data_gaps ADD COLUMN recovered_at TEXT", "ALTER TABLE data_gaps ADD COLUMN recovered_by TEXT"]]);
  });
}

/**
 * 取り戻せない欠けのうち、後で埋まったものに印を付ける（欠けた行は消さない）。埋まった手段：
 *   予報の電文 … 自前の電文（同じ回が後から保存された）か、過去の記録（shiromatz）の取り込み
 *   雨雲・解析雨量 … その時刻の9枚がそろった
 * 新しく印を付けた数を返す。
 */
export async function recoverGaps(db: Db, now: number): Promise<number> {
  const open = (await db.prepare("SELECT source, item FROM data_gaps WHERE recovered_at IS NULL ORDER BY item DESC LIMIT 200").all<{ source: string; item: string }>()).results;
  let n = 0;
  const day = (iso: string) => `${iso.slice(0, 10)}%`;
  for (const g of open) {
    const [kind, name] = g.source.split(":");
    const t = Date.parse(g.item);
    const within = (iso: string) => Date.parse(iso) >= t && Date.parse(iso) < t + H;
    let by: string | null = null;
    try {
      if (kind === "forecast") {
        const own = (await db.prepare("SELECT issued_at FROM forecast_telegrams WHERE office = ? AND kind = ? AND issued_at LIKE ?").bind(FORECAST_WATCH_OFFICE, name, day(g.item)).all<{ issued_at: string }>()).results;
        if (own.some((r) => within(r.issued_at))) by = "自前の電文";
        else {
          const rec = (await db.prepare("SELECT issued_at FROM forecast_issues WHERE source = 'shiromatz' AND office = ? AND kind = ? AND issued_at LIKE ?").bind(FORECAST_WATCH_OFFICE, name, day(g.item)).all<{ issued_at: string }>()).results;
          if (rec.some((r) => within(r.issued_at))) by = "過去の記録（shiromatz）";
        }
      } else if (kind === "radar") {
        const c = await db.prepare("SELECT COUNT(*) AS n FROM radar_saved WHERE key LIKE ? AND valid_at = ?").bind(`radar/${name}/%`, g.item).first<{ n: number }>();
        if ((c?.n ?? 0) >= 9) by = "保存";
      }
    } catch (e) {
      if (!/no such table/i.test(String(e))) throw e;
    }
    if (!by) continue;
    await db.prepare("UPDATE data_gaps SET recovered_at = ?, recovered_by = ? WHERE source = ? AND item = ?").bind(new Date(now).toISOString(), by, g.source, g.item).run();
    n++;
  }
  return n;
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
  /** 提供元が出していない（欠けではない）。 */
  absent: string[];
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

const audit = (times: string[], have: (t: string) => boolean, lostBefore: number, notIssued: (t: string) => boolean = () => false): SeriesAudit => {
  const pending: string[] = [];
  const lost: string[] = [];
  const absent: string[] = [];
  let watermark: string | null = null;
  let broken = false;
  for (const t of times) {
    if (have(t)) {
      if (!broken) watermark = t;
      continue;
    }
    if (Date.parse(t) < lostBefore && notIssued(t)) {
      absent.push(t); // 出ていない回は欠けではない（続けて確かめられた位置は止めない）
      if (!broken) watermark = t;
      continue;
    }
    broken = true;
    (Date.parse(t) < lostBefore ? lost : pending).push(t);
  }
  return { from: times[0] ?? null, to: times.at(-1) ?? null, expected: times.length - absent.length, kept: times.length - pending.length - lost.length - absent.length, watermark, pending, lost, absent };
};

/** 一覧に載っていた時刻（ms）。表がまだ無ければ空。 */
async function listedOf(db: Db, source: string, fromIso: string): Promise<number[]> {
  try {
    return (await db.prepare("SELECT item FROM source_listed WHERE source = ? AND item >= ?").bind(source, fromIso).all<{ item: string }>()).results.map((r) => Date.parse(r.item));
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
}
/** 一覧を読めた回の時刻（ms）と、その回の一覧の長さ。 */
async function okReads(db: Db, table: "forecast_fetch_log" | "radar_fetch_log", fromIso: string, reachOf: (feed: string | null) => number): Promise<{ at: number; reach: number }[]> {
  const col = table === "forecast_fetch_log" ? "feed" : "NULL AS feed";
  return (await db.prepare(`SELECT at, ${col} FROM ${table} WHERE ok = 1 AND at >= ?`).bind(fromIso).all<{ at: string; feed: string | null }>()).results.map((r) => ({ at: Date.parse(r.at), reach: reachOf(r.feed) }));
}
/**
 * 提供元が出していない、と言える回か：証拠を取り始めた後で、その時刻を載せるはずの間（猶予の後〜一覧から外れる前）に
 * 一覧を読めた回があり、それでも一度も載らなかった。
 */
const notIssuedBy = (listed: number[], reads: { at: number; reach: number }[], grace: number, window: number) => {
  const since = listed.length ? Math.min(...listed) : Infinity;
  return (t: string) => {
    const ms = Date.parse(t);
    if (ms < since) return false;
    if (listed.some((l) => l >= ms && l < ms + window)) return false;
    return reads.some((r) => r.at >= ms + grace && r.at <= ms + r.reach);
  };
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
      out[kind] = { from: null, to: null, expected: 0, kept: 0, watermark: null, pending: [], lost: [], absent: [] };
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
    const listed = await listedOf(db, `forecast:${kind}`, jstIso(fromMs - H));
    const reads = await okReads(db, "forecast_fetch_log", new Date(fromMs).toISOString(), (feed) => (feed === "long" ? FEED_REACH_MS.forecast : FEED_SHORT_REACH_MS));
    out[kind] = audit(times, have, now - FEED_REACH_MS.forecast, notIssuedBy(listed, reads, FORECAST_GRACE_MS, H));
  }
  return out;
}

/** 雨雲レーダー・解析雨量の30分ごとの時刻が、9枚そろって保存されているか。保存を始める前の時刻は数えない。 */
export async function auditRadar(db: Db, now: number): Promise<Record<"hrpns" | "rasrf", SeriesAudit>> {
  const out = {} as Record<"hrpns" | "rasrf", SeriesAudit>;
  for (const product of ["hrpns", "rasrf"] as const) {
    const first = await db.prepare("SELECT MIN(valid_at) AS t FROM radar_saved WHERE key LIKE ?").bind(`radar/${product}/%`).first<{ t: string | null }>();
    if (!first?.t) {
      out[product] = { from: null, to: null, expected: 0, kept: 0, watermark: null, pending: [], lost: [], absent: [] };
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
    const listed = await listedOf(db, `radar:${product}`, jstIso(fromMs));
    const reads = await okReads(db, "radar_fetch_log", new Date(fromMs).toISOString(), () => FEED_REACH_MS[product] - H / 2);
    out[product] = audit(times, (t) => full.has(t), now - FEED_REACH_MS[product], notIssuedBy(listed, reads, H / 2, 60_000));
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
    for (const item of a.absent) await db.prepare("INSERT OR IGNORE INTO data_absent (source, item, found_at) VALUES (?, ?, ?)").bind(source, item, at).run();
  for (const [source, a] of [...Object.entries(forecast).map(([k, v]) => [`forecast:${k}`, v] as const), ...Object.entries(radar).map(([k, v]) => [`radar:${k}`, v] as const)])
    for (const item of a.lost) {
      const r = await db
        .prepare("INSERT OR IGNORE INTO data_gaps (source, item, found_at, detail) VALUES (?, ?, ?, ?)")
        .bind(source, item, at, "提供元の一覧から外れ、取り戻せない")
        .run();
      newlyLost += r.meta.changes ?? 0;
    }
  const newlyRecovered = await recoverGaps(db, now);
  return { forecast, radar, newlyLost, newlyRecovered };
}

/** 長い一覧を短く（新しい順に6つまで）。 */
const short = (a: SeriesAudit) => ({ ...a, pending: a.pending.slice(-6).reverse(), lost: a.lost.slice(-6).reverse(), absent: a.absent.slice(-6).reverse(), pendingCount: a.pending.length, lostCount: a.lost.length, absentCount: a.absent.length });

/**
 * /api/health と毎朝の点検のための、数と時刻だけのまとめ（読むだけ。data_gaps に書くのは毎時の見張りの
 * auditCompleteness）。表がまだ無いときは、その部分を空で返す。
 */
export async function readCompleteness(db: Db, now: number) {
  // 版の変更（取り戻した印の列）を、読む前にも当てる（2026-11-19）：以前は毎時の見張りが当てるまで、公開後しばらく
  // 新しい列が無く、/api/health とデータの保守が「no such column」で失敗していた。表がまだ無い DB では何もしない。
  await ensureCompletenessSchema(db).catch((e) => console.error("weather-note: completeness schema", e));
  const safe = async <T>(f: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (/no such table|no such column/i.test(String(e))) return empty;
      throw e;
    }
  };
  const forecast = await safe(() => auditForecasts(db, now), {} as Record<string, SeriesAudit>);
  const radar = await safe(() => auditRadar(db, now), {} as Record<string, SeriesAudit>);
  // 空気のデータ（11/25、airAudit.ts）：CAMS の終わった日・そらまめくん・予測。pending は新しい順に6つまで。
  const airRaw = await safe(() => auditAir(db, now), null);
  // 空気のデータがまだ1時間も無い（保存を始める前・表が無い）ときは null。
  const air = airRaw && (airRaw.cams.expected || airRaw.soramame.expected || airRaw.soramame.newest || airRaw.forecast.kept) ? {
    cams: { ...airRaw.cams, pending: airRaw.cams.pending.slice(-6).reverse(), pendingCount: airRaw.cams.pending.length, absentCount: airRaw.cams.absent.length },
    soramame: { ...airRaw.soramame, pending: airRaw.soramame.pending.slice(-6).reverse(), pendingCount: airRaw.soramame.pending.length, absent: airRaw.soramame.absent.slice(-6).reverse(), absentCount: airRaw.soramame.absent.length },
    forecast: { expected: airRaw.forecast.expected, kept: airRaw.forecast.kept, pendingCount: airRaw.forecast.pending.length },
  } : null;
  const lostLastDay = await safe(
    async () => (await db.prepare("SELECT source, COUNT(*) AS n FROM data_gaps WHERE found_at >= ? GROUP BY source").bind(new Date(now - 24 * H).toISOString()).all<{ source: string; n: number }>()).results,
    [],
  );
  // これまでの取り戻せない欠け（まだ埋まっていないもの）と、後で取り戻したもの。
  const lostAll = await safe(async () => (await db.prepare("SELECT source, COUNT(*) AS n FROM data_gaps WHERE recovered_at IS NULL GROUP BY source").all<{ source: string; n: number }>()).results, []);
  const recoveredAll = await safe(async () => (await db.prepare("SELECT source, COUNT(*) AS n FROM data_gaps WHERE recovered_at IS NOT NULL GROUP BY source").all<{ source: string; n: number }>()).results, []);
  // 提供元が出していない回（欠けではない）：これまでの数。
  const absentAll = await safe(async () => (await db.prepare("SELECT source, COUNT(*) AS n FROM data_absent GROUP BY source").all<{ source: string; n: number }>()).results, []);
  return {
    forecast: Object.fromEntries(Object.entries(forecast).map(([k, v]) => [k, short(v)])),
    radar: Object.fromEntries(Object.entries(radar).map(([k, v]) => [k, short(v)])),
    air,
    lostLastDay,
    lostAll,
    recoveredAll,
    absentAll,
  };
}
export type Completeness = Awaited<ReturnType<typeof readCompleteness>>;

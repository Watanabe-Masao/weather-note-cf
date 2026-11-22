// 週1回の整合性の点検（#370、2026-11-22）。読むだけで、何も消さない。
//
// 毎時の欠けの発見（completeness.ts）は、取り戻せるうちに気づくための「最近14日」だけを見る。ここでは、保存して
// いる系列を**取り始めから今まで**の全期間で見て、2つを分けて評価する：
//   最新 … いちばん新しい時刻が、決めた時間より新しいか（取得が今も動いている）
//   履歴 … 取り始めから最新までの間に、抜けた時刻がないか（過去がそろっている）
// 規則正しく並ぶ系列（アメダス3時間・雨雲30分・天気図3時間・空気質1時間・そらまめ1時間）は抜けた回数まで数え、
// 発表が不規則な電文（予報・長い先の予報）は「決めた間隔より長く空いたところ」を挙げる。
// 隣どうしの差は D1 の中で計算する（LAG、Worker の計算時間を使わない）。加えて、R2 に置いたはずのファイルを
// 毎回20件ほど選んで、実物があるか・大きさが記録どおりかを確かめる。
// 結果は weekly_audit に残し、保守の画面と毎朝の点検に出す。8日より古いと見張りの注意になる（healthJudge.ts）。

import type { Db } from "./accounts";
import type { Bucket } from "./r2Archive";
import { doneOnce } from "./once";
import { CHART_HOURS } from "../../shared/wxchart";

const H = 3_600_000;
const DAY = 24 * H;
/** 点検の間隔。日本時間の3時台の回だけが取る（ほかの段と重ならない静かな時間）。 */
export const WEEKLY_AUDIT_EVERY_MS = 7 * DAY - 2 * H;
const AUDIT_HOUR_JST = 3;
/** R2 の実物を確かめる数（毎回ちがう行を選ぶ）。 */
const R2_SAMPLE = 20;
/** 抜けの区間は、長いものから何個まで残すか。 */
const GAP_LIST = 5;
const KEEP = 60; // 回

export const WEEKLY_AUDIT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS weekly_audit (
    at TEXT PRIMARY KEY,
    done_at TEXT,
    ok INTEGER,
    detail TEXT
  )`,
];
const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureWeeklyAuditSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of WEEKLY_AUDIT_SCHEMA) await db.prepare(q).run();
  });
}

/** 日本時間の3時台で、前の点検から約1週間たっていれば、この回が点検を取る（取ったら weekly_audit に行ができる）。 */
export async function claimWeeklyAudit(db: Db, now: number, force = false): Promise<boolean> {
  if (!force && new Date(now + 9 * H).getUTCHours() !== AUDIT_HOUR_JST) return false;
  await ensureWeeklyAuditSchema(db);
  const r = await db
    .prepare("INSERT OR IGNORE INTO weekly_audit (at) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM weekly_audit WHERE at > ?)")
    .bind(new Date(now).toISOString(), new Date(force ? now - 60_000 : now - WEEKLY_AUDIT_EVERY_MS).toISOString())
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export type AuditGap = { from: string; to: string; n: number | null };
export type AuditSeries = {
  id: string;
  name: string;
  /** 地点・種類など（系列の中の区別）。 */
  part: string;
  first: string | null;
  last: string | null;
  /** 残っている時刻（電文は通数）。 */
  have: number;
  /** 抜けた回数（規則正しい系列だけ。電文は null）。 */
  missing: number | null;
  /** 抜けの区間の数と、長いもの GAP_LIST 個。 */
  gapCount: number;
  gaps: AuditGap[];
  /** 最新の時刻が何時間前か、許す時間、新しいか。 */
  ageH: number | null;
  freshH: number;
  fresh: boolean;
  /** 抜けたときに取り直せるか（言葉）。 */
  note: string;
};
export type WeeklyAuditResult = {
  at: string;
  series: AuditSeries[];
  /** 毎時の欠けの発見の累計（data_gaps：取り戻せない・後で埋まった、data_absent：気象庁が出していない）。 */
  holes: { source: string; lost: number; recovered: number; absent: number }[];
  r2: { checked: number; missing: string[]; wrongSize: string[] } | null;
  latestOk: boolean;
  historyOk: boolean;
  failed: { part: string; message: string }[];
};

type Def = {
  id: string;
  name: string;
  /** g（区別）と t（時刻の文字列）を返す SELECT。 */
  q: string;
  /** 規則正しい系列の1回の長さ（電文は undefined）。 */
  step?: number;
  /** 規則正しい系列で、数える時刻か（天気図は 3〜21時の7回、0時は無い）。 */
  keep?: (ms: number) => boolean;
  /** 不規則な電文：これより長く空いたら挙げる（区別ごとに変えられる）。 */
  maxGap?: (g: string) => number | null;
  freshH: number;
  note: string;
};

const jstHour = (ms: number) => new Date(ms + 9 * H).getUTCHours();

/** 点検する系列。時刻の書き方は表ごとにちがう（+09:00 つき、日本時間の date と hour）ので、q の中で t にそろえる。 */
export const AUDIT_SERIES: Def[] = [
  {
    id: "amedas",
    name: "アメダスの観測（10分値の原本）",
    q: "SELECT point AS g, block_at AS t FROM amedas_saved",
    step: 3 * H,
    freshH: 12,
    note: "気象庁は約10日しか置かないので、それより前の抜けは取り戻せない。",
  },
  {
    id: "radar",
    name: "雨雲レーダー・解析雨量",
    q: "SELECT substr(key, 7, 5) AS g, valid_at AS t FROM radar_saved GROUP BY g, valid_at",
    step: 30 * 60_000,
    freshH: 2,
    note: "気象庁の一覧は雨雲が約3時間・解析雨量が約12時間なので、過ぎた抜けは取り戻せない。",
  },
  {
    id: "wxchart",
    name: "天気図（実況）",
    q: "SELECT kind AS g, valid_at AS t FROM wxchart_saved WHERE kind = 'quick'",
    step: 3 * H,
    keep: (ms) => (CHART_HOURS as readonly number[]).includes(jstHour(ms)),
    freshH: 12,
    note: "気象庁のページに載っている間だけ取れる。",
  },
  {
    id: "air",
    name: "空気質（CAMS のモデル値）",
    q: "SELECT station AS g, valid_at AS t FROM air_quality_hourly",
    step: H,
    freshH: 72,
    note: "2023-01 からいつでも取り直せる（値の無い時間は残さないので、抜けが元から無い時間のこともある）。",
  },
  {
    id: "soramame",
    name: "大気汚染の実測（そらまめくん）",
    q: "SELECT station AS g, strftime('%Y-%m-%dT%H:%M:%S+09:00', date, '+' || hour || ' hours') AS t FROM soramame_hourly",
    step: H,
    freshH: 7 * 24,
    note: "約1年さかのぼって取れる（局が測っていない時間は元から無い）。",
  },
  {
    id: "forecast",
    name: "予報の電文",
    q: "SELECT kind || ' ' || office AS g, issued_at AS t FROM forecast_telegrams WHERE issued_at IS NOT NULL",
    // 府県天気予報・概況は 5・11・17時（最長12時間）、週間は 11・17時（最長18時間）。少しの遅れは許す。
    maxGap: (g) => (g.startsWith("VPFW50") ? 19 * H : 13 * H),
    freshH: 13,
    note: "配信の長い一覧は7日分。過ぎた抜けは過去の記録（shiromatz）の取り込みで埋まることがある。",
  },
  {
    id: "longrange",
    name: "長い先の予報の電文",
    q: "SELECT kind || ' ' || office AS g, issued_at AS t FROM longrange_telegrams WHERE issued_at IS NOT NULL",
    // 1か月予報は毎週木曜（祝日で前後する）、2週間気温予報は毎日。早期天候情報は出るときだけなので間隔は見ない。
    maxGap: (g) => (g.startsWith("VPCK50") ? 9 * DAY : g.startsWith("VPCK70") ? 2 * DAY : null),
    freshH: 9 * 24,
    note: "配信の長い一覧は7日分。過ぎた抜けは取り戻せない。",
  },
];

/** 時刻の文字列（+09:00 つき・Z つき）をミリ秒に。 */
const ms = (t: string) => Date.parse(t);

/** 前の時刻と次の時刻の間で、数える時刻がいくつ抜けているか。 */
export function slotsBetween(prev: number, next: number, step: number, keep?: (ms: number) => boolean): number {
  let n = 0;
  for (let t = prev + step; t < next - step / 2; t += step) if (!keep || keep(t)) n++;
  return n;
}

async function auditSeries(db: Db, d: Def, now: number): Promise<AuditSeries[]> {
  const sums = (await db.prepare(`SELECT g, MIN(t) AS first, MAX(t) AS last, COUNT(DISTINCT t) AS n FROM (${d.q}) GROUP BY g ORDER BY g`).all<{ g: string; first: string; last: string; n: number }>()).results;
  // 隣との差が「1回より長い」ところだけを D1 から受け取る（大半の行は返ってこない）。
  const least = d.step ? d.step * 1.5 : Math.min(...sums.map((s) => d.maxGap?.(s.g) ?? Infinity));
  const wide = Number.isFinite(least)
    ? (
        await db
          .prepare(
            `SELECT g, prev, t FROM (SELECT g, t, LAG(t) OVER (PARTITION BY g ORDER BY t) AS prev FROM (SELECT DISTINCT g, t FROM (${d.q})))
             WHERE prev IS NOT NULL AND (julianday(t) - julianday(prev)) * 86400000.0 > ? ORDER BY g, t`,
          )
          .bind(least)
          .all<{ g: string; prev: string; t: string }>()
      ).results
    : [];
  return sums.map((s) => {
    const max = d.maxGap?.(s.g) ?? null;
    const gaps: AuditGap[] = [];
    for (const w of wide) {
      if (w.g !== s.g) continue;
      if (d.step) {
        const n = slotsBetween(ms(w.prev), ms(w.t), d.step, d.keep);
        if (n) gaps.push({ from: w.prev, to: w.t, n });
      } else if (max != null && ms(w.t) - ms(w.prev) > max) gaps.push({ from: w.prev, to: w.t, n: null });
    }
    const ageH = s.last ? Math.max(0, (now - ms(s.last)) / H) : null;
    const len = (g: AuditGap) => ms(g.to) - ms(g.from);
    return {
      id: d.id,
      name: d.name,
      part: s.g,
      first: s.first,
      last: s.last,
      have: s.n,
      missing: d.step ? gaps.reduce((a, g) => a + (g.n ?? 0), 0) : null,
      gapCount: gaps.length,
      gaps: [...gaps].sort((a, b) => len(b) - len(a)).slice(0, GAP_LIST),
      ageH: ageH == null ? null : Math.round(ageH * 10) / 10,
      freshH: d.freshH,
      fresh: ageH != null && ageH <= d.freshH,
      note: d.note,
    };
  });
}

/** R2 に置いたはずのファイルを選んで、実物があるか・大きさが記録どおりか（大きさは置いたものの大きさを記録している表だけ）。 */
async function checkR2(db: Db, bucket: Bucket, n: number): Promise<NonNullable<WeeklyAuditResult["r2"]>> {
  const picked = (
    await db
      .prepare(
        `SELECT key, bytes FROM (
           SELECT key, bytes FROM amedas_saved UNION ALL
           SELECT key, bytes FROM radar_saved UNION ALL
           SELECT key, bytes FROM wxchart_saved UNION ALL
           SELECT key, NULL AS bytes FROM archive_copies UNION ALL
           SELECT r2_key AS key, NULL AS bytes FROM longrange_telegrams
         ) ORDER BY RANDOM() LIMIT ?`,
      )
      .bind(n)
      .all<{ key: string; bytes: number | null }>()
  ).results;
  const missing: string[] = [];
  const wrongSize: string[] = [];
  for (const p of picked) {
    const o = await bucket.get(p.key);
    if (!o) missing.push(p.key);
    else if (p.bytes != null && (await o.arrayBuffer()).byteLength !== p.bytes) wrongSize.push(p.key);
  }
  return { checked: picked.length, missing, wrongSize };
}

/** 表がまだ無い（その保存が一度も動いていない）ときは空として扱う。 */
async function soft<T>(failed: WeeklyAuditResult["failed"], part: string, f: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (!/no such table/i.test(String(e))) failed.push({ part, message: String(e instanceof Error ? e.message : e).slice(0, 200) });
    return empty;
  }
}

/** 点検する（claimWeeklyAudit のあと、または管理者のボタン）。結果は weekly_audit のその行に残す。 */
export async function runWeeklyAudit(db: Db, bucket: Bucket | undefined, now: number, at = new Date(now).toISOString()): Promise<WeeklyAuditResult> {
  await ensureWeeklyAuditSchema(db);
  const failed: WeeklyAuditResult["failed"] = [];
  const series: AuditSeries[] = [];
  for (const d of AUDIT_SERIES) series.push(...(await soft(failed, d.name, () => auditSeries(db, d, now), [])));
  const lost = await soft(failed, "欠けの累計", async () => (await db.prepare("SELECT source, SUM(recovered_at IS NULL) AS lost, SUM(recovered_at IS NOT NULL) AS recovered FROM data_gaps GROUP BY source").all<{ source: string; lost: number; recovered: number }>()).results, []);
  const absent = await soft(failed, "出ていない回", async () => (await db.prepare("SELECT source, COUNT(*) AS n FROM data_absent GROUP BY source").all<{ source: string; n: number }>()).results, []);
  const sources = [...new Set([...lost.map((l) => l.source), ...absent.map((a) => a.source)])].sort();
  const holes = sources.map((source) => {
    const l = lost.find((x) => x.source === source);
    return { source, lost: l?.lost ?? 0, recovered: l?.recovered ?? 0, absent: absent.find((x) => x.source === source)?.n ?? 0 };
  });
  const r2 = bucket ? await soft(failed, "R2 の実物", () => checkR2(db, bucket, R2_SAMPLE), null) : null;
  const result: WeeklyAuditResult = {
    at,
    series,
    holes,
    r2,
    latestOk: series.every((s) => s.fresh),
    historyOk: series.every((s) => !s.gapCount) && !r2?.missing.length && !r2?.wrongSize.length,
    failed,
  };
  const ok = result.latestOk && result.historyOk && !failed.length;
  await db
    .prepare("INSERT INTO weekly_audit (at, done_at, ok, detail) VALUES (?, ?, ?, ?) ON CONFLICT(at) DO UPDATE SET done_at = excluded.done_at, ok = excluded.ok, detail = excluded.detail")
    .bind(at, new Date().toISOString(), ok ? 1 : 0, JSON.stringify(result))
    .run();
  await db.prepare(`DELETE FROM weekly_audit WHERE at NOT IN (SELECT at FROM weekly_audit ORDER BY at DESC LIMIT ${KEEP})`).run();
  return result;
}

/** いちばん新しい点検の結果（まだ終わっていない行は飛ばす）。表が無ければ null。 */
export async function lastWeeklyAudit(db: Db): Promise<{ at: string; result: WeeklyAuditResult } | null> {
  try {
    const r = await db.prepare("SELECT at, detail FROM weekly_audit WHERE detail IS NOT NULL ORDER BY at DESC LIMIT 1").first<{ at: string; detail: string }>();
    return r ? { at: r.at, result: JSON.parse(r.detail) as WeeklyAuditResult } : null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
}

/** 最後に点検を始めた時刻（見張り用。表が無ければ undefined＝まだ判断しない）。 */
export async function weeklyAuditLastAt(db: Db): Promise<string | null | undefined> {
  try {
    const r = await db.prepare("SELECT MAX(done_at) AS at FROM weekly_audit").first<{ at: string | null }>();
    return r?.at ?? null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return undefined;
    throw e;
  }
}

const day = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(ms(iso) + 9 * H);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

/** 毎朝の点検に書く1〜数行。 */
export function weeklyAuditLines(a: { at: string; result: WeeklyAuditResult } | null): string[] {
  if (!a) return ["・週の点検：まだ一度も動いていません。"];
  const r = a.result;
  const late = r.series.filter((s) => !s.fresh);
  const holed = r.series.filter((s) => s.gapCount);
  const out = [
    `・週の点検（${day(a.at)}）：最新 ${late.length ? `遅れ ${late.length}（${late.map((s) => s.name).join("・")}）` : "すべて新しい"}・履歴 ${holed.length ? `抜けのある系列 ${holed.length}（${holed.map((s) => `${s.name}${s.missing != null ? ` ${s.missing}回` : ` ${s.gapCount}か所`}`).join("・")}）` : "抜けなし"}${r.r2 ? `・R2 の実物 ${r.r2.checked - r.r2.missing.length - r.r2.wrongSize.length}/${r.r2.checked}` : ""}`,
  ];
  if (r.failed.length) out.push(`・週の点検で読めなかった部分：${r.failed.map((f) => f.part).join("・")}`);
  return out;
}

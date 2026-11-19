// 今すぐ取り直す（#299 P1、2026-11-19）：管理者が管理画面から、取得の段を1回だけ動かす。
//
// 使うとき：提供元の一覧から間もなく消える欠けがあるとき（雨雲レーダーは約3時間）、定時処理を待たずに取る
// （docs/runbook.md の S1）。定時処理と同じ関数をそのまま1回呼ぶだけで、取り方は変えない（重ならない作りは同じ）。
// 上限：段ごとに1時間に3回まで（気象庁への問い合わせを増やしすぎない）。押した記録（いつ・だれ・どの段・結果）を残す。

import type { Db } from "./accounts";
import { doneOnce } from "./once";
import type { Bucket } from "./r2Archive";
import { saveRadar } from "./radarArchive";
import { collectForecasts } from "./forecastArchive";
import { collectWarnings } from "./warningArchive";
import { collectTyphoons } from "./typhoonArchive";

export const REFETCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS refetch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    ok INTEGER NOT NULL,
    detail TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS refetch_log_stage_at ON refetch_log (stage, at)",
];
const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureRefetchSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of REFETCH_SCHEMA) await db.prepare(q).run();
  });
}

/** 1時間に、段ごとに何回まで。 */
export const REFETCH_PER_HOUR = 3;
const KEEP_DAYS = 90;

export type Stage = {
  id: string;
  name: string;
  /** 提供元の一覧に載っている長さ（これを過ぎると取り戻せない）。 */
  reach: string;
  log: string;
  /** 取り残しの数の列（無い段は null）。 */
  waiting: string | null;
  needsBucket: boolean;
  run: (db: Db, bucket: Bucket | undefined, now: number) => Promise<string>;
};

export const REFETCH_STAGES: Stage[] = [
  {
    id: "radar",
    name: "雨雲レーダー・解析雨量",
    reach: "雨雲 約3時間・解析雨量 約12時間",
    log: "radar_fetch_log",
    waiting: "waiting",
    needsBucket: true,
    run: async (db, bucket, now) => {
      const r = await saveRadar(db, bucket!, now);
      return `${r.saved}枚を保存・残り${r.waiting}枚${r.ok ? "" : "（一部取れなかった）"}`;
    },
  },
  {
    id: "forecast",
    name: "予報の電文",
    reach: "7日",
    log: "forecast_fetch_log",
    waiting: "left_over",
    needsBucket: false,
    run: async (db, _b, now) => {
      const r = await collectForecasts(db, now);
      return `${r.added}通を保存・残り${r.leftOver}通${r.ok ? "" : "（一部取れなかった）"}`;
    },
  },
  {
    id: "warning",
    name: "警報・注意報の電文",
    reach: "7日",
    log: "warning_fetch_log",
    waiting: "left_over",
    needsBucket: false,
    run: async (db, _b, now) => {
      const r = await collectWarnings(db, now);
      return `${r.added}通を保存・残り${r.leftOver}通${r.ok ? "" : "（一部取れなかった）"}`;
    },
  },
  {
    id: "typhoon",
    name: "台風の電文",
    reach: "7日",
    log: "typhoon_fetch_log",
    waiting: null,
    needsBucket: false,
    run: async (db, _b, now) => {
      const r = await collectTyphoons(db, now);
      return `${r.added}通を保存${r.ok ? "" : "（取れなかった）"}`;
    },
  },
];

const hourAgo = (now: number) => new Date(now - 3_600_000).toISOString();

async function one<T>(db: Db, q: string, ...v: unknown[]): Promise<T | null> {
  try {
    return await db.prepare(q).bind(...v).first<T>();
  } catch (e) {
    if (/no such table|no such column/i.test(String(e))) return null;
    throw e;
  }
}

/** 管理画面に出す、段ごとの今の様子：最後に取れた時刻・取り残し・この1時間に押した回数・最後に押した結果。 */
export async function refetchSummary(db: Db, now: number, hasBucket: boolean) {
  await ensureRefetchSchema(db);
  const out = [];
  for (const s of REFETCH_STAGES) {
    const lastOk = await one<{ at: string }>(db, `SELECT MAX(at) AS at FROM ${s.log} WHERE ok = 1`);
    const latest = s.waiting ? await one<{ n: number }>(db, `SELECT ${s.waiting} AS n FROM ${s.log} ORDER BY at DESC LIMIT 1`) : null;
    const used = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM refetch_log WHERE stage = ? AND at >= ?", s.id, hourAgo(now));
    const last = await one<{ at: string; ok: number; detail: string }>(db, "SELECT at, ok, detail FROM refetch_log WHERE stage = ? ORDER BY id DESC LIMIT 1", s.id);
    out.push({
      id: s.id,
      name: s.name,
      reach: s.reach,
      lastOk: lastOk?.at ?? null,
      waiting: latest?.n ?? null,
      usedLastHour: used?.n ?? 0,
      left: Math.max(0, REFETCH_PER_HOUR - (used?.n ?? 0)),
      available: !s.needsBucket || hasBucket,
      last: last ? { at: last.at, ok: last.ok === 1, detail: last.detail } : null,
    });
  }
  return { perHour: REFETCH_PER_HOUR, stages: out };
}

export class RefetchRefused extends Error {}

/** 段を1回だけ動かす。上限を超えたら断る。押した記録を残す（失敗も）。 */
export async function refetchNow(db: Db, bucket: Bucket | undefined, stageId: string, adminId: string, now: number, stages: Stage[] = REFETCH_STAGES) {
  await ensureRefetchSchema(db);
  const s = stages.find((x) => x.id === stageId);
  if (!s) throw new RefetchRefused("その段はありません。");
  if (s.needsBucket && !bucket) throw new RefetchRefused("保存先（R2）がつながっていません。");
  const used = (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM refetch_log WHERE stage = ? AND at >= ?", s.id, hourAgo(now)))?.n ?? 0;
  if (used >= REFETCH_PER_HOUR) throw new RefetchRefused(`${s.name}は1時間に${REFETCH_PER_HOUR}回までです。少し待ってから押してください。`);
  let ok = true;
  let detail: string;
  try {
    detail = await s.run(db, bucket, now);
    ok = !/取れなかった/.test(detail);
  } catch (e) {
    ok = false;
    detail = `失敗：${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
  }
  await db.prepare("INSERT INTO refetch_log (at, admin_id, stage, ok, detail) VALUES (?, ?, ?, ?, ?)").bind(new Date(now).toISOString(), adminId, s.id, ok ? 1 : 0, detail).run();
  await db.prepare("DELETE FROM refetch_log WHERE at < ?").bind(new Date(now - KEEP_DAYS * 86_400_000).toISOString()).run();
  return { stage: s.id, ok, detail };
}

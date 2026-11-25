// データの保守（管理画面、2026-11-19 渡辺さん「日々の運用で使いやすいように」）。
//
// 1つの画面で、毎日の運用に要るものをまとめて読む：今の状態（見張りと同じ判定）、取得の様子と取り直し（refetch.ts）、
// 欠け（completeness）、エラーの記録（文言つき、管理者だけ）、データベースの大きさ。重なりはボタンで確かめる（読むだけ）。
// 何も消さない（消すのは元に戻せないので、中身を見て個別に確かめる決まり）。

import { judgeHealth } from "../../shared/healthJudge";
import type { Db } from "./accounts";
import { health } from "./health";
import type { UsageEnv } from "./usage";
import { ensureRefetchSchema, refetchSummary } from "./refetch";
import { lastWeeklyAudit } from "./weeklyAudit";
import { type ArchiveEnv, offsiteSummary } from "./offsite";

const DAY = 86_400_000;

async function rows<T>(db: Db, q: string, ...v: unknown[]): Promise<T[]> {
  try {
    return (await db.prepare(q).bind(...v).all<T>()).results;
  } catch (e) {
    if (/no such table|no such column/i.test(String(e))) return [];
    throw e;
  }
}

export type ErrorRow = { at: string; where: string; message: string };

/** エラーの記録：アカウントの処理（30日）、定時処理の段（7日）、取得の失敗（7日）。新しい順に `limit` まで。 */
export async function recentErrors(db: Db, now: number, limit = 50): Promise<ErrorRow[]> {
  const week = new Date(now - 7 * DAY).toISOString();
  const out: ErrorRow[] = [];
  for (const r of await rows<{ at: string; place: string; message: string }>(db, "SELECT at, place, message FROM app_errors ORDER BY at DESC LIMIT ?", limit))
    out.push({ at: r.at, where: `アカウント ${r.place}`, message: r.message });
  for (const r of await rows<{ at: string; stage: string; error: string | null }>(db, "SELECT at, stage, error FROM cron_runs WHERE ok = 0 AND at >= ? ORDER BY at DESC LIMIT ?", week, limit))
    out.push({ at: r.at, where: `定時処理 ${r.stage}`, message: r.error ?? "（文言は残っていない）" });
  const LOGS: [string, string][] = [
    ["forecast_fetch_log", "予報の取得"],
    ["warning_fetch_log", "警報の取得"],
    ["typhoon_fetch_log", "台風の取得"],
    ["radar_fetch_log", "雨雲の保存"],
    ["wxchart_fetch_log", "天気図の保存"],
    ["amedas_fetch_log", "アメダスの保存"],
    ["air_quality_fetch_log", "空気質の保存"],
    ["air_forecast_fetch_log", "空気質の予測の取得"],
    ["soramame_fetch_log", "大気汚染の実測の保存"],
    ["longrange_fetch_log", "長い先の予報の取得"],
  ];
  for (const [table, name] of LOGS)
    for (const r of await rows<{ at: string; error: string }>(db, `SELECT at, error FROM ${table} WHERE ok = 0 AND error IS NOT NULL AND at >= ? ORDER BY at DESC LIMIT ?`, week, limit))
      out.push({ at: r.at, where: name, message: r.error });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

/** 段ごとの、まだ取り戻せる欠けの数（予報・雨雲）。 */
const pendingOf = (c: { forecast?: Record<string, { pendingCount?: number }>; radar?: Record<string, { pendingCount?: number }> } | undefined) => ({
  forecast: Object.values(c?.forecast ?? {}).reduce((n, a) => n + (a.pendingCount ?? 0), 0),
  radar: Object.values(c?.radar ?? {}).reduce((n, a) => n + (a.pendingCount ?? 0), 0),
});

/** 管理画面「データの保守」の中身（読むだけ）。 */
export async function maintenanceSummary(db: Db, now: number, env: UsageEnv & ArchiveEnv & { hasBucket: boolean }) {
  // 1つが失敗しても画面は出す（2026-11-19、実機で全体が「処理に失敗しました」になった）：部分ごとに受け止め、
  // 失敗した部分と文言を failed に並べる（それ自体が保守の手がかり）。
  const failed: { part: string; message: string }[] = [];
  const part = async <T>(name: string, f: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      failed.push({ part: name, message: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300) });
      return empty;
    }
  };
  const h = await part("今の状態", () => health(db, now, env), null);
  const judged = h ? await part("判定", async () => judgeHealth(h as never, now), { problems: [], notes: [] } as ReturnType<typeof judgeHealth>) : { problems: [], notes: [] };
  const lastDup = await part("重なり", () => rows<{ at: string; detail: string }>(db, "SELECT at, detail FROM refetch_log WHERE stage = 'dupcheck' ORDER BY id DESC LIMIT 1"), []);
  const lastAudit = await part("表の点検", () => rows<{ at: string; detail: string }>(db, "SELECT at, detail FROM refetch_log WHERE stage = 'audit' ORDER BY id DESC LIMIT 1"), []);
  const refetch = await part("取得の様子", () => refetchSummary(db, now, env.hasBucket, pendingOf(h?.state.completeness)), { perHour: 0, stages: [] } as Awaited<ReturnType<typeof refetchSummary>>);
  const errors = await part("エラーの記録", () => recentErrors(db, now), [] as ErrorRow[]);
  const weekly = await part("週の点検", () => lastWeeklyAudit(db), null);
  const offsite = await part("GitHub の控え", () => offsiteSummary(db, now, env), null);
  return {
    at: new Date(now).toISOString(),
    failed,
    judged,
    refetch,
    completeness: h?.state.completeness,
    errors,
    room: h ? { d1Size: h.room.d1Size, d1WritesMonth: h.room.d1WritesMonth, r2: { bytes: h.room.r2.bytes, percentOfFree: h.room.r2.percentOfFree }, cronRunsLastDay: h.room.cron.runsLastDay, cronMissing: h.room.cron.missing } : null,
    lastDupCheck: lastDup[0] ? { at: lastDup[0].at, result: JSON.parse(lastDup[0].detail) as DupItem[] } : null,
    lastAudit: lastAudit[0] ? { at: lastAudit[0].at, result: JSON.parse(lastAudit[0].detail) as AuditResult } : null,
    weeklyAudit: weekly,
    offsite,
  };
}

/** 日本時間の「11/9 11:00」（日本時間の ISO も UTC の ISO も）。 */
const short = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export type DupItem = { name: string; n: number; examples: string[]; note?: string };

/**
 * 重なりを確かめる（読むだけ、何も消さない）。
 * - 電文（予報・警報・台風）：中身（hash）が同じなのに別の行 → 重なり
 * - 予報の電文：同じ種類・予報区・発表時刻に2通以上 → 疑い（気象庁の訂正報で正しく2通のこともある）
 * - 予報の読み取り：同じ予報区・種類・発表時刻で、表に使う発表（preferred）が2つ以上 → 重なり
 * - 雨雲・解析雨量（3日分）：1つの時刻（解析雨量はメンバーごと）に9枚より多い → 重なり
 * - 肌感の記録：同じ人・同じ時刻・同じ中身が2件以上（消したものは除く）→ 重なり（送り直しの重なり）
 */
export async function dupCheck(db: Db, now: number, adminId: string): Promise<DupItem[]> {
  const out: DupItem[] = [];
  for (const [table, name] of [
    ["forecast_telegrams", "予報の電文（同じ中身）"],
    ["warning_telegrams", "警報の電文（同じ中身）"],
    ["typhoon_telegrams", "台風の電文（同じ中身）"],
  ] as const) {
    const r = await rows<{ hash: string; n: number; first: string | null }>(db, `SELECT hash, COUNT(*) AS n, MIN(issued_at) AS first FROM ${table} GROUP BY hash HAVING COUNT(*) > 1 ORDER BY first DESC LIMIT 20`);
    out.push({ name, n: r.length, examples: r.slice(0, 3).map((x) => `${short(x.first)}（${x.n}行）`) });
  }
  const same = await rows<{ kind: string; issued_at: string; n: number }>(db, "SELECT kind, issued_at, COUNT(*) AS n FROM forecast_telegrams GROUP BY kind, office, issued_at HAVING COUNT(*) > 1 ORDER BY issued_at DESC LIMIT 20");
  out.push({ name: "予報の電文（同じ発表時刻に2通以上）", n: same.length, examples: same.slice(0, 3).map((x) => `${x.kind} ${short(x.issued_at)}（${x.n}通）`), note: "訂正報で正しく2通のこともある" });
  const pref = await rows<{ kind: string; issued_at: string; n: number }>(db, "SELECT kind, issued_at, COUNT(*) AS n FROM forecast_issues WHERE preferred = 1 GROUP BY office, kind, issued_at HAVING COUNT(*) > 1 ORDER BY issued_at DESC LIMIT 20");
  out.push({ name: "予報の読み取り（表に使う発表が2つ）", n: pref.length, examples: pref.slice(0, 3).map((x) => `${x.kind} ${short(x.issued_at)}（${x.n}）`) });
  const tiles = await rows<{ key: string }>(db, "SELECT key FROM radar_saved WHERE valid_at >= ?", new Date(now - 3 * DAY + 9 * 3_600_000).toISOString().slice(0, 19));
  const per = new Map<string, number>();
  for (const t of tiles) {
    const g = t.key.split("/").slice(0, -3).join("/");
    per.set(g, (per.get(g) ?? 0) + 1);
  }
  const over = [...per].filter(([, n]) => n > 9);
  out.push({ name: "雨雲・解析雨量（1つの時刻に9枚より多い、3日分）", n: over.length, examples: over.slice(0, 3).map(([g, n]) => `${g.split("/").slice(1).join("/")}（${n}枚）`) });
  const rep = await rows<{ at: string; n: number }>(db, "SELECT at, COUNT(*) AS n FROM reports WHERE deleted = 0 GROUP BY user_id, at, body HAVING COUNT(*) > 1 ORDER BY at DESC LIMIT 20");
  out.push({ name: "肌感の記録（同じ人・時刻・中身が2件以上）", n: rep.length, examples: rep.slice(0, 3).map((x) => `${short(x.at)}（${x.n}件）`) });
  await ensureRefetchSchema(db);
  await db.prepare("INSERT INTO refetch_log (at, admin_id, stage, ok, detail) VALUES (?, ?, 'dupcheck', ?, ?)").bind(new Date(now).toISOString(), adminId, out.some((x) => x.n && !x.note) ? 0 : 1, JSON.stringify(out)).run();
  return out;
}

export type AuditResult = { tables: { name: string; rows: number }[]; links: { name: string; n: number }[] };

/**
 * 表の点検（読むだけ、DB 設計の提案への回答④「現状監査」）：表ごとの行数と、表どうしのつながりが切れていないか。
 * つながり：予報の値 → その発表、自前の発表 → その電文、R2 の写しの記録 → その電文、肌感の記録・ログイン・通知の設定・
 * 端末 → その人。全部の表を数えるので、ボタンで押したときだけ（毎回は読まない）。
 */
export async function tableAudit(db: Db, now: number, adminId: string): Promise<AuditResult> {
  const names = (await rows<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).map((r) => r.name);
  const tables: AuditResult["tables"] = [];
  for (const name of names) {
    const r = await rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "${name.replace(/"/g, "")}"`);
    tables.push({ name, rows: r[0]?.n ?? 0 });
  }
  const LINKS: [string, string][] = [
    ["予報の値で、もとの発表が無い", "SELECT COUNT(*) AS n FROM forecast_entries e WHERE NOT EXISTS (SELECT 1 FROM forecast_issues i WHERE i.issue_id = e.issue_id)"],
    ["自前の発表で、もとの電文が無い", "SELECT COUNT(*) AS n FROM forecast_issues i WHERE i.source = 'jma-xml' AND NOT EXISTS (SELECT 1 FROM forecast_telegrams t WHERE t.id = i.issue_id)"],
    ["R2 の写しの記録で、もとの電文が無い（予報）", "SELECT COUNT(*) AS n FROM archive_copies c WHERE c.source = 'forecast' AND NOT EXISTS (SELECT 1 FROM forecast_telegrams t WHERE t.id = c.id)"],
    ["R2 の写しの記録で、もとの電文が無い（台風）", "SELECT COUNT(*) AS n FROM archive_copies c WHERE c.source = 'typhoon' AND NOT EXISTS (SELECT 1 FROM typhoon_telegrams t WHERE t.id = c.id)"],
    ["R2 の写しの記録で、もとの電文が無い（警報）", "SELECT COUNT(*) AS n FROM archive_copies c WHERE c.source = 'warning' AND NOT EXISTS (SELECT 1 FROM warning_telegrams t WHERE t.id = c.id)"],
    ["肌感の記録で、人がいない", "SELECT COUNT(*) AS n FROM reports r WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)"],
    ["ログインで、人がいない", "SELECT COUNT(*) AS n FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)"],
    ["通知の設定で、人がいない", "SELECT COUNT(*) AS n FROM notify_settings s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)"],
    ["通知の端末で、人がいない", "SELECT COUNT(*) AS n FROM push_subscriptions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)"],
    // 独立レビュー（2026-11-19）：schema_version に1行の制約は無い（D1 は書き込みを順に処理し、1文の INSERT … WHERE NOT EXISTS
    // は割り込まれないので実害は無い見込み）。表を作り直す代わりに、1行かどうかを見張る。1行なら 0、違えばその行数。
    ["アカウントの表の版（schema_version）が1行でない", "SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE COUNT(*) END AS n FROM schema_version"],
  ];
  const links: AuditResult["links"] = [];
  for (const [name, q] of LINKS) {
    const r = await rows<{ n: number }>(db, q);
    if (r.length) links.push({ name, n: r[0].n });
  }
  const out = { tables, links };
  await ensureRefetchSchema(db);
  await db.prepare("INSERT INTO refetch_log (at, admin_id, stage, ok, detail) VALUES (?, ?, 'audit', ?, ?)").bind(new Date(now).toISOString(), adminId, links.some((l) => l.n) ? 0 : 1, JSON.stringify(out)).run();
  return out;
}

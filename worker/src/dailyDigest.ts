// 毎朝の点検 (2026-11-18 渡辺さん「毎日動いているデータの取得などが問題なく行われているかをスケジュールで確認」)：
// 毎時の見張り（healthWatch.ts）の、朝7時（日本時間）より後の最初の1回で、この24時間の取得のまとめを
// 管理者に1通だけ知らせる。異常は始まったとき・直ったときに別に知らせる（そちらはそのまま）。これは
// 「問題なく動いている」ことも毎日分かるようにするためのもの。
// 1日1通：health_alerts に `daily:YYYY-MM-DD`（日本時間の日付）を1回だけ取る（閉じた行として。開いている
// 警告にはならない）。7〜10時のうちに見張りが1回も無かった日は送らない（昼に遅れて届かないように）。
// 中身は記録の回数だけ（成功した回／全部の回、新しく保存した数）。表がまだ無い取得は行を出さない。

import { type Finding, gapText } from "../../shared/healthJudge";
import { runbookTag } from "../../shared/runbook";
import type { Db } from "./accounts";
import { cronGaps } from "./health";
import type { Message } from "./notify";

/** 送る時間帯（日本時間の時）：7時から10時の前まで。 */
export const DIGEST_FROM_HOUR = 7;
export const DIGEST_UNTIL_HOUR = 10;

const SOURCES = [
  { table: "forecast_fetch_log", name: "予報の電文", added: "added", unit: "通" },
  { table: "typhoon_fetch_log", name: "台風の電文", added: "added", unit: "通" },
  { table: "warning_fetch_log", name: "警報・注意報の電文", added: "added", unit: "通" },
  { table: "longrange_fetch_log", name: "長い先の予報の電文", added: "added", unit: "通" },
  { table: "wxchart_fetch_log", name: "天気図", added: "saved", unit: "枚" },
  { table: "radar_fetch_log", name: "雨雲レーダー・解析雨量", added: "saved", unit: "枚" },
] as const;

export interface DigestLine {
  name: string;
  runs: number;
  ok: number;
  added: number;
  unit: string;
}

const jstParts = (now: number) => {
  const d = new Date(now + 9 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
};

/** この24時間の、取得ごとの回数（表が無いものは出さない）と、毎時の見張りの回数。 */
export async function digestLines(db: Db, now: number): Promise<DigestLine[]> {
  const from = new Date(now - 24 * 3_600_000).toISOString();
  const to = new Date(now).toISOString();
  const out: DigestLine[] = [];
  for (const s of SOURCES) {
    try {
      const r = await db
        .prepare(`SELECT COUNT(*) AS runs, COALESCE(SUM(ok), 0) AS ok, COALESCE(SUM(${s.added}), 0) AS added FROM ${s.table} WHERE at >= ? AND at < ?`)
        .bind(from, to)
        .first<{ runs: number; ok: number; added: number }>();
      out.push({ name: s.name, runs: r?.runs ?? 0, ok: r?.ok ?? 0, added: r?.added ?? 0, unit: s.unit });
    } catch (e) {
      if (!/no such table/i.test(String(e))) throw e;
    }
  }
  const looks = await db
    .prepare("SELECT COUNT(*) AS runs, COUNT(done_at) AS ok FROM health_checks WHERE at >= ? AND at < ?")
    .bind(from, to)
    .first<{ runs: number; ok: number }>();
  out.push({ name: "毎時の見張り", runs: looks?.runs ?? 0, ok: looks?.ok ?? 0, added: 0, unit: "" });
  return out;
}

/**
 * 定時処理の回数と抜け、アカウントの処理の失敗（いちばん多い文言3つまで、回数と時刻の幅）。失敗の文言は
 * 公開の /api/health や GitHub の issue には出さず、管理者だけに届くこの知らせにだけ書く（原因を見るため）。
 */
export async function digestExtra(db: Db, now: number): Promise<string[]> {
  const from = new Date(now - 24 * 3_600_000).toISOString();
  const to = new Date(now).toISOString();
  const out: string[] = [];
  try {
    const ats = (await db.prepare("SELECT DISTINCT at FROM cron_runs WHERE at >= ? AND at < ?").bind(from, to).all<{ at: string }>()).results.map((r) => r.at);
    const g = cronGaps(ats, now);
    out.push(`・定時処理（5分ごと）：${288 - g.missing}回／288回${g.missing ? `。${gapText(g.gaps)}` : ""}`);
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  }
  try {
    const errs = (
      await db
        .prepare("SELECT substr(message, 1, 80) AS m, COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last, group_concat(DISTINCT place) AS places FROM app_errors WHERE at >= ? AND at < ? GROUP BY m ORDER BY n DESC LIMIT 3")
        .bind(from, to)
        .all<{ m: string; n: number; first: string; last: string; places: string }>()
    ).results;
    const clock = (iso: string) => {
      const d = new Date(Date.parse(iso) + 9 * 3_600_000);
      return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    };
    for (const e of errs) out.push(`・アカウントの処理の失敗 ${e.n}回（${clock(e.first)}〜${clock(e.last)}、${e.places.split(",").slice(0, 3).join("・")}）：${e.m}`);
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  }
  return out;
}

/** まとめの文（純粋な関数）。題は異常・気づいたことの数で変える。 */
export function digestMessage(lines: DigestLine[], problems: Finding[], notes: Finding[], extra: string[] = []): Message {
  const failing = lines.filter((l) => l.runs > 0 && l.ok < l.runs);
  const idle = lines.filter((l) => l.runs === 0);
  const title = problems.length
    ? `毎朝の点検：異常が${problems.length}件あります`
    : failing.length || idle.length
      ? "毎朝の点検：うまくいかなかった回があります"
      : notes.length
        ? `毎朝の点検：問題なし（気づいたこと${notes.length}件）`
        : "毎朝の点検：問題なし";
  const row = (l: DigestLine) =>
    l.runs === 0
      ? `・${l.name}：この24時間に1回も動いていません`
      : `・${l.name}：${l.runs}回中${l.ok}回うまくいった${l.unit ? `（新しく${l.added}${l.unit}）` : ""}`;
  const body = [
    ...lines.map(row),
    ...extra,
    ...problems.map((f) => `・異常：${f.text}${runbookTag(f.key)}`),
    ...notes.map((f) => `・気づいたこと：${f.text}${runbookTag(f.key)}`),
  ].join("\n");
  return { title, body, url: "/", tag: "weather-note-daily-digest" };
}

/** 送る時間帯で、今日まだ送っていなければ、送る日を取る（1回だけ true）。 */
export async function claimDigest(db: Db, now: number): Promise<string | null> {
  const { date, hour } = jstParts(now);
  if (hour < DIGEST_FROM_HOUR || hour >= DIGEST_UNTIL_HOUR) return null;
  const at = new Date(now).toISOString();
  const key = `daily:${date}`;
  const r = await db
    .prepare("INSERT OR IGNORE INTO health_alerts (key, kind, opened_at, closed_at, detail) VALUES (?, 'daily', ?, ?, '')")
    .bind(key, at, at)
    .run();
  return r.meta.changes ? key : null;
}

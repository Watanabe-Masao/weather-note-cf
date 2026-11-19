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
import { readCompleteness } from "./completeness";
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
export type CloudflareRuns =
  | { ok: true; empty: boolean; runs: number; byStatus: Record<string, number>; cpuMaxMs: number; startedNotKept?: number; notStarted?: number }
  | { ok: false; error: string };
export async function digestExtra(db: Db, now: number, cf?: CloudflareRuns): Promise<string[]> {
  const from = new Date(now - 24 * 3_600_000).toISOString();
  const to = new Date(now).toISOString();
  const out: string[] = [];
  try {
    const ats = (await db.prepare("SELECT DISTINCT at FROM cron_runs WHERE at >= ?").bind(new Date(now - 36 * 3_600_000).toISOString()).all<{ at: string }>()).results.map((r) => r.at);
    const g = cronGaps(ats, now);
    const hm = (iso: string) => {
      const d = new Date(Date.parse(iso) + 9 * 3_600_000);
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    };
    // 母数は決まった窓の288回（health.ts cronGaps）。記録が無い回は「始まらなかった」とは限らない（D1 に書けなかったかもしれない）。
    out.push(`・定時処理（5分ごと、${hm(g.window.from)}〜${hm(g.window.to)} の288回）：記録あり ${g.kept}回${g.missing ? `。記録の無い回：${gapText(g.gaps).replace(/^抜けた時間：/, "")}` : ""}`);
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  }
  // Cloudflare 自身の記録（D1 とは別）：始めた回・状態、D1 に残らなかった回、始まらなかった回。空や読めないときはそう書く（0回と言わない）。
  if (cf)
    out.push(
      !cf.ok
        ? `・Cloudflare の記録：読めませんでした（${cf.error.slice(0, 80)}）`
        : cf.empty
          ? "・Cloudflare の記録：空でした（Cloudflare 側でまだ取り込まれていないことがあります。0回という意味ではありません）"
          : `・Cloudflare の記録：始めた回 ${cf.runs}回（${Object.entries(cf.byStatus).map(([k, n]) => `${k} ${n}`).join("・")}）・計算時間の最長 ${cf.cpuMaxMs}ms。始めたのに D1 に残らなかった回 ${cf.startedNotKept ?? 0}・始まらなかった回 ${cf.notStarted ?? 0}`,
    );
  // 雨雲レーダー・解析雨量（radarArchive.ts）：30分ごとの時刻が、9枚そろって残っているか。気象庁の一覧から外れた
  // 時刻は取り戻せないので、抜けた時刻を書く（データが欠けたことが分かるように）。今から1時間以内の時刻は、まだ
  // 取り込みの途中かもしれないので数えない。
  try {
    const jst = (ms: number) => `${new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;
    const end = Math.floor((now - 3_600_000) / 1_800_000) * 1_800_000; // the last half hour counted
    const start = end - 47 * 1_800_000; // 48 times
    const rows = (
      await db
        .prepare("SELECT substr(key, 7, 5) AS product, valid_at, COUNT(*) AS n FROM radar_saved WHERE valid_at >= ? AND valid_at <= ? GROUP BY product, valid_at")
        .bind(jst(start), jst(end))
        .all<{ product: string; valid_at: string; n: number }>()
    ).results;
    if (rows.length) {
      for (const [product, name] of [
        ["hrpns", "雨雲レーダー"],
        ["rasrf", "解析雨量"],
      ] as const) {
        const full = new Set(rows.filter((r) => r.product === product && r.n >= 9).map((r) => r.valid_at));
        const lost: string[] = [];
        for (let t = start; t <= end; t += 1_800_000) if (!full.has(jst(t))) lost.push(jst(t).slice(11, 16).replace(/^0/, ""));
        out.push(`・${name}の保存：48時刻中${48 - lost.length}時刻${lost.length ? `（欠けた時刻：${lost.slice(0, 6).join("・")}${lost.length > 6 ? " ほか" : ""}）` : "（欠けなし）"}`);
      }
    }
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
  }
  // 欠けの発見（completeness.ts）：予報の定時の発表が1回ずつそろっているか、続けて確かめられた位置、取り戻せない欠け。
  try {
    const c = await readCompleteness(db, now);
    const NAME: Record<string, string> = { VPFD51: "府県天気予報", VPFW50: "府県週間天気予報", hrpns: "雨雲レーダー", rasrf: "解析雨量" };
    const at = (iso: string) => {
      const d = new Date(Date.parse(iso) + 9 * 3_600_000);
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    };
    for (const [k, a] of Object.entries(c.forecast)) {
      if (!a.expected) continue;
      const gaps = [a.pendingCount ? `まだ取り戻せる ${a.pendingCount}（${a.pending.slice(0, 3).map(at).join("・")}）` : "", a.lostCount ? `取り戻せない ${a.lostCount}` : ""].filter(Boolean).join("・");
      out.push(`・${NAME[k] ?? k}の定時の発表：${a.expected}回中${a.kept}回${a.watermark ? `（続けて確かめられた位置 ${at(a.watermark)}）` : ""}${gaps ? `。欠け：${gaps}` : ""}${a.absentCount ? `。気象庁が出していない回 ${a.absentCount}（${a.absent.slice(0, 3).map(at).join("・")}）` : ""}`);
    }
    const absentAll = c.absentAll.reduce((n, l) => n + l.n, 0);
    if (absentAll) out.push(`・気象庁が出していない回（これまで、欠けではない）：${c.absentAll.map((l) => `${l.source.replace(/^(forecast|radar):/, "")} ${l.n}`).map((x) => x.replace(/^(\w+)/, (m) => NAME[m] ?? m)).join("・")}`);
    const lostAll = c.lostAll.reduce((n, l) => n + l.n, 0);
    if (lostAll) out.push(`・取り戻せない欠け（これまで）：${c.lostAll.map((l) => `${l.source.replace(/^(forecast|radar):/, "")} ${l.n}`).map((x) => x.replace(/^(\w+)/, (m) => NAME[m] ?? m)).join("・")}`);
  } catch (e) {
    console.error("weather-note: digest completeness", e);
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

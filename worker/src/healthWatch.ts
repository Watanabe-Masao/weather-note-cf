// 毎時の見張り (2026-11-17): /api/health judged inside the Worker's 5-minute run, once an hour — the
// GitHub Actions job (health.yml, hourly) never ran on its schedule, so the judging and the telling
// moved here. health.yml is left as it is, as a record and for a run by hand.
//
// Once an hour: a run takes the hour when no look was taken in the 60 minutes before it (claimHealthWatch,
// one statement, so two runs never both take it). The look reads health() itself (the same reads as
// /api/health, Cloudflare's usage included) and asks the record once, as health-check.mjs does — no more
// requests out than that — and judges it with shared/healthJudge.ts (the same judgment as the script).
//
// Told to the administrators (tellAdmins, as forecastWatch.ts): a problem (異常) when it starts and when
// it is over, never again while it stays open — the open ones are kept in health_alerts (the same
// columns and the same "open once, close once" claim as forecast_alerts; a closed key is renamed
// `${key}@${opened_at}` so a later one opens a new row). Notes (気づいたこと) are counted, not told.
// One happening, one notification (#271): what another watch already tells is judged and counted here
// but not told — see toldElsewhere.
// 取り込める月 (#262): told once when the record has the month to take next (its row, `import:YYYY-MM`,
// is kept closed, so it is never told again and is never an open alert). The issue on GitHub stays.
//
// Each look is kept in health_checks (counts and times only), and /api/health gives the last one.

import { checkImport, judgeHealth, type Finding, type ImportReady } from "../../shared/healthJudge";
import type { Db } from "./accounts";
import { health } from "./health";
import type { Message } from "./notify";
import { tellAdmins } from "./typhoonWatch";
import type { UsageEnv } from "./usage";
import { sendPush } from "./webpush";

export const HEALTH_WATCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS health_checks (
    at TEXT PRIMARY KEY,
    done_at TEXT,
    problems INTEGER,
    notes INTEGER,
    opened INTEGER,
    closed INTEGER,
    sent INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS health_alerts (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    detail TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0
  )`,
];

/**
 * Problems another watch already tells (#271, 「1つの出来事には1つの知らせ」): judged and counted
 * (health_checks, /api/health), not told nor kept open here.
 *   alert:*        an open alert of the forecast or typhoon watch (forecastWatch.ts, typhoonWatch.ts);
 *   forecastStale  the forecast feed not read — forecastWatch.ts's 「取得失敗」.
 */
export const toldElsewhere = (key: string) => key === "forecastStale" || key.startsWith("alert:");

/** A look is taken when none was taken in this long before. */
export const HEALTH_WATCH_EVERY_MS = 60 * 60_000;
const KEEP_DAYS = 30;

const ready = new WeakMap<Db, Promise<void>>();
export function ensureHealthWatchSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      for (const q of HEALTH_WATCH_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

/** Whether this run takes the hour's look (and, if so, it is taken: kept in health_checks). */
export async function claimHealthWatch(db: Db, now: number): Promise<boolean> {
  await ensureHealthWatchSchema(db);
  const r = await db
    .prepare("INSERT OR IGNORE INTO health_checks (at) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM health_checks WHERE at > ?)")
    .bind(new Date(now).toISOString(), new Date(now - HEALTH_WATCH_EVERY_MS).toISOString())
    .run();
  return (r.meta.changes ?? 0) > 0;
}

type Send = typeof sendPush;
type Head = Parameters<typeof checkImport>[1];
type UsageFetch = Parameters<typeof health>[3];

const msg = (title: string, body: string): Message => ({ title, body, url: "/", tag: "weather-note-health-watch" });
const list = (fs: string[]) => fs.map((t) => `・${t}`).join("\n");

export interface HealthWatchResult {
  problems: number;
  notes: number;
  opened: string[];
  closed: string[];
  importTold: string | null;
  sent: number;
}

/** The hour's look (after claimHealthWatch): judge, tell what started and what is over, keep the counts. */
export async function watchHealth(
  db: Db,
  now = Date.now(),
  env: UsageEnv = {},
  deps: { send?: Send; head?: Head; usageFetch?: UsageFetch } = {},
): Promise<HealthWatchResult> {
  await ensureHealthWatchSchema(db);
  const send = deps.send ?? sendPush;
  const at = new Date(now).toISOString();
  const h = await health(db, now, env, deps.usageFetch);
  const importReady: ImportReady | null = h.state.forecastImport
    ? await checkImport(h.state.forecastImport, deps.head ?? fetch, "weather-note health (Cloudflare Worker)")
    : null;
  const judged = judgeHealth(h, now, importReady);

  const open = new Map(
    (await db.prepare("SELECT key, opened_at, detail FROM health_alerts WHERE kind = 'problem' AND closed_at IS NULL").all<{ key: string; opened_at: string; detail: string }>()).results.map(
      (r) => [r.key, r],
    ),
  );
  // Opened: each claimed once (an open one is not told again).
  const told = judged.problems.filter((f) => !toldElsewhere(f.key));
  const newly: Finding[] = [];
  for (const f of told) {
    const claim = await db
      .prepare("INSERT OR IGNORE INTO health_alerts (key, kind, opened_at, closed_at, detail) VALUES (?, 'problem', ?, NULL, ?)")
      .bind(f.key, at, f.text)
      .run();
    if (claim.meta.changes) newly.push(f);
  }
  // Over: every open problem not found in this look (each closed by one run only).
  const still = new Set(told.map((f) => f.key));
  const over: { key: string; text: string }[] = [];
  for (const [key, r] of open) {
    if (still.has(key)) continue;
    const done = await db
      .prepare("UPDATE health_alerts SET closed_at = ?, key = ? WHERE key = ? AND closed_at IS NULL")
      .bind(at, `${key}@${r.opened_at}`, key)
      .run();
    if (done.meta.changes) over.push({ key, text: r.detail });
  }

  let sent = 0;
  if (newly.length) {
    const n = await tellAdmins(db, msg(`監視：異常が${newly.length}件あります`, list(newly.map((f) => f.text))), now, send);
    sent += n;
    for (const f of newly) await db.prepare("UPDATE health_alerts SET sent = ? WHERE key = ?").bind(n, f.key).run();
  }
  if (over.length) sent += await tellAdmins(db, msg(`監視：${over.length}件 直りました`, list(over.map((f) => `直りました：${f.text}`))), now, send);

  // 取り込める月 (#262): once, when the record has it.
  let importTold: string | null = null;
  if (importReady?.next && importReady.available === true) {
    const key = `import:${importReady.next}`;
    const claim = await db
      .prepare("INSERT OR IGNORE INTO health_alerts (key, kind, opened_at, closed_at, detail) VALUES (?, 'import', ?, ?, ?)")
      .bind(key, at, at, `取り込める月があります：${importReady.next}`)
      .run();
    if (claim.meta.changes) {
      importTold = importReady.next;
      const n = await tellAdmins(
        db,
        msg(
          `取り込める月があります：${importReady.next}`,
          `外部の記録に ${importReady.next} の予報が入りました。管理画面の「予報の履歴：過去の記録の取り込み」から取り込んでください（自動では取り込みません）。`,
        ),
        now,
        send,
      );
      sent += n;
      await db.prepare("UPDATE health_alerts SET sent = ? WHERE key = ?").bind(n, key).run();
    }
  }

  await db
    .prepare("UPDATE health_checks SET done_at = ?, problems = ?, notes = ?, opened = ?, closed = ?, sent = ? WHERE at = ?")
    .bind(new Date().toISOString(), judged.problems.length, judged.notes.length, newly.length, over.length, sent, at)
    .run();
  await db.prepare("DELETE FROM health_checks WHERE at < ?").bind(new Date(now - KEEP_DAYS * 86_400_000).toISOString()).run();
  return { problems: judged.problems.length, notes: judged.notes.length, opened: newly.map((f) => f.key), closed: over.map((f) => f.key), importTold, sent };
}

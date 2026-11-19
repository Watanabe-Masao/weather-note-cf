// 止まったら知らせる (#220, レビュー2「監視」): the typhoon sources watched by the scheduled run, and the
// administrators told by a notification when one stops or no longer reads — once when it starts, once
// when it is over. A telegram not kept is gone for good after JMA's 7 days, and a form that changed
// quietly shows as「台風なし」, so neither is left to be found by chance. Each alert is a row
// (typhoon_alerts): opened, closed, and what was seen, so a run of them can be read back.
//
// Decided before any alert was seen (2026-11-16):
//  collector   the telegram feed has not been read for 60 minutes (the runs fail)
//  problems    a telegram kept could not be read in full (told once per telegram)
//  json        JMA's typhoon JSON (the card) failed 3 times in a row
//  mismatch    the telegrams have a typhoon (issued within 6 hours, not ended) that the JSON read just
//              after does not have — the JSON's form may have changed
// The scheduled run itself stopping cannot be told from inside it: /api/admin/typhoon-archive shows
// when it last ran.

import type { Db } from "./accounts";
import { runbookTag } from "../../shared/runbook";
import { type Message, sendToUser } from "./notify";
import { ensureTyphoonSchema } from "./typhoonArchive";
import { sendPush } from "./webpush";
import { doneOnce } from "./once";

export const TYPHOON_WATCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS typhoon_json_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    numbers TEXT NOT NULL,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS typhoon_alerts (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    detail TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0
  )`,
];

export const COLLECTOR_STOP_MS = 60 * 60_000;
export const JSON_FAILS = 3;
export const FRESH_MS = 6 * 3_600_000;
const LOG_DAYS = 400;

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureWatchSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    await ensureTyphoonSchema(db);
    for (const q of TYPHOON_WATCH_SCHEMA) await db.prepare(q).run();
  });
}

/** One read of JMA's typhoon JSON by /api/typhoon (a cache miss): whether it read, and the typhoons it had. */
export async function logTyphoonJson(
  db: Db,
  r: { ok: boolean; numbers: number[]; error?: string | null },
  now = Date.now(),
): Promise<void> {
  await ensureWatchSchema(db);
  await db
    .prepare(
      "INSERT OR REPLACE INTO typhoon_json_log (at, ok, numbers, error) VALUES (?, ?, ?, ?)",
    )
    .bind(
      new Date(now).toISOString(),
      r.ok ? 1 : 0,
      r.numbers.join(","),
      r.error ?? null,
    )
    .run();
}

type Send = typeof sendPush;
const hhmm = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16);
const minutes = (ms: number) =>
  ms >= 3_600_000
    ? `${Math.floor(ms / 3_600_000)}時間${Math.round((ms % 3_600_000) / 60_000)}分`
    : `${Math.round(ms / 60_000)}分`;

interface Found {
  key: string;
  kind: string;
  detail: string;
  open: Message;
  /** Told once and closed at once (a telegram that could not be read); the others are told again when over (closers). */
  oneOff?: boolean;
}

const msg = (title: string, body: string): Message => ({
  title,
  body,
  url: "/",
  tag: "weather-note-typhoon-watch",
});

/** What is wrong now, as of `now`. */
async function lookNow(
  db: Db,
  now: number,
): Promise<{ found: Found[]; watched: Set<string> }> {
  const found: Found[] = [];
  // Which keys this look can speak for (an open alert whose key is watched and not found is over).
  const watched = new Set<string>(["collector", "json", "mismatch"]);

  // collector
  const last = await db
    .prepare("SELECT at, ok FROM typhoon_fetch_log ORDER BY at DESC LIMIT 1")
    .first<{ at: string; ok: number }>();
  if (last && !last.ok) {
    const lastOk = await db
      .prepare(
        "SELECT at FROM typhoon_fetch_log WHERE ok = 1 ORDER BY at DESC LIMIT 1",
      )
      .first<{ at: string }>();
    const since = lastOk
      ? Date.parse(lastOk.at)
      : Date.parse(
          (await db
            .prepare("SELECT MIN(at) AS at FROM typhoon_fetch_log")
            .first<{ at: string }>())!.at,
        );
    if (now - since >= COLLECTOR_STOP_MS) {
      const err =
        (
          await db
            .prepare(
              "SELECT error FROM typhoon_fetch_log WHERE ok = 0 ORDER BY at DESC LIMIT 1",
            )
            .first<{ error: string | null }>()
        )?.error ?? "";
      found.push({
        key: "collector",
        kind: "collector",
        detail: `最後に読めた：${lastOk?.at ?? "なし"}／${err}`,
        open: msg(
          "台風の電文が取れていません",
          `気象庁のXMLフィードが${minutes(now - since)}読めていません（最後に読めたのは ${lastOk ? hhmm(lastOk.at) : "—"}）。7日を過ぎた電文は取り戻せません。`,
        ),
      });
    }
  }

  // problems: telegrams kept (fetched in the last day) that could not be read in full.
  const bad = await db
    .prepare(
      "SELECT id, number, problems FROM typhoon_telegrams WHERE problems IS NOT NULL AND fetched_at >= ? ORDER BY fetched_at",
    )
    .bind(new Date(now - 86_400_000).toISOString())
    .all<{ id: string; number: string | null; problems: string }>();
  for (const b of bad.results) {
    found.push({
      key: `problems:${b.id}`,
      kind: "problems",
      detail: b.problems,
      open: msg(
        "読めない台風の電文があります",
        `${b.number ? `台風${Number(b.number.slice(-2))}号の` : ""}電文 ${b.id}：${b.problems}。電文はそのまま残しています。`,
      ),
      oneOff: true,
    });
  }

  // json: the last reads of the JSON.
  const reads = (
    await db
      .prepare(
        "SELECT at, ok, numbers, error FROM typhoon_json_log ORDER BY at DESC LIMIT ?",
      )
      .bind(JSON_FAILS)
      .all<{ at: string; ok: number; numbers: string; error: string | null }>()
  ).results;
  if (reads.length === JSON_FAILS && reads.every((r) => !r.ok)) {
    found.push({
      key: "json",
      kind: "json",
      detail: reads[0].error ?? "",
      open: msg(
        "今の台風情報が読めていません",
        `気象庁の台風情報（JSON）が${JSON_FAILS}回続けて読めません（${hhmm(reads[0].at)}）。台風のカードには「取れなかった」と出ています。`,
      ),
    });
  }

  // mismatch: the latest JSON read that read, against the telegrams issued in the 6 hours before it.
  const okRead =
    reads.find((r) => r.ok) ??
    (await db
      .prepare(
        "SELECT at, ok, numbers, error FROM typhoon_json_log WHERE ok = 1 ORDER BY at DESC LIMIT 1",
      )
      .first<{
        at: string;
        ok: number;
        numbers: string;
        error: string | null;
      }>());
  if (okRead && reads[0]?.ok) {
    const at = Date.parse(okRead.at);
    const rows = (
      await db
        .prepare(
          "SELECT number, parsed FROM typhoon_telegrams WHERE issued_at IS NOT NULL ORDER BY issued_at DESC LIMIT 40",
        )
        .all<{ number: string | null; parsed: string | null }>()
    ).results;
    // The newest telegram of each typhoon issued within 6 hours before the read, unless it says it ended.
    const latest = new Map<string, { issued: number; remark: string | null }>();
    for (const r of rows) {
      if (!r.number || !r.parsed) continue;
      const t = JSON.parse(r.parsed) as {
        issuedAt: string;
        remark: string | null;
      };
      const issued = Date.parse(t.issuedAt);
      if (!(issued <= at && at - issued <= FRESH_MS)) continue;
      if (!latest.has(r.number))
        latest.set(r.number, { issued, remark: t.remark });
    }
    const inJson = new Set(
      okRead.numbers.split(",").filter(Boolean).map(Number),
    );
    const missing = [...latest]
      .filter(([, v]) => !v.remark)
      .map(([n]) => Number(n.slice(-2)))
      .filter((n) => !inJson.has(n));
    if (missing.length) {
      found.push({
        key: "mismatch",
        kind: "mismatch",
        detail: `電文：${missing.join(",")}／JSON：${[...inJson].join(",") || "なし"}（${okRead.at}）`,
        open: msg(
          "台風情報の食い違い",
          `電文には台風${missing.join("・")}号があるのに、今の台風情報（JSON）にありません。JSONの形が変わった可能性があります。`,
        ),
      });
    }
  }
  return { found, watched };
}

/** To every administrator's devices. Returns how many got it. (Also used by forecastWatch.ts.) */
export async function tellAdmins(
  db: Db,
  m: Message,
  now: number,
  send: Send,
): Promise<number> {
  const admins = (
    await db
      .prepare(
        "SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL",
      )
      .all<{ id: string }>()
  ).results;
  let n = 0;
  for (const a of admins) n += await sendToUser(db, a.id, m, now, send);
  return n;
}

/** One scheduled look: open what is newly wrong, close what is over, and tell the administrators. */
export async function watchTyphoonSources(
  db: Db,
  now = Date.now(),
  send: Send = sendPush,
): Promise<{ opened: string[]; closed: string[] }> {
  await ensureWatchSchema(db);
  const at = new Date(now).toISOString();
  const { found, watched } = await lookNow(db, now);
  const open = new Map(
    (
      await db
        .prepare(
          "SELECT key, opened_at FROM typhoon_alerts WHERE closed_at IS NULL",
        )
        .all<{ key: string; opened_at: string }>()
    ).results.map((r) => [r.key, r.opened_at]),
  );
  const opened: string[] = [];
  const closed: string[] = [];
  for (const f of found) {
    // Told once: an alert already kept (open, or a one-off already told) is not told again.
    const claim = await db
      .prepare(
        "INSERT OR IGNORE INTO typhoon_alerts (key, kind, opened_at, closed_at, detail) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(f.key, f.kind, at, f.oneOff ? at : null, f.detail)
      .run();
    if (!claim.meta.changes) continue;
    opened.push(f.key);
    // 手引きの手順を添える（shared/runbook.ts）
    const n = await tellAdmins(db, { ...f.open, body: `${f.open.body}\n${runbookTag(`alert:${f.key}`)}` }, now, send);
    await db
      .prepare("UPDATE typhoon_alerts SET sent = ? WHERE key = ?")
      .bind(n, f.key)
      .run();
  }
  const now_ = new Set(found.map((f) => f.key));
  for (const [key, openedAt] of open) {
    if (!watched.has(key) || now_.has(key)) continue;
    // Over: closed, and its key freed (renamed with when it opened) so a later stop is told again.
    const done = await db
      .prepare("UPDATE typhoon_alerts SET closed_at = ?, key = ? WHERE key = ? AND closed_at IS NULL")
      .bind(at, `${key}@${openedAt}`, key)
      .run();
    // Two runs at one moment: only the one that closed it tells (no 「復旧」 twice).
    if (!done.meta.changes) continue;
    closed.push(key);
    const closeMsg = closers[key]?.(openedAt, now);
    if (closeMsg) await tellAdmins(db, closeMsg, now, send);
  }
  await db
    .prepare("DELETE FROM typhoon_json_log WHERE at < ?")
    .bind(new Date(now - LOG_DAYS * 86_400_000).toISOString())
    .run();
  return { opened, closed };
}

const closers: Record<string, (openedAt: string, now: number) => Message> = {
  collector: (openedAt, t) =>
    msg(
      "台風の電文の収集が戻りました",
      `止まっていた間：約${minutes(t - Date.parse(openedAt) + COLLECTOR_STOP_MS)}。フィードに残っている分は取り直しました。`,
    ),
  json: () =>
    msg(
      "今の台風情報が読めるようになりました",
      "気象庁の台風情報（JSON）がまた読めています。",
    ),
  mismatch: () =>
    msg(
      "台風情報の食い違いが解けました",
      "電文と今の台風情報（JSON）の台風がまた合っています。",
    ),
};

/** For the administrator: the alerts, open first. */
export async function alertSummary(db: Db) {
  await ensureWatchSchema(db);
  const alerts = await db
    .prepare(
      "SELECT key, kind, opened_at, closed_at, detail, sent FROM typhoon_alerts ORDER BY (closed_at IS NULL) DESC, opened_at DESC LIMIT 30",
    )
    .all();
  const json = await db
    .prepare(
      "SELECT COUNT(*) AS n, SUM(ok) AS ok, MAX(at) AS last FROM typhoon_json_log",
    )
    .first();
  return { alerts: alerts.results, json };
}

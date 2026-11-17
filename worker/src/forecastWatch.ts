// 止まったら知らせる (#250 R5-3): the forecast archive (forecastArchive.ts) watched by the scheduled run,
// and the administrators told by a notification when it stops — once when it starts, once (「復旧」)
// when it is over. A forecast not kept is gone for good after the feed's 7 days, so a stop is not left
// to be found by chance. Modelled on the typhoon watch (typhoonWatch.ts): the same alert rows, the same
// "open once, close once" claim, the same administrators (tellAdmins → sendToUser).
//
// Its own table, forecast_alerts (the same columns as typhoon_alerts), rather than typhoon_alerts with a
// key prefix: the typhoon watch closes every open key it "watches" and its admin summary lists the last
// 30 rows of its table, so sharing it would mix the two histories and tie the forecast archive's schema
// to the typhoon one. Rows are never deleted: a closed alert's key is renamed `${key}@${opened_at}`, so a
// later stop opens a new row and the history can be read back.
//
// Decided (2026-11-17), as constants below so they can be tuned:
//  missing:<kind>  「発表が届かない」(定時発表の想定時刻＋猶予): the feed reads, and S is the latest scheduled
//                  issue time (FORECAST_SCHEDULE, JST hours) with S + FORECAST_GRACE_MS (60 min) <= now;
//                  open when the latest telegram of that kind kept for 高知 (390000) has issued_at < S,
//                  closed (復旧) when the condition no longer holds (a telegram issued at or after S came).
//                  Measured (FH-04, 7 days of the feed): VPFD51 at 05/11/17 JST, VPFW50 at 11/17, each
//                  reaching the feed 18–28 minutes before its ReportDateTime; extra issues (07, 21 …)
//                  only make the latest newer, so they never raise an alert. A fixed "N hours since the
//                  last" rule fired every night (17→05 is 12h) and is not used.
//                  Not judged before the archive has ever run, nor before the first telegram of the
//                  kind was kept (nothing to compare against).
//  fetch           「取得失敗」: the last FORECAST_FETCH_FAILS (3) runs in forecast_fetch_log all failed.
// The two are kept apart: while the latest run failed, `missing` is neither opened nor closed — the
// cause is the fetch, told by `fetch` (or about to be, after 3 runs), and an open `missing` is not
// "recovered" just because it cannot be judged.

import type { Db } from "./accounts";
import { ensureForecastSchema } from "./forecastArchive";
import type { Message } from "./notify";
import { tellAdmins } from "./typhoonWatch";
import { sendPush } from "./webpush";

export const FORECAST_WATCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forecast_alerts (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    detail TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0
  )`,
];

/** The office watched: 高知 (the app's own). */
export const FORECAST_WATCH_OFFICE = "390000";
const OFFICE_NAME = "高知";
/** The regular issue times of each kind (JST hours of ReportDateTime; FH-04). */
export const FORECAST_SCHEDULE = {
  VPFD51: [5, 11, 17],
  VPFW50: [11, 17],
} as const;
/** How long after a scheduled issue time before its absence is told. */
export const FORECAST_GRACE_MS = 60 * 60_000;
type WatchedKind = keyof typeof FORECAST_SCHEDULE;
const WATCHED_KINDS = Object.keys(FORECAST_SCHEDULE) as WatchedKind[];
const KIND_NAME: Record<WatchedKind, string> = {
  VPFD51: "府県天気予報",
  VPFW50: "府県週間天気予報",
};
/** Runs failed in a row before `fetch` is told. */
export const FORECAST_FETCH_FAILS = 3;

const ready = new WeakMap<Db, Promise<void>>();
export function ensureForecastWatchSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      await ensureForecastSchema(db);
      for (const q of FORECAST_WATCH_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

type Send = typeof sendPush;
interface Telegram {
  id: string;
  issued_at: string;
}
interface Failure {
  at: string;
  error: string | null;
}

/** JST, e.g. "11/17 5時" (or "11/17 5時30分"). */
const jst = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  const m = d.getUTCMinutes();
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}時${m ? `${m}分` : ""}`;
};
const span = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h ? `${h}時間${m ? `${m}分` : ""}` : `${m}分`;
};

/** The latest scheduled issue time of `kind` at or before `t` (epoch ms), in JST hours. */
export function scheduledBefore(kind: WatchedKind, t: number): number {
  const JST = 9 * 3_600_000;
  const hours = [...FORECAST_SCHEDULE[kind]].sort((a, b) => b - a);
  // Midnight JST of t's day, as epoch ms.
  let day = Math.floor((t + JST) / 86_400_000) * 86_400_000 - JST;
  for (;;) {
    for (const h of hours) {
      const s = day + h * 3_600_000;
      if (s <= t) return s;
    }
    day -= 86_400_000;
  }
}

const msg = (title: string, body: string): Message => ({
  title,
  body,
  url: "/",
  tag: "weather-note-forecast-watch",
});

const kept = (t: Telegram | null, kind: WatchedKind) =>
  t
    ? `最後に保存した${KIND_NAME[kind]}は ${jst(t.issued_at)} 発表の分です。`
    : `${KIND_NAME[kind]}はまだ1つも保存していません。`;
const failed = (f: Failure | null) =>
  f ? `最後の失敗（${jst(f.at)}）：${f.error ?? "理由不明"}。` : "";

interface Look {
  found: { key: string; kind: string; detail: string; open: Message }[];
  /** Keys this look can speak for: an open alert watched and not found is over. */
  watched: Set<string>;
  latest: Record<WatchedKind, Telegram | null>;
}

async function lookNow(db: Db, now: number): Promise<Look> {
  const found: Look["found"] = [];
  const watched = new Set<string>(["fetch"]);

  const latest = {} as Record<WatchedKind, Telegram | null>;
  for (const k of WATCHED_KINDS)
    latest[k] = await db
      .prepare(
        "SELECT id, issued_at FROM forecast_telegrams WHERE office = ? AND kind = ? AND issued_at IS NOT NULL ORDER BY issued_at DESC LIMIT 1",
      )
      .bind(FORECAST_WATCH_OFFICE, k)
      .first<Telegram>();
  const lastFailure = await db
    .prepare(
      "SELECT at, error FROM forecast_fetch_log WHERE ok = 0 ORDER BY at DESC LIMIT 1",
    )
    .first<Failure>();
  const runs = (
    await db
      .prepare("SELECT at, ok FROM forecast_fetch_log ORDER BY at DESC LIMIT ?")
      .bind(FORECAST_FETCH_FAILS)
      .all<{ at: string; ok: number }>()
  ).results;

  // fetch: told even before any telegram was kept.
  if (runs.length === FORECAST_FETCH_FAILS && runs.every((r) => !r.ok)) {
    found.push({
      key: "fetch",
      kind: "fetch",
      detail: JSON.stringify({
        office: FORECAST_WATCH_OFFICE,
        lastTelegrams: latest,
        lastFailure,
      }),
      open: msg(
        `予報の保存：気象庁の配信を読めません（${FORECAST_FETCH_FAILS}回続けて失敗）`,
        `気象庁の予報の配信（XML）が${FORECAST_FETCH_FAILS}回続けて読めていません。${failed(lastFailure)}${kept(latest.VPFD51, "VPFD51")}7日を過ぎた発表は取り戻せません。`,
      ),
    });
  }

  // missing: only while the feed reads (the latest run did not fail; see the header) and only once the
  // archive has run and kept a telegram of the kind.
  if (runs.length && runs[0].ok) {
    for (const k of WATCHED_KINDS) {
      const key = `missing:${k}`;
      watched.add(key);
      const t = latest[k];
      if (!t) continue;
      const due = scheduledBefore(k, now - FORECAST_GRACE_MS);
      if (Date.parse(t.issued_at) >= due) continue;
      const age = now - Date.parse(t.issued_at);
      const dueIso = new Date(due).toISOString();
      // A failure older than the last telegram kept says nothing about this stop.
      const f =
        lastFailure && Date.parse(lastFailure.at) > Date.parse(t.issued_at)
          ? lastFailure
          : null;
      found.push({
        key,
        kind: "missing",
        detail: JSON.stringify({
          kind: k,
          office: FORECAST_WATCH_OFFICE,
          due: dueIso,
          lastTelegram: t,
          lastFailure,
        }),
        open: msg(
          `予報の保存：${OFFICE_NAME}の${KIND_NAME[k]}（${jst(dueIso)}の発表）が届いていません`,
          `配信は読めていますが、${KIND_NAME[k]}の新しい発表が保存されていません。最後に保存したのは ${jst(t.issued_at)} 発表の分です（${span(age)}前）。${failed(f)}`,
        ),
      });
    }
  }
  return { found, watched, latest };
}

const closeMessage = (key: string, look: Look): Message => {
  if (key === "fetch")
    return msg(
      "予報の保存：復旧しました",
      "気象庁の予報の配信がまた読めています。配信に残っている分は取り直します。",
    );
  const k = key.slice("missing:".length) as WatchedKind;
  const t = look.latest[k];
  return msg(
    "予報の保存：復旧しました",
    `${OFFICE_NAME}の${KIND_NAME[k]}がまた届いています${t ? `（最新：${jst(t.issued_at)} 発表）` : ""}。`,
  );
};

/** One scheduled look: open what is newly wrong, close what is over, and tell the administrators. */
export async function watchForecastArchive(
  db: Db,
  now = Date.now(),
  send: Send = sendPush,
): Promise<{ opened: string[]; closed: string[] }> {
  await ensureForecastWatchSchema(db);
  const at = new Date(now).toISOString();
  const look = await lookNow(db, now);
  const open = new Map(
    (
      await db
        .prepare(
          "SELECT key, opened_at FROM forecast_alerts WHERE closed_at IS NULL",
        )
        .all<{ key: string; opened_at: string }>()
    ).results.map((r) => [r.key, r.opened_at]),
  );
  const opened: string[] = [];
  const closed: string[] = [];
  for (const f of look.found) {
    // Told once: an alert already open is not told again.
    const claim = await db
      .prepare(
        "INSERT OR IGNORE INTO forecast_alerts (key, kind, opened_at, closed_at, detail) VALUES (?, ?, ?, NULL, ?)",
      )
      .bind(f.key, f.kind, at, f.detail)
      .run();
    if (!claim.meta.changes) continue;
    opened.push(f.key);
    const n = await tellAdmins(db, f.open, now, send);
    await db
      .prepare("UPDATE forecast_alerts SET sent = ? WHERE key = ?")
      .bind(n, f.key)
      .run();
  }
  const still = new Set(look.found.map((f) => f.key));
  for (const [key, openedAt] of open) {
    if (!look.watched.has(key) || still.has(key)) continue;
    // Over: closed, and its key freed (renamed with when it opened) so a later stop is told again.
    await db
      .prepare(
        "UPDATE forecast_alerts SET closed_at = ?, key = ? WHERE key = ?",
      )
      .bind(at, `${key}@${openedAt}`, key)
      .run();
    closed.push(key);
    await tellAdmins(db, closeMessage(key, look), now, send);
  }
  return { opened, closed };
}

/** For the administrator: the alerts, open first. */
export async function forecastAlertSummary(db: Db) {
  await ensureForecastWatchSchema(db);
  const alerts = await db
    .prepare(
      "SELECT key, kind, opened_at, closed_at, detail, sent FROM forecast_alerts ORDER BY (closed_at IS NULL) DESC, opened_at DESC LIMIT 30",
    )
    .all();
  return { alerts: alerts.results };
}

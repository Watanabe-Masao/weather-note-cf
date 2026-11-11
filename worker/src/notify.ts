// Notifications that ask for a report: each person picks the times and the days; a scheduled run
// (every 5 minutes, wrangler.jsonc) sends what is due. Times are Japan time.
//
// Every slot sent is kept (notify_log), so a report made from a notification can be set beside the
// time it was asked for (how long people take to answer is part of the analysis).

import { BANDS } from "../../shared/feel";
import type { Db, User } from "./accounts";
import { newVapidKeys, sendPush, type Subscription, type VapidKeys } from "./webpush";

export const NOTIFY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS server_keys (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_ok INTEGER,
    failures INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions (user_id)",
  `CREATE TABLE IF NOT EXISTS notify_settings (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    times TEXT NOT NULL,
    days TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notify_log (
    user_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    devices INTEGER NOT NULL,
    PRIMARY KEY (user_id, slot)
  )`,
];

/**
 * The five 時間帯 of the 肌感 map (朝 6–8, 日中 9–11, 昼 12–14, 夕方 15–17, 夜 18–20): a notification
 * at the middle of each, so a report sits inside the band it will be compared with.
 */
export const BAND_TIMES = BANDS.map((b) => ({ label: b.label, time: `${String(b.hours[1]).padStart(2, "0")}:00`, hours: b.hours as readonly number[] }));
export const DEFAULT_TIMES = BAND_TIMES.map((b) => b.time);

/** The 時間帯 a time ("HH:MM") falls in, if any. */
export const bandOf = (time: string) => BAND_TIMES.find((b) => b.hours.includes(Number(time.slice(0, 2))))?.label ?? null;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const MAX_TIMES = 6;
/** A slot is still sent this long after its time (the scheduled run is every 5 minutes). */
export const WINDOW_MS = 15 * 60_000;
const JST = 9 * 3600_000;

export interface NotifySettings {
  enabled: boolean;
  times: string[];
  days: number[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function checkSettings(raw: Record<string, unknown>): NotifySettings {
  const times = Array.isArray(raw.times) ? [...new Set(raw.times.filter((t): t is string => typeof t === "string" && TIME_RE.test(t)))].sort() : null;
  const days = Array.isArray(raw.days) ? [...new Set(raw.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : null;
  if (typeof raw.enabled !== "boolean" || !times || !days) throw new Error("通知の設定が正しくありません。");
  if (times.length > MAX_TIMES) throw new Error(`通知の時刻は${MAX_TIMES}つまでです。`);
  return { enabled: raw.enabled, times, days };
}

export async function settingsOf(db: Db, userId: string): Promise<NotifySettings> {
  const r = await db.prepare("SELECT enabled, times, days FROM notify_settings WHERE user_id = ?").bind(userId).first<{ enabled: number; times: string; days: string }>();
  return r ? { enabled: r.enabled === 1, times: JSON.parse(r.times), days: JSON.parse(r.days) } : { enabled: false, times: DEFAULT_TIMES, days: ALL_DAYS };
}

export async function saveSettings(db: Db, userId: string, s: NotifySettings, now: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO notify_settings (user_id, enabled, times, days, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, times = excluded.times, days = excluded.days, updated_at = excluded.updated_at",
    )
    .bind(userId, s.enabled ? 1 : 0, JSON.stringify(s.times), JSON.stringify(s.days), now)
    .run();
}

/** The server's VAPID keys: made on first use and kept, so there is nothing to set up by hand. */
export async function vapidKeys(db: Db): Promise<VapidKeys> {
  const row = await db.prepare("SELECT v FROM server_keys WHERE k = 'vapid'").first<{ v: string }>();
  if (row) return JSON.parse(row.v) as VapidKeys;
  const keys = await newVapidKeys();
  await db.prepare("INSERT OR IGNORE INTO server_keys (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(keys)).run();
  // Two first uses at once: whichever was kept wins for both.
  return JSON.parse((await db.prepare("SELECT v FROM server_keys WHERE k = 'vapid'").first<{ v: string }>())!.v) as VapidKeys;
}

/** The site's address, kept when someone subscribes; the VAPID subject (who sends). */
export async function rememberOrigin(db: Db, origin: string) {
  await db.prepare("INSERT INTO server_keys (k, v) VALUES ('origin', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(origin).run();
}
const subjectOf = async (db: Db) => (await db.prepare("SELECT v FROM server_keys WHERE k = 'origin'").first<{ v: string }>())?.v ?? "mailto:weather-note@invalid";

export function checkSubscription(raw: Record<string, unknown>): Subscription {
  const keys = (raw.keys ?? {}) as Record<string, unknown>;
  const ok =
    typeof raw.endpoint === "string" &&
    /^https:\/\//.test(raw.endpoint) &&
    raw.endpoint.length < 1000 &&
    typeof keys.p256dh === "string" &&
    keys.p256dh.length < 200 &&
    typeof keys.auth === "string" &&
    keys.auth.length < 100;
  if (!ok) throw new Error("通知の登録内容が正しくありません。");
  return { endpoint: raw.endpoint as string, p256dh: keys.p256dh as string, auth: keys.auth as string };
}

export async function saveSubscription(db: Db, u: User, s: Subscription, now: number) {
  // One browser belongs to whoever subscribed it last (a shared phone changes hands).
  await db
    .prepare(
      "INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0",
    )
    .bind(s.endpoint, u.id, s.p256dh, s.auth, now)
    .run();
}

export async function removeSubscription(db: Db, u: User, endpoint: string) {
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, u.id).run();
}

/** Japan time parts of `ms`. */
export function jst(ms: number) {
  const d = new Date(ms + JST);
  return { date: d.toISOString().slice(0, 10), day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** The slots of `s` due at `now` (their time has come, within the window), as "YYYY-MM-DD HH:MM" and their ms. */
export function dueSlots(s: NotifySettings, now: number): { slot: string; at: number }[] {
  if (!s.enabled) return [];
  const out: { slot: string; at: number }[] = [];
  // Today's and (just after midnight) yesterday's slots.
  for (const base of [now, now - 86_400_000]) {
    const { date, day } = jst(base);
    if (!s.days.includes(day)) continue;
    for (const t of s.times) {
      const at = Date.parse(`${date}T${t}:00+09:00`);
      if (at <= now && now - at < WINDOW_MS) out.push({ slot: `${date} ${t}`, at });
    }
  }
  return out;
}

export interface Message {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export const reportMessage = (at: number, test = false): Message => {
  const band = bandOf(new Date(at + JST).toISOString().slice(11, 16));
  return {
  title: test ? "通知のテスト" : band ? `${band}の感じ方は？` : "今、外はどう感じますか？",
  body: test ? "この通知を押すと、感じ方の記録が開きます。" : "Weather Note：感じ方を記録しましょう（数秒で終わります）",
  url: `/?report=1&n=${at}`,
  tag: "weather-note-report",
  };
};

/** Sends to every device of one person. Gone subscriptions are removed. Returns how many got it. */
export async function sendToUser(db: Db, userId: string, message: Message, now: number, send = sendPush): Promise<number> {
  const subs = (await db.prepare("SELECT endpoint, p256dh, auth, failures FROM push_subscriptions WHERE user_id = ?").bind(userId).all<Subscription & { failures: number }>()).results;
  if (!subs.length) return 0;
  const keys = await vapidKeys(db);
  const subject = await subjectOf(db);
  let ok = 0;
  for (const s of subs) {
    let status = 0;
    try {
      status = await send(s, message, keys, subject);
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      ok += 1;
      await db.prepare("UPDATE push_subscriptions SET last_ok = ?, failures = 0 WHERE endpoint = ?").bind(now, s.endpoint).run();
    } else if (status === 404 || status === 410 || s.failures >= 9) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(s.endpoint).run(); // unsubscribed, or failing for days
    } else {
      await db.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?").bind(s.endpoint).run();
    }
  }
  return ok;
}

/** The scheduled run: every person's due slots, each sent once. */
export async function runSchedule(db: Db, now = Date.now(), send = sendPush): Promise<number> {
  const rows = (
    await db
      .prepare(
        "SELECT n.user_id, n.times, n.days, n.updated_at FROM notify_settings n JOIN users u ON u.id = n.user_id WHERE n.enabled = 1 AND u.disabled_at IS NULL",
      )
      .all<{ user_id: string; times: string; days: string; updated_at: number }>()
  ).results;
  let sent = 0;
  for (const r of rows) {
    for (const due of dueSlots({ enabled: true, times: JSON.parse(r.times), days: JSON.parse(r.days) }, now)) {
      if (due.at < r.updated_at) continue; // a time that had already passed when it was set: from tomorrow
      // Claim the slot first: a second run at the same moment finds it taken.
      const claim = await db.prepare("INSERT OR IGNORE INTO notify_log (user_id, slot, sent_at, devices) VALUES (?, ?, ?, 0)").bind(r.user_id, due.slot, now).run();
      if (!claim.meta.changes) continue;
      const n = await sendToUser(db, r.user_id, reportMessage(due.at), now, send);
      await db.prepare("UPDATE notify_log SET devices = ? WHERE user_id = ? AND slot = ?").bind(n, r.user_id, due.slot).run();
      sent += n;
    }
  }
  return sent;
}

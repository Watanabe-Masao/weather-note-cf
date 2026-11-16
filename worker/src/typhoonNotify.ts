// 台風の目安の通知 (#220): a person's station, read against JMA's typhoon telegrams (typhoonArchive.ts,
// gathered every 5 minutes), tells them at most twice a typhoon:
//   warning — a new announcement first puts the station inside the 暴風警戒域 ahead;
//   gale    — an analysis first finds the station inside the 強風域 (or the 暴風域).
// What is found is kept at once (typhoon_notify_log); it is sent only inside the person's hours
// (通知の時間帯) and waits there otherwise. When the hours come, a warning no longer forecast and a
// gale entry more than GALE_FRESH_MS old are dropped (kept with devices = -1), not sent late.
// Weather Note's own reading (「目安」): never worded as JMA's warnings.

import stationList from "../../shared/stations.json";
import { analysisLevel, warningHours, type Announcement } from "../../shared/typhoonMap";
import type { XmlTelegram } from "../../shared/typhoonXml";
import type { Db } from "./accounts";
import { jst, sendToUser, type Message } from "./notify";
import { sendPush } from "./webpush";

export const TYPHOON_NOTIFY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS typhoon_notify_settings (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    station TEXT,
    hours_from TEXT NOT NULL,
    hours_to TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS typhoon_notify_log (
    user_id TEXT NOT NULL,
    number TEXT NOT NULL,
    kind TEXT NOT NULL,
    found_at INTEGER NOT NULL,
    detail TEXT NOT NULL,
    sent_at INTEGER,
    devices INTEGER,
    PRIMARY KEY (user_id, number, kind)
  )`,
];

const H = 3_600_000;
/** A typhoon is followed while it has a telegram this recent. */
const ACTIVE_MS = 36 * H;
/** A gale entry still worth telling when the hours open (later, the person has lived through it). */
export const GALE_FRESH_MS = 12 * H;
export const DEFAULT_HOURS = { from: "07:00", to: "22:00" };

export interface TyphoonNotifySettings {
  enabled: boolean;
  station: string | null;
  /** 通知の時間帯 (Japan time): sent from `from` until `to`; `to` before `from` runs past midnight. */
  from: string;
  to: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATIONS: { blockNo: string; name: string; lat: number[]; lon: number[] }[] = stationList;
const stationOf = (blockNo: string | null) => {
  const s = blockNo ? STATIONS.find((x) => x.blockNo === blockNo) : undefined;
  return s ? { name: s.name, lat: s.lat[0] + s.lat[1] / 60, lon: s.lon[0] + s.lon[1] / 60 } : null;
};

export function checkTyphoonSettings(raw: Record<string, unknown>): TyphoonNotifySettings {
  const station = typeof raw.station === "string" && stationOf(raw.station) ? raw.station : null;
  const ok = typeof raw.enabled === "boolean" && typeof raw.from === "string" && TIME_RE.test(raw.from) && typeof raw.to === "string" && TIME_RE.test(raw.to) && raw.from !== raw.to;
  if (!ok) throw new Error("台風の通知の設定が正しくありません。");
  if (raw.enabled && !station) throw new Error("観測地点が分かりません。");
  return { enabled: raw.enabled as boolean, station, from: raw.from as string, to: raw.to as string };
}

export async function typhoonSettingsOf(db: Db, userId: string): Promise<TyphoonNotifySettings> {
  const r = await db
    .prepare("SELECT enabled, station, hours_from, hours_to FROM typhoon_notify_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ enabled: number; station: string | null; hours_from: string; hours_to: string }>();
  return r ? { enabled: r.enabled === 1, station: r.station, from: r.hours_from, to: r.hours_to } : { enabled: false, station: null, ...DEFAULT_HOURS };
}

export async function saveTyphoonSettings(db: Db, userId: string, s: TyphoonNotifySettings, now: number) {
  await db
    .prepare(
      "INSERT INTO typhoon_notify_settings (user_id, enabled, station, hours_from, hours_to, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, station = excluded.station, hours_from = excluded.hours_from, hours_to = excluded.hours_to, updated_at = excluded.updated_at",
    )
    .bind(userId, s.enabled ? 1 : 0, s.station, s.from, s.to, now)
    .run();
}

/** Inside 通知の時間帯 at `now` (Japan time). */
export function inHours(s: Pick<TyphoonNotifySettings, "from" | "to">, now: number): boolean {
  const m = jst(now).minutes;
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const a = min(s.from);
  const b = min(s.to);
  return a < b ? m >= a && m < b : m >= a || m < b;
}

export type Found =
  | { kind: "warning"; first: number; issuedAt: string }
  | { kind: "gale"; level: 1 | 2; at: string };

/** What the latest announcement says for a station: the first hour ahead in its 暴風警戒域, and where it stands now. */
export function readAnnouncement(a: Announcement, lat: number, lon: number, now: number): Found[] {
  const out: Found[] = [];
  const ahead = warningHours(a, lat, lon).filter((t) => t >= now - H);
  if (ahead.length) out.push({ kind: "warning", first: ahead[0], issuedAt: a.issuedAt });
  const level = analysisLevel(a, lat, lon);
  const at = a.times.find((x) => x.hours === 0)?.validAt;
  if (level > 0 && at) out.push({ kind: "gale", level: level as 1 | 2, at });
  return out;
}

const WEEK = "日月火水木金土";
const dayHour = (t: number) => {
  const d = new Date(t + 9 * H);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）${d.getUTCHours()}時`;
};
const hourOf = (iso: string) => `${new Date(Date.parse(iso) + 9 * H).getUTCHours()}時`;

export function typhoonMessage(number: string, station: string, f: Found): Message {
  const n = Number(number.slice(2));
  const base = { url: `/?typhoon=${n}`, tag: `weather-note-typhoon-${number}-${f.kind}` };
  return f.kind === "warning"
    ? {
        ...base,
        title: `台風${n}号：${station}が暴風警戒域に入る予報`,
        body: `${dayHour(f.first)}ごろから。Weather Note の目安です。警報・注意報は気象庁の発表で確かめてください。`,
      }
    : {
        ...base,
        title: `台風${n}号：${station}が${f.level === 2 ? "暴風域" : "強風域"}に入りました`,
        body: `${hourOf(f.at)}の解析。Weather Note の目安です。警報・注意報は気象庁の発表で確かめてください。`,
      };
}

async function latestAnnouncements(db: Db, now: number): Promise<Map<string, Announcement>> {
  const since = new Date(now - ACTIVE_MS + 9 * H).toISOString().slice(0, 19);
  const rows = (
    await db
      .prepare(
        "SELECT number, parsed FROM typhoon_telegrams t WHERE parsed IS NOT NULL AND number IS NOT NULL AND issued_at >= ? AND issued_at = (SELECT MAX(issued_at) FROM typhoon_telegrams u WHERE u.number = t.number AND u.parsed IS NOT NULL)",
      )
      .bind(since)
      .all<{ number: string; parsed: string }>()
  ).results;
  return new Map(rows.map((r) => [r.number, JSON.parse(r.parsed) as XmlTelegram]));
}

/** The scheduled run: finds what is new for each person, then sends what waits inside their hours. Returns how many devices got one. */
export async function runTyphoonNotify(db: Db, now = Date.now(), send = sendPush): Promise<number> {
  const people = (
    await db
      .prepare(
        "SELECT s.user_id, s.station, s.hours_from, s.hours_to FROM typhoon_notify_settings s JOIN users u ON u.id = s.user_id WHERE s.enabled = 1 AND s.station IS NOT NULL AND u.disabled_at IS NULL",
      )
      .all<{ user_id: string; station: string; hours_from: string; hours_to: string }>()
  ).results;
  if (!people.length) return 0;
  const latest = await latestAnnouncements(db, now);
  let sent = 0;
  for (const p of people) {
    const st = stationOf(p.station);
    if (!st) continue;
    const reads = new Map<string, Found[]>();
    for (const [number, a] of latest) {
      const found = readAnnouncement(a, st.lat, st.lon, now);
      reads.set(number, found);
      for (const f of found)
        await db
          .prepare("INSERT OR IGNORE INTO typhoon_notify_log (user_id, number, kind, found_at, detail) VALUES (?, ?, ?, ?, ?)")
          .bind(p.user_id, number, f.kind, now, JSON.stringify(f))
          .run();
    }
    if (!inHours({ from: p.hours_from, to: p.hours_to }, now)) continue;
    const waiting = (
      await db
        .prepare("SELECT number, kind, found_at, detail FROM typhoon_notify_log WHERE user_id = ? AND sent_at IS NULL ORDER BY kind DESC")
        .bind(p.user_id)
        .all<{ number: string; kind: string; found_at: number; detail: string }>()
    ).results;
    for (const w of waiting) {
      // A warning is told as the latest announcement has it; one no longer forecast, or a stale gale entry, is dropped.
      const now_ = reads.get(w.number)?.find((f) => f.kind === w.kind);
      const f: Found | undefined = w.kind === "warning" ? now_ : now - w.found_at <= GALE_FRESH_MS ? (JSON.parse(w.detail) as Found) : undefined;
      // Claim it first: a second run at the same moment finds it taken.
      const claim = await db
        .prepare("UPDATE typhoon_notify_log SET sent_at = ?, devices = 0 WHERE user_id = ? AND number = ? AND kind = ? AND sent_at IS NULL")
        .bind(now, p.user_id, w.number, w.kind)
        .run();
      if (!claim.meta.changes) continue;
      const n = f ? await sendToUser(db, p.user_id, typhoonMessage(w.number, st.name, f), now, send) : -1;
      await db.prepare("UPDATE typhoon_notify_log SET devices = ? WHERE user_id = ? AND number = ? AND kind = ?").bind(n, p.user_id, w.number, w.kind).run();
      if (n > 0) sent += n;
    }
  }
  return sent;
}

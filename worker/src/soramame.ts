// 大気汚染の実測（環境省 大気汚染物質広域監視システム「そらまめくん」の API、速報値）を、高知市の介良局の
// 1時間ごとの値として D1 に残す（2026-11-21、KC-04。渡辺さん：個人利用として始める）。
//
// API：soramame.env.go.jp/soramame/api/data_search（月の範囲・都道府県・測定局・項目）。取れるのは今月から
// さかのぼって1年、1回に3か月まで。高い頻度では取らない。値は速報値で、後日直ることがある（そのつど上書き）。
// 介良局（39201350、高知市の一般局）は PM2.5・光化学オキシダント・SPM・NO2・SO2・風向・風速を測る。
// 値は文字で来る。空・"-"・空白は値なし（測っていない・欠測・調整中）。
//
// 6時間に1回まで：検索の API（data_search）で今月と先月を取り直し（速報値の直しも入る）、そのあと古い側へ3か月ずつ、1年前まで。
// 毎回（1時間に1回まで）：直近7日の CSV（data/sokutei/NoudoTime/<局>/7day.csv、サイトの「測定データ表示」と同じ）。
// 11/25：検索の API は前日の夜までしか返さず、今日の分が入らなかった（渡辺さんの実機で、サイトの一覧には今日の 14時まで出ていた）。
// CSV は今日の分も約1時間遅れで出るので、画面の「いま」の実測はこちらから。何時の値が何分ごろに出るかは、行の fetched_at
// （初めて入った時刻）と、取得の記録の newest（値の出ていた最後の時）で測る。
// 出典：環境省 大気汚染物質広域監視システム（そらまめくん）。データの著作権は環境省・高知市など。

import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Db } from "./accounts";
import { migrate } from "./migrate";
import { soramameEnd } from "./airAudit";
import { ensureCompletenessSchema } from "./completeness";
import { doneOnce } from "./once";
import { retryingFetch } from "./retry";
import type { MeasuredResponse } from "../../shared/airQuality";
import { addDays } from "../../shared/dates";
import { USUAL_DAYS, usualItem } from "../../shared/airUsual";

export const SORAMAME_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS soramame_hourly (
    station TEXT NOT NULL,
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    pm2_5 REAL,
    ox REAL,
    spm REAL,
    no2 REAL,
    so2 REAL,
    wd TEXT,
    ws REAL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (station, date, hour)
  )`,
  `CREATE TABLE IF NOT EXISTS soramame_fetch_log (
    at TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    saved INTEGER NOT NULL,
    range TEXT,
    error TEXT
  )`,
];

const EVERY_MS = 6 * 3_600_000;
/** 今月だけを取る間隔。 */
const NOW_EVERY_MS = 3_600_000;
/** 空欄の時間を「提供元が出していない」とするまでの時間（速報値が後から入ることがあるので、遅れの見張りより長く）。 */
const ABSENT_AFTER_H = 6;
/** 1時間ごとの回（直近7日の CSV だけ）の記録の範囲。 */
const RECENT = "7day";
const LOG_DAYS = 400;
/** さかのぼる月の数（API は今月から1年）。 */
const BACK_MONTHS = 11;
const ITEMS = { pm2_5: "PM2_5", ox: "OX", spm: "SPM", no2: "NO2", so2: "SO2", ws: "WS" } as const;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> }>;
const defaultFetch: Fetcher = retryingFetch(60_000);

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureSoramameSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of SORAMAME_SCHEMA) await db.prepare(q).run();
    // 版1（11/25 ルールの見直し）：取得の記録に、API が返した行の数・値のある最後の時間・形が合わずに捨てた行の数。
    // 「API が返さなかった」と「こちらが捨てた」を後から見分ける（速報値がどれだけ遅れて出るかを測る）。
    await migrate(db, "soramame", [["ALTER TABLE soramame_fetch_log ADD COLUMN returned INTEGER", "ALTER TABLE soramame_fetch_log ADD COLUMN newest TEXT", "ALTER TABLE soramame_fetch_log ADD COLUMN dropped INTEGER"]]);
  });
}

/** "2026-11" の n か月前・後。 */
export const addMonths = (ym: string, n: number) => {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const compact = (ym: string) => ym.replace("-", "");

export const soramameUrl = (pref: string, station: string, from: string, to: string) =>
  "https://soramame.env.go.jp/soramame/api/data_search?" +
  `Start_YM=${compact(from)}&End_YM=${compact(to)}&TDFKN_CD=${pref}&SKT_CD=${station}` +
  `&REQUEST_DATA=${[...Object.values(ITEMS), "WD"].join(",")}`;

/** 次に取る月の範囲：直近の2か月を取り直す回と、古い側へ3か月の回を交互に（古い側が済めば直近だけ）。 */
export function nextMonths(thisMonth: string, oldest: string | null, lastWasRecent: boolean): { from: string; to: string } {
  const recent = { from: addMonths(thisMonth, -1), to: thisMonth };
  const limit = addMonths(thisMonth, -BACK_MONTHS);
  if (!oldest || lastWasRecent === false || oldest <= limit) return recent;
  const to = addMonths(oldest, -1);
  const from = addMonths(to, -2) < limit ? limit : addMonths(to, -2);
  return { from, to };
}

const num = (v: unknown): number | null => {
  if (typeof v !== "string") return typeof v === "number" && Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 直近7日の1時間値の CSV（サイトの「測定データ表示」の一覧と同じもの。今日の分も約1時間遅れで出る、11/25 確かめ）。 */
export const soramameRecentUrl = (station: string) => `https://soramame.env.go.jp/data/sokutei/NoudoTime/${station}/7day.csv`;

const EN16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

interface Hour {
  date: string;
  hour: number;
  pm2_5: number | null;
  ox: number | null;
  spm: number | null;
  no2: number | null;
  so2: number | null;
  wd: string | null;
  ws: number | null;
}

/**
 * 直近7日の CSV を読む。見出しは「年,月,日,時,SO2,NO,NO2,…,OX,…,SPM,PM2.5,SP,WD,WS,…」、時は 01〜24、値の無い欄は空白。
 * 風向は日本語の16方位（「南南東」・「静穏」）なので、検索の API と同じ英字（SSE・CALM）にそろえる。見出しの無い列の CSV は形が違うとして読まない。
 */
export function parseRecentCsv(text: string): { hours: Hour[]; rows: number; dropped: number } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = (lines.shift() ?? "").split(",").map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  // 年・月・日・時は先頭の4列（見出しの文字が読めないとき＝文字コードが違うときも、位置で読む）。項目は英字の見出しで探す。
  const need = { y: 0, m: 1, d: 2, h: 3 };
  if (col("PM2.5") < 0 || col("SPM") < 0) throw new Error("soramame 7day: unexpected header");
  const at = { so2: col("SO2"), no2: col("NO2"), ox: col("OX"), spm: col("SPM"), pm2_5: col("PM2.5"), wd: col("WD"), ws: col("WS") };
  const hours: Hour[] = [];
  let dropped = 0;
  for (const line of lines) {
    const c = line.split(",");
    const y = c[need.y]?.trim();
    const m = c[need.m]?.trim().padStart(2, "0");
    const d = c[need.d]?.trim().padStart(2, "0");
    const h = Number(c[need.h]);
    if (!/^\d{4}$/.test(y ?? "") || !/^\d{2}$/.test(m ?? "") || !/^\d{2}$/.test(d ?? "") || !(h >= 1 && h <= 24)) {
      dropped++;
      continue;
    }
    const v = (k: keyof typeof at) => (at[k] < 0 ? null : num(c[at[k]]));
    const w = at.wd < 0 ? "" : (c[at.wd] ?? "").trim();
    const i = SECTORS_JA.indexOf(w);
    hours.push({ date: `${y}-${m}-${d}`, hour: h, pm2_5: v("pm2_5"), ox: v("ox"), spm: v("spm"), no2: v("no2"), so2: v("so2"), wd: w === "静穏" ? "CALM" : i >= 0 ? EN16[i] : null, ws: v("ws") });
  }
  return { hours, rows: lines.length, dropped };
}
/** CSV の文字：UTF-8 で読み、日本語が化けていれば Shift_JIS で読み直す（風向が日本語のため）。 */
async function textOf(r: { text(): Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> }): Promise<string> {
  if (!r.arrayBuffer) return r.text();
  const buf = await r.arrayBuffer();
  const utf = new TextDecoder("utf-8").decode(buf);
  if (!utf.includes("\uFFFD")) return utf;
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch {
    return utf;
  }
}
const SECTORS_JA = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];

/**
 * 6時間に1回まで、検索の API で決まった月の範囲（直近2か月の取り直し、または古い側）を取る。そして毎回（1時間に1回まで）、
 * 直近7日の CSV を取る（11/25：検索の API は前日の夜までしか返さず、今日の分はサイトの一覧と同じ CSV から取る。渡辺さんの実機で確かめた）。
 * 1時間ごとの回は記録の範囲を「7day」とし、6時間ごとの回の数え方（交互）には入れない（以前の「今月..今月」も同じ扱い）。
 */
export async function saveSoramame(db: Db, now = Date.now(), get: Fetcher = defaultFetch): Promise<{ saved: number; ok: boolean; skipped?: boolean }> {
  await ensureSoramameSchema(db);
  const thisMonth = new Date(now + 9 * 3_600_000).toISOString().slice(0, 7);
  const nowOnly = `${thisMonth}..${thisMonth}`;
  const latest = await db.prepare("SELECT at FROM soramame_fetch_log ORDER BY at DESC LIMIT 1").first<{ at: string }>();
  if (latest?.at && Date.parse(latest.at) > now - NOW_EVERY_MS + 60_000) return { saved: 0, ok: true, skipped: true };
  const last = await db
    .prepare("SELECT at, range FROM soramame_fetch_log WHERE range IS NULL OR (range != ? AND range != ?) ORDER BY at DESC LIMIT 1")
    .bind(nowOnly, RECENT)
    .first<{ at: string; range: string | null }>();
  const full = !last?.at || Date.parse(last.at) <= now - EVERY_MS + 60_000;
  const at = new Date(now).toISOString();
  let saved = 0;
  let error: string | null = null;
  let range: string | null = full ? null : RECENT;
  let returned = 0;
  let dropped = 0;
  let newest: string | null = null;

  /** 時間ごとの値を書く（いま持っている値と同じ時間は書かない）。 */
  const write = async (station: string, from: string, to: string, hours: Hour[]) => {
    const kept = new Map(
      (
        await db
          .prepare("SELECT date, hour, pm2_5, ox, spm, no2, so2, wd, ws FROM soramame_hourly WHERE station = ? AND date >= ? AND date <= ?")
          .bind(station, from, to)
          .all<Record<string, string | number | null>>()
      ).results.map((k) => [`${k.date} ${k.hour}`, JSON.stringify([k.pm2_5, k.ox, k.spm, k.no2, k.so2, k.wd, k.ws])]),
    );
    const stmts = [];
    for (const x of hours) {
      if (x.pm2_5 == null && x.ox == null && x.spm == null && x.no2 == null && x.so2 == null && x.ws == null && !x.wd) continue; // まだ出ていない時間
      const stamp = `${x.date} ${String(x.hour).padStart(2, "0")}`;
      if (!newest || stamp > newest) newest = stamp;
      if (kept.get(`${x.date} ${x.hour}`) === JSON.stringify([x.pm2_5, x.ox, x.spm, x.no2, x.so2, x.wd, x.ws])) continue;
      stmts.push(
        db
          // fetched_at は初めて入った時刻のまま（速報値の直しでは値だけを書き換える。何時の値が何分後に出るかを測るため）。
          .prepare(
            "INSERT INTO soramame_hourly (station, date, hour, pm2_5, ox, spm, no2, so2, wd, ws, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT (station, date, hour) DO UPDATE SET pm2_5 = excluded.pm2_5, ox = excluded.ox, spm = excluded.spm, no2 = excluded.no2, so2 = excluded.so2, wd = COALESCE(excluded.wd, wd), ws = excluded.ws",
          )
          .bind(station, x.date, x.hour, x.pm2_5, x.ox, x.spm, x.no2, x.so2, x.wd, x.ws, at),
      );
    }
    // まとめて書く（1回で最大 約2,200 行。D1 の1回の batch の重さを抑えて 200 行ずつ）。
    for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200));
    saved += stmts.length;
  };

  for (const place of Object.values(STATION_PLACES)) {
    const s = place.soramame;
    if (full) {
      const have = await db.prepare("SELECT MIN(substr(date, 1, 7)) AS oldest FROM soramame_hourly WHERE station = ?").bind(s.station).first<{ oldest: string | null }>();
      const lastWasRecent = !!last?.range?.endsWith(thisMonth);
      const want = nextMonths(thisMonth, have?.oldest ?? null, lastWasRecent);
      range = `${want.from}..${want.to}`;
      try {
        const r = await get(soramameUrl(s.pref, s.station, want.from, want.to));
        if (!r.ok) throw new Error(`soramame ${range}: HTTP ${r.status}`);
        const rows = JSON.parse(await r.text()) as Record<string, string>[];
        if (!Array.isArray(rows)) throw new Error(`soramame ${range}: not a list`);
        returned += rows.length;
        const hours: Hour[] = [];
        for (const x of rows) {
          if (x.SKT_CD !== s.station || !/^\d{4}\/\d{2}\/\d{2}$/.test(x.SKT_DATE ?? "")) {
            dropped++;
            continue;
          }
          const v = Object.fromEntries(Object.entries(ITEMS).map(([k, name]) => [k, num(x[name])])) as Record<keyof typeof ITEMS, number | null>;
          const wd = (x.WD ?? "").trim();
          hours.push({ date: x.SKT_DATE.replaceAll("/", "-"), hour: Number(x.SKT_TIME), ...v, wd: /^[NESW]{1,3}$|^CALM$/i.test(wd) ? wd : null });
        }
        await write(s.station, `${want.from}-01`, `${want.to}-31`, hours);
      } catch (e) {
        error = String(e instanceof Error ? e.message : e).slice(0, 300);
      }
    }
    // 直近7日（今日の分を含む）。検索の API の回でも取る（6時間ごとの回に今日の分が抜けないように）。
    try {
      const r = await get(soramameRecentUrl(s.station));
      if (!r.ok) throw new Error(`soramame 7day: HTTP ${r.status}`);
      const p = parseRecentCsv(await textOf(r));
      returned += p.rows;
      dropped += p.dropped;
      const dates = p.hours.map((h) => h.date).sort();
      if (dates.length) await write(s.station, dates[0], dates[dates.length - 1], p.hours);
      // 提供元が空欄で出した時間（測定局の欠測・調整）：その1時間の終わりから ABSENT_AFTER_H 時間たっても空欄なら、
      // 「出ていない」として data_absent に1度だけ残す（欠けの発見で欠けとしない。後で値が入れば、そちらが優先）。
      const blank = p.hours.filter((x) => x.pm2_5 == null && x.ox == null && x.spm == null && x.no2 == null && x.so2 == null && x.ws == null && !x.wd);
      const old = blank.map((x) => soramameEnd(x.date, x.hour)).filter((t) => Date.parse(t) <= now - ABSENT_AFTER_H * 3_600_000);
      if (old.length) {
        await ensureCompletenessSchema(db);
        await db.batch(old.map((t) => db.prepare("INSERT OR IGNORE INTO data_absent (source, item, found_at) VALUES (?, ?, ?)").bind(`air:soramame:${s.station}`, t, at)));
      }
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  await db
    .prepare("INSERT OR REPLACE INTO soramame_fetch_log (at, ok, saved, range, error, returned, newest, dropped) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(at, error ? 0 : 1, saved, range, error, returned, newest, dropped)
    .run();
  await db.prepare("DELETE FROM soramame_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved, ok: !error };
}

/**
 * 画面用：その日の介良局の1時間値（速報値）と、ふだん（手前30日、今日と先の日は昨日までの30日。shared/airUsual.ts）。
 * 2026-11-25 渡辺さん：商用利用でないので、そのまま使ってよい（だれにでも出す）。
 */
export async function readMeasured(db: Db, station: string, name: string, date: string, today: string): Promise<MeasuredResponse> {
  await ensureSoramameSchema(db);
  const rows = (
    await db
      .prepare("SELECT hour, pm2_5, ox, spm, no2, so2, wd, ws, fetched_at FROM soramame_hourly WHERE station = ? AND date = ? ORDER BY hour")
      .bind(station, date)
      .all<{ hour: number; pm2_5: number | null; ox: number | null; spm: number | null; no2: number | null; so2: number | null; wd: string | null; ws: number | null; fetched_at: string }>()
  ).results;
  const checked = await db.prepare("SELECT at, newest FROM soramame_fetch_log WHERE ok = 1 ORDER BY at DESC LIMIT 1").first<{ at: string | null; newest: string | null }>();
  // どこまで出ているか：この6時間のうまくいった取得のうち、いちばん新しい時（6時間ごとの検索の回は前日までしか返さないので、1回だけを見ない）。
  const out = checked?.at
    ? await db.prepare("SELECT MAX(newest) AS newest FROM soramame_fetch_log WHERE ok = 1 AND at >= ?").bind(new Date(Date.parse(checked.at) - 6 * 3_600_000).toISOString()).first<{ newest: string | null }>()
    : null;
  const end = date < today ? date : today;
  const from = addDays(end, -USUAL_DAYS);
  const back = (
    await db
      .prepare("SELECT pm2_5, ox, spm, no2, so2 FROM soramame_hourly WHERE station = ? AND date >= ? AND date < ?")
      .bind(station, from, end)
      .all<{ pm2_5: number | null; ox: number | null; spm: number | null; no2: number | null; so2: number | null }>()
  ).results;
  const col = (k: "pm2_5" | "ox" | "spm" | "no2" | "so2") => back.map((r) => r[k]).filter((v): v is number => v != null);
  return {
    v: 1,
    station,
    name,
    date,
    hours: rows.map((r) => ({ hour: r.hour, pm2_5: r.pm2_5, ox: r.ox, spm: r.spm, no2: r.no2, so2: r.so2, wd: r.wd, ws: r.ws, fetchedAt: r.fetched_at })),
    checkedAt: checked?.at ?? null,
    newestOut: out?.newest ?? null,
    usual: { from, to: addDays(end, -1), items: { pm2_5: usualItem(col("pm2_5")), ox: usualItem(col("ox")), spm: usualItem(col("spm")), no2: usualItem(col("no2")), so2: usualItem(col("so2")) } },
    source: "環境省 大気汚染物質広域監視システム（そらまめくん）",
  };
}

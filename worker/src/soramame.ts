// 大気汚染の実測（環境省 大気汚染物質広域監視システム「そらまめくん」の API、速報値）を、高知市の介良局の
// 1時間ごとの値として D1 に残す（2026-11-21、KC-04。渡辺さん：個人利用として始める）。
//
// API：soramame.env.go.jp/soramame/api/data_search（月の範囲・都道府県・測定局・項目）。取れるのは今月から
// さかのぼって1年、1回に3か月まで。高い頻度では取らない。値は速報値で、後日直ることがある（そのつど上書き）。
// 介良局（39201350、高知市の一般局）は PM2.5・光化学オキシダント・SPM・NO2・SO2・風向・風速を測る。
// 値は文字で来る。空・"-"・空白は値なし（測っていない・欠測・調整中）。
//
// 6時間に1回まで：今月と先月を取り直し（速報値の直しも入る）、そのあと古い側へ3か月ずつ、1年前まで。
// 出典：環境省 大気汚染物質広域監視システム（そらまめくん）。データの著作権は環境省・高知市など。

import { STATION_PLACES } from "../../shared/stationPlaces";
import type { Db } from "./accounts";
import { doneOnce } from "./once";
import { retryingFetch } from "./retry";

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
const LOG_DAYS = 400;
/** さかのぼる月の数（API は今月から1年）。 */
const BACK_MONTHS = 11;
const ITEMS = { pm2_5: "PM2_5", ox: "OX", spm: "SPM", no2: "NO2", so2: "SO2", ws: "WS" } as const;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetcher = retryingFetch(60_000);

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureSoramameSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of SORAMAME_SCHEMA) await db.prepare(q).run();
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

/** 6時間に1回まで、決まった月の範囲を取って残す。 */
export async function saveSoramame(db: Db, now = Date.now(), get: Fetcher = defaultFetch): Promise<{ saved: number; ok: boolean; skipped?: boolean }> {
  await ensureSoramameSchema(db);
  const last = await db.prepare("SELECT at, range FROM soramame_fetch_log ORDER BY at DESC LIMIT 1").first<{ at: string; range: string | null }>();
  if (last?.at && Date.parse(last.at) > now - EVERY_MS + 60_000) return { saved: 0, ok: true, skipped: true };
  const at = new Date(now).toISOString();
  const thisMonth = new Date(now + 9 * 3_600_000).toISOString().slice(0, 7);
  let saved = 0;
  let error: string | null = null;
  let range: string | null = null;
  for (const place of Object.values(STATION_PLACES)) {
    const s = place.soramame;
    const have = await db.prepare("SELECT MIN(substr(date, 1, 7)) AS oldest FROM soramame_hourly WHERE station = ?").bind(s.station).first<{ oldest: string | null }>();
    const lastWasRecent = !!last?.range?.endsWith(thisMonth);
    const want = nextMonths(thisMonth, have?.oldest ?? null, lastWasRecent);
    range = `${want.from}..${want.to}`;
    try {
      const r = await get(soramameUrl(s.pref, s.station, want.from, want.to));
      if (!r.ok) throw new Error(`soramame ${range}: HTTP ${r.status}`);
      const rows = JSON.parse(await r.text()) as Record<string, string>[];
      if (!Array.isArray(rows)) throw new Error(`soramame ${range}: not a list`);
      const stmts = [];
      for (const x of rows) {
        if (x.SKT_CD !== s.station || !/^\d{4}\/\d{2}\/\d{2}$/.test(x.SKT_DATE ?? "")) continue;
        const v = Object.fromEntries(Object.entries(ITEMS).map(([k, name]) => [k, num(x[name])]));
        const wd = (x.WD ?? "").trim();
        if (Object.values(v).every((y) => y == null) && !/^[NESW]{1,3}$|^CALM$/i.test(wd)) continue; // まだ出ていない時間
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO soramame_hourly (station, date, hour, pm2_5, ox, spm, no2, so2, wd, ws, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(s.station, x.SKT_DATE.replaceAll("/", "-"), Number(x.SKT_TIME), v.pm2_5, v.ox, v.spm, v.no2, v.so2, wd || null, v.ws, at),
        );
      }
      // まとめて書く（1回で最大 約2,200 行。D1 の1回の batch の重さを抑えて 200 行ずつ）。
      for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200));
      saved += stmts.length;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 300);
    }
  }
  await db.prepare("INSERT OR REPLACE INTO soramame_fetch_log (at, ok, saved, range, error) VALUES (?, ?, ?, ?, ?)").bind(at, error ? 0 : 1, saved, range, error).run();
  await db.prepare("DELETE FROM soramame_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { saved, ok: !error };
}

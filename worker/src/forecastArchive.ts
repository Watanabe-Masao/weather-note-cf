// 予報の履歴 (#250): JMA's forecasts kept as JMA issued them — every 府県天気予報（Ｒ１）(VPFD51),
// 府県週間天気予報 (VPFW50) and 府県天気概況 (VPFG50) of the forecast offices in use — so a day can be
// followed from how it was forecast a week before to what it became. Nothing JMA issued keeps its old
// forecasts: what is not kept as it comes is gone (the XML feed reaches 7 days back, FH-01).
//
// The same way as the typhoon telegrams (typhoonArchive.ts): the regular feed (定時) each run — the
// short one (about 10 hours), the long one (7 days) the first time and after a stretch it could not
// read. Each telegram is kept whole (its XML) with when JMA issued it and when it was fetched; it is
// read (parsed) later, by a parser that can change (parser = 0: not read yet). A run's outcome is
// logged, a failed run as a gap. Nothing kept is written over. 出典：気象庁（防災情報XML）。

import stationList from "../../shared/stations.json";
import type { Db } from "./accounts";
import { feedEntries, telegramId, type FeedEntry } from "./typhoonArchive";
import { doneOnce } from "./once";
import { noteListed } from "./listed";
import { retryingFetch } from "./retry";

/** 一覧に載っていた印を残す予報区：見張る高知（forecastWatch.ts の FORECAST_WATCH_OFFICE と同じ。読み込みが輪にならないよう、ここにも）。 */
export const LISTED_OFFICE = "390000";
const jstOf = (iso: string) => `${new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;

export const FORECAST_ARCHIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forecast_telegrams (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    office TEXT NOT NULL,
    url TEXT NOT NULL,
    issued_at TEXT,
    fetched_at TEXT NOT NULL,
    hash TEXT NOT NULL,
    xml TEXT NOT NULL,
    parsed TEXT,
    parser INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS forecast_telegrams_office ON forecast_telegrams (office, kind, issued_at)",
  `CREATE TABLE IF NOT EXISTS forecast_fetch_log (
    at TEXT PRIMARY KEY,
    feed TEXT NOT NULL,
    ok INTEGER NOT NULL,
    entries INTEGER NOT NULL,
    wanted INTEGER NOT NULL,
    added INTEGER NOT NULL,
    left_over INTEGER NOT NULL,
    error TEXT
  )`,
];

const FEED_SHORT = "https://www.data.jma.go.jp/developer/xml/feed/regular.xml";
const FEED_LONG = "https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml";
const SHORT_REACH_MS = 8 * 3_600_000;
const LOG_DAYS = 400;
/** A run fetches at most this many telegrams (a scheduled run's subrequests are few); the rest wait for the next. */
const PER_RUN = 25;
/** The kinds kept: 府県天気予報（Ｒ１）, 府県週間天気予報, 府県天気概況. */
export const FORECAST_KINDS = ["VPFD51", "VPFW50", "VPFG50"] as const;

/** A station's forecast office (気象庁の予報区の発表官署コード): the prefecture's, or its own part of it. */
const PREF_CODE: Record<string, string> = {
  青森県: "020000", 岩手県: "030000", 宮城県: "040000", 秋田県: "050000", 山形県: "060000", 福島県: "070000",
  茨城県: "080000", 栃木県: "090000", 群馬県: "100000", 埼玉県: "110000", 千葉県: "120000", 東京都: "130000",
  神奈川県: "140000", 新潟県: "150000", 富山県: "160000", 石川県: "170000", 福井県: "180000", 山梨県: "190000",
  長野県: "200000", 岐阜県: "210000", 静岡県: "220000", 愛知県: "230000", 三重県: "240000", 滋賀県: "250000",
  京都府: "260000", 大阪府: "270000", 兵庫県: "280000", 奈良県: "290000", 和歌山県: "300000", 鳥取県: "310000",
  島根県: "320000", 岡山県: "330000", 広島県: "340000", 山口県: "350000", 徳島県: "360000", 香川県: "370000",
  愛媛県: "380000", 高知県: "390000", 福岡県: "400000", 佐賀県: "410000", 長崎県: "420000", 熊本県: "430000",
  大分県: "440000", 宮崎県: "450000", 鹿児島県: "460100",
};
/** Where a prefecture has more than one office, by station (北海道・沖縄・奄美). */
const STATION_OFFICE: Record<string, string> = {
  稚内: "011000", 旭川: "012000", 羽幌: "012000", 網走: "013000",
  釧路: "014100", 根室: "014100", 帯広: "014030", 室蘭: "015000", 浦河: "015000", 苫小牧: "015000",
  札幌: "016000", 岩見沢: "016000", 倶知安: "016000", 寿都: "016000", 函館: "017000", 江差: "017000",
  名瀬: "460040", 那覇: "471000", 名護: "471000", 久米島: "471000", 南大東: "472000", 宮古島: "473000",
  石垣島: "474000", 与那国島: "474000",
};
const STATIONS: { blockNo: string; name: string; prefecture: string }[] = stationList;
export function officeOf(blockNo: string): string | null {
  const s = STATIONS.find((x) => x.blockNo === blockNo);
  return s ? (STATION_OFFICE[s.name] ?? PREF_CODE[s.prefecture] ?? null) : null;
}
/** Always kept: 高知 (the app's own station). */
const DEFAULT_STATIONS = ["47893"];

/** The offices of the stations in use: the default, the ones people report from (60 days) and are told about. */
export async function officesInUse(db: Db, now: number): Promise<Set<string>> {
  const stations = new Set(DEFAULT_STATIONS);
  const since = new Date(now - 60 * 86_400_000).toISOString();
  for (const q of [
    ["SELECT DISTINCT station FROM reports WHERE station IS NOT NULL AND at >= ?", since],
    ["SELECT DISTINCT station FROM typhoon_notify_settings WHERE enabled = 1 AND station IS NOT NULL"],
  ] as const) {
    try {
      const st = db.prepare(q[0]);
      const rows = (await (q.length > 1 ? st.bind(q[1]) : st).all<{ station: string }>()).results;
      for (const r of rows) stations.add(r.station);
    } catch {
      // A table not made yet (a new database): the default stations only.
    }
  }
  return new Set([...stations].map(officeOf).filter((o): o is string => o != null));
}

const kindOf = (url: string) => /_(VP[A-Z]{2}\d\d)_/.exec(url)?.[1] ?? "";
const officeOfUrl = (url: string) => /_(\d{6})\.xml$/.exec(url)?.[1] ?? "";
const issuedOf = (xml: string) => /<ReportDateTime>([^<]+)<\/ReportDateTime>/.exec(xml)?.[1] ?? null;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
// 一時的な失敗（5xx・429・接続の切れ）は、待ちを延ばしながら3回まで（retry.ts）。
const defaultFetch: Fetcher = retryingFetch(20_000);

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureForecastSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of FORECAST_ARCHIVE_SCHEMA) await db.prepare(q).run();
  });
}

/** One scheduled run: read the regular feed, keep the new forecast telegrams of the offices in use, log the run. */
export async function collectForecasts(db: Db, now = Date.now(), get: Fetcher = defaultFetch): Promise<{ added: number; leftOver: number; ok: boolean; feed: string }> {
  await ensureForecastSchema(db);
  const at = new Date(now).toISOString();
  const lastOk = await db.prepare("SELECT at FROM forecast_fetch_log WHERE ok = 1 ORDER BY at DESC LIMIT 1").first<{ at: string }>();
  // A run that left telegrams for the next keeps to the long feed until it has them all.
  const owing = await db.prepare("SELECT left_over FROM forecast_fetch_log ORDER BY at DESC LIMIT 1").first<{ left_over: number }>();
  const feed = !lastOk || now - Date.parse(lastOk.at) > SHORT_REACH_MS || (owing?.left_over ?? 0) > 0 ? FEED_LONG : FEED_SHORT;
  const log = (ok: boolean, entries: number, wanted: number, added: number, leftOver: number, error: string | null) =>
    db
      .prepare("INSERT OR REPLACE INTO forecast_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(at, feed === FEED_LONG ? "long" : "short", ok ? 1 : 0, entries, wanted, added, leftOver, error)
      .run();
  let entries: FeedEntry[];
  try {
    const r = await get(feed);
    if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
    entries = feedEntries(await r.text());
    if (!entries.length) throw new Error("feed: no entries");
  } catch (e) {
    await log(false, 0, 0, 0, 0, String(e).slice(0, 300));
    return { added: 0, leftOver: 0, ok: false, feed };
  }
  const offices = await officesInUse(db, now);
  const wanted = entries.filter((e) => (FORECAST_KINDS as readonly string[]).includes(kindOf(e.url)) && offices.has(officeOfUrl(e.url)));
  // 見張る予報区（高知）の電文が一覧に載っていた時刻（取れなかった／出ていない、の見分けの証拠。listed.ts）
  for (const kind of FORECAST_KINDS) {
    const items = wanted.filter((e) => kindOf(e.url) === kind && officeOfUrl(e.url) === LISTED_OFFICE).map((e) => jstOf(e.updated));
    await noteListed(db, `forecast:${kind}`, items, now);
  }
  const fresh: FeedEntry[] = [];
  for (const e of wanted) if (!(await db.prepare("SELECT 1 FROM forecast_telegrams WHERE id = ?").bind(telegramId(e.url)).first())) fresh.push(e);
  // The newest first: a long backlog is caught up from today backwards.
  fresh.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  let added = 0;
  let failed: string | null = null;
  for (const e of fresh.slice(0, PER_RUN)) {
    const id = telegramId(e.url);
    try {
      const r = await get(e.url);
      if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
      const xml = await r.text();
      // A page that is not a telegram (an error page answered 200 …) is not kept: a failure, tried again next run.
      if (!xml.includes("<Report")) throw new Error(`${id}: not a telegram`);
      await db
        .prepare("INSERT OR IGNORE INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, kindOf(e.url), officeOfUrl(e.url), e.url, issuedOf(xml), at, await sha256(xml), xml)
        .run();
      added++;
    } catch (err) {
      failed = String(err).slice(0, 300);
    }
  }
  const leftOver = Math.max(0, fresh.length - PER_RUN);
  await log(!failed, entries.length, wanted.length, added, leftOver, failed);
  await db.prepare("DELETE FROM forecast_fetch_log WHERE at < ?").bind(new Date(now - LOG_DAYS * 86_400_000).toISOString()).run();
  return { added, leftOver, ok: !failed, feed };
}

// 監視と管理 (2026-11-17): how the app stands, as numbers — how much room is left under the plan's
// limits (余裕) and what is kept or done for nothing (無駄) — judged once an hour by the Worker's own
// scheduled run (healthWatch.ts), and read by GitHub Actions (.github/workflows/health.yml) and by the
// daily check. Public and read-only: counts and times only,
// nothing of a person (no ids, no reports, no error texts).
//
// Also kept here, for it to read:
//   cron_runs  — each scheduled stage's time and whether it ended well (the plan allows 30 s of CPU a
//                run; wall time is what can be measured from inside, and bounds it);
//   app_errors — failures of the account requests (the log keeps them only 3–7 days, the count here 30).

import { SHIROMATZ_SOURCE } from "../../shared/forecastShiromatz";
import type { Db, Stmt } from "./accounts";
import { importPosition } from "./forecastImport";
import { monthUsage, scheduledRuns, type UsageEnv } from "./usage";
import { readCompleteness } from "./completeness";
import { doneOnce } from "./once";
import { failureKind } from "../../shared/healthJudge";

export const HEALTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cron_runs (
    at TEXT NOT NULL,
    stage TEXT NOT NULL,
    ms INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    PRIMARY KEY (at, stage)
  )`,
  `CREATE TABLE IF NOT EXISTS app_errors (
    at TEXT NOT NULL,
    place TEXT NOT NULL,
    message TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS app_errors_at ON app_errors (at)",
];

/** Workers Paid (2026-11-17, Cloudflare's published limits): what the room is measured against. */
export const PLAN = {
  name: "Workers Paid",
  d1Bytes: 10e9, // one database
  d1WritesMonth: 50e6, // rows written, included
  d1ReadsMonth: 25e9,
  r2FreeBytes: 10e9, // R2's free tier (Standard)
  r2WritesMonthFree: 1e6, // Class A
  cronCpuMs: 30_000,
  requestsMonth: 10e6, // Workers requests, included
  cpuMsMonth: 30e6, // Workers CPU time, included
  r2ReadsMonthFree: 10e6, // Class B
};

const KEEP_DAYS = 30;

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureHealthSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of HEALTH_SCHEMA) await db.prepare(q).run();
    // d1_ms (2026-11-18) and error (2026-11-19, the failing stage's message for the maintenance screen): added to a
    // table that may already be there; "duplicate column" means it is.
    for (const col of ["d1_ms INTEGER", "error TEXT"])
      try {
        await db.prepare(`ALTER TABLE cron_runs ADD COLUMN ${col}`).run();
      } catch (e) {
        if (!/duplicate column/i.test(String(e))) throw e;
      }
  });
}

/**
 * A D1 that counts the time spent waiting on it (each statement's wall time, from the call to the answer):
 * a stage's time is then split into D1 and the rest (JMA, R2 and the computing), for when a stage is slow.
 */
export function metered(db: Db): { db: Db; ms: () => number; reset: () => void } {
  let total = 0;
  const time = async <T>(p: Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await p;
    } finally {
      total += Date.now() - t;
    }
  };
  type Wrapped = Stmt & { inner: Stmt };
  const wrap = (s: Stmt): Wrapped => ({
    inner: s,
    bind: (...v: unknown[]) => wrap(s.bind(...v)),
    first: (<T>() => time(s.first<T>())) as Stmt["first"],
    all: (<T>() => time(s.all<T>())) as Stmt["all"],
    run: () => time(s.run()),
  });
  return {
    db: { prepare: (q: string) => wrap(db.prepare(q)), batch: (st: Stmt[]) => time(db.batch(st.map((x) => (x as Partial<Wrapped>).inner ?? x))) },
    ms: () => total,
    reset: () => void (total = 0),
  };
}
/**
 * One metered D1 per stage, kept for the isolate: the modules make their tables once per D1 object (a
 * WeakMap each), so a new wrapper every run would make them again every run — more D1 work, not less.
 */
const meters = new WeakMap<Db, Map<string, ReturnType<typeof metered>>>();
function meterOf(db: Db, stage: string) {
  let byStage = meters.get(db);
  if (!byStage) meters.set(db, (byStage = new Map()));
  let m = byStage.get(stage);
  if (!m) byStage.set(stage, (m = metered(db)));
  m.reset();
  return m;
}

/**
 * Runs one scheduled stage and keeps its time and outcome (never throws: a stage's failure is logged and kept).
 * `ms` is the wall time, `d1_ms` the part of it spent waiting on D1 (metered). The same line is also written to
 * the Worker's log (Workers Logs, observability in wrangler.jsonc), which does not depend on D1: when D1 cannot
 * be written, the log still says the stage ran.
 */
export async function timed(db: Db, at: string, stage: string, fn: (db: Db) => Promise<unknown>): Promise<void> {
  const t = Date.now();
  const m = meterOf(db, stage);
  let ok = 1;
  let error: string | null = null;
  try {
    await fn(m.db);
  } catch (e) {
    ok = 0;
    error = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);
    console.error(`weather-note: ${stage}`, e);
  }
  const ms = Date.now() - t;
  console.log(JSON.stringify({ wn: "cron-stage", at, stage, ms, d1Ms: m.ms(), ok }));
  try {
    await ensureHealthSchema(db);
    await db.prepare("INSERT OR REPLACE INTO cron_runs (at, stage, ms, ok, d1_ms, error) VALUES (?, ?, ?, ?, ?, ?)").bind(at, stage, ms, ok, m.ms(), error).run();
  } catch (e) {
    console.error("weather-note: cron_runs", e);
  }
}

/**
 * A run kept first thing (stage `start`, `ms` = how late it started after its scheduled time), so a run
 * that started but was cut short before any stage ended is told apart from one never started (cronGaps).
 */
export async function markStart(db: Db, at: string, lateMs: number): Promise<void> {
  // First to the Worker's log (apart from D1): a start that D1 could not keep is still seen there.
  console.log(JSON.stringify({ wn: "cron-start", at, lateMs: Math.max(0, Math.round(lateMs)) }));
  try {
    await ensureHealthSchema(db);
    await db.prepare("INSERT OR REPLACE INTO cron_runs (at, stage, ms, ok) VALUES (?, 'start', ?, 1)").bind(at, Math.max(0, Math.round(lateMs))).run();
  } catch (e) {
    console.error("weather-note: cron_runs start", e);
  }
}

/** The 5-minute runs (wrangler.jsonc: every 5 minutes, on the minute, UTC; JST is whole hours ahead, so the same times). */
const SLOT_MS = 5 * 60_000;
/** The runs counted: 288 (24 hours), the last one ending at least this long ago — a run still going is not missing. */
export const CRON_WINDOW = { runs: 288, graceMs: 10 * 60_000 } as const;
/**
 * 定時処理の抜け (2026-11-18): of the 288 scheduled times in a fixed window (the 24 hours of 5-minute times
 * whose last is at least 10 minutes before `now`; times in UTC as the cron runs, shown in JST), those with no
 * stage kept at all (cron_runs, keyed by the run's scheduled time), as runs of missing times — so a stretch is
 * told apart from runs missing here and there. A time with no row is not proven not started: D1 may have
 * failed to keep it (the Worker's log, apart from D1, says; see markStart). The newest first, at most `limit`.
 */
export function cronGaps(ats: string[], now: number, limit = 6): { window: { from: string; to: string; runs: number }; kept: number; missing: number; gaps: { from: string; to: string; n: number }[] } {
  const have = new Set(ats.map((a) => Math.floor(Date.parse(a) / SLOT_MS)));
  const last = Math.floor((now - CRON_WINDOW.graceMs) / SLOT_MS);
  const first = last - CRON_WINDOW.runs + 1;
  const gaps: { from: string; to: string; n: number }[] = [];
  let missing = 0;
  for (let k = last; k >= first; k--) {
    if (have.has(k)) continue;
    missing++;
    const g = gaps.at(-1);
    if (g && Date.parse(g.from) === (k + 1) * SLOT_MS) {
      g.from = new Date(k * SLOT_MS).toISOString();
      g.n++;
    } else gaps.push({ from: new Date(k * SLOT_MS).toISOString(), to: new Date(k * SLOT_MS).toISOString(), n: 1 });
  }
  return {
    window: { from: new Date(first * SLOT_MS).toISOString(), to: new Date(last * SLOT_MS).toISOString(), runs: CRON_WINDOW.runs },
    kept: CRON_WINDOW.runs - missing,
    missing,
    gaps: gaps.slice(0, limit),
  };
}

/** A failure of an account request, kept for counting (the place and the error's first line). */
export async function keepError(db: Db, place: string, message: string, now = Date.now()) {
  try {
    await ensureHealthSchema(db);
    await db.batch([
      db.prepare("INSERT INTO app_errors (at, place, message) VALUES (?, ?, ?)").bind(new Date(now).toISOString(), place.slice(0, 80), message.slice(0, 300)),
      db.prepare("DELETE FROM app_errors WHERE at < ?").bind(new Date(now - KEEP_DAYS * 86_400_000).toISOString()),
    ]);
  } catch {
    // Counting must not make a failure worse.
  }
}

async function one<T>(db: Db, q: string, ...v: unknown[]): Promise<T | null> {
  try {
    return await db
      .prepare(q)
      .bind(...v)
      .first<T>();
  } catch {
    return null; // a table not made yet
  }
}
async function all<T>(db: Db, q: string, ...v: unknown[]): Promise<T[]> {
  try {
    return (
      await db
        .prepare(q)
        .bind(...v)
        .all<T>()
    ).results;
  } catch {
    return [];
  }
}

/** The tables counted, and for each the column that says when a row came (for the rows written a day). */
const TABLES: [string, string | null][] = [
  ["forecast_telegrams", "fetched_at"],
  ["forecast_issues", null],
  ["forecast_entries", null],
  ["forecast_fetch_log", "at"],
  ["forecast_imports", "fetched_at"],
  ["forecast_alerts", "opened_at"],
  ["typhoon_telegrams", "fetched_at"],
  ["typhoon_fetch_log", "at"],
  ["warning_telegrams", "fetched_at"],
  ["warning_fetch_log", "at"],
  ["archive_copies", "copied_at"],
  ["wxchart_saved", "fetched_at"],
  ["wxchart_fetch_log", "at"],
  ["radar_saved", "fetched_at"],
  ["radar_fetch_log", "at"],
  ["longrange_telegrams", "fetched_at"],
  ["longrange_fetch_log", "at"],
  ["cron_runs", "at"],
  ["health_checks", "at"],
  ["health_alerts", "opened_at"],
  ["reports", null],
  ["users", null],
];

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export async function health(db: Db, now = Date.now(), env: UsageEnv = {}, usageFetch?: Parameters<typeof monthUsage>[2]) {
  await ensureHealthSchema(db);
  const iso = (ms: number) => new Date(ms).toISOString();
  const dayAgo = iso(now - 86_400_000);

  // The database's size, as D1 reports it after a statement (meta.size_after); absent in the tests.
  let d1Bytes: number | null = null;
  try {
    const r = (await db.prepare("SELECT 1").run()) as { meta?: { size_after?: number } };
    d1Bytes = r.meta?.size_after ?? null;
  } catch {
    d1Bytes = null;
  }
  const tables: Record<string, { rows: number; lastDay: number | null }> = {};
  for (const [t, when] of TABLES) {
    const n = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t}`);
    if (!n) continue;
    const d = when ? await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t} WHERE ${when} >= ?`, dayAgo) : null;
    tables[t] = { rows: n.n, lastDay: d?.n ?? null };
  }
  // Values written in the last day: those of the issues of the telegrams fetched in it.
  const entriesDay = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM forecast_entries e JOIN forecast_telegrams t ON t.id = e.issue_id WHERE t.fetched_at >= ?",
    dayAgo,
  );
  if (tables.forecast_entries) tables.forecast_entries.lastDay = entriesDay?.n ?? null;
  // Rows written a day, roughly: the rows that came (each with its indexes, about 3 writes a row).
  const rowsDay = Object.values(tables).reduce((s, t) => s + (t.lastDay ?? 0), 0);
  const writesMonth = rowsDay * 3 * 30;

  // The XML kept in the database, and the part of it already in R2 (kept twice until it is taken out).
  const xml = {
    forecast: await one<{ bytes: number | null; copied: number | null }>(
      db,
      "SELECT SUM(LENGTH(xml)) AS bytes, SUM(CASE WHEN EXISTS (SELECT 1 FROM archive_copies c WHERE c.source = 'forecast' AND c.id = t.id) THEN LENGTH(xml) ELSE 0 END) AS copied FROM forecast_telegrams t",
    ),
    typhoon: await one<{ bytes: number | null; copied: number | null }>(
      db,
      "SELECT SUM(LENGTH(xml)) AS bytes, SUM(CASE WHEN EXISTS (SELECT 1 FROM archive_copies c WHERE c.source = 'typhoon' AND c.id = t.id) THEN LENGTH(xml) ELSE 0 END) AS copied FROM typhoon_telegrams t",
    ),
  };
  const warningXml = await one<{ bytes: number | null; copied: number | null }>(
    db,
    "SELECT SUM(LENGTH(xml)) AS bytes, SUM(CASE WHEN EXISTS (SELECT 1 FROM archive_copies c WHERE c.source = 'warning' AND c.id = t.id) THEN LENGTH(xml) ELSE 0 END) AS copied FROM warning_telegrams t",
  );
  const xmlBytes = (xml.forecast?.bytes ?? 0) + (xml.typhoon?.bytes ?? 0) + (warningXml?.bytes ?? 0);
  const xmlTwice = (xml.forecast?.copied ?? 0) + (xml.typhoon?.copied ?? 0) + (warningXml?.copied ?? 0);

  const r2 = {
    telegrams: await one<{ n: number; bytes: number | null }>(db, "SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM archive_copies"),
    charts: await one<{ n: number; bytes: number | null }>(db, "SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM wxchart_saved"),
    chartsDay: await one<{ n: number; bytes: number | null }>(db, "SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM wxchart_saved WHERE fetched_at >= ?", dayAgo),
    // 雨雲レーダー (radarArchive.ts): a table not made yet reads as nothing kept.
    radar: await one<{ n: number; bytes: number | null }>(db, "SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM radar_saved"),
    radarDay: await one<{ n: number; bytes: number | null }>(db, "SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM radar_saved WHERE fetched_at >= ?", dayAgo),
    // 長い先の予報の電文（longRangeArchive.ts、gzip）。
    longRange: await one<{ n: number; bytes: number | null }>(db, "SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM longrange_telegrams"),
  };
  const r2Bytes = (r2.telegrams?.bytes ?? 0) + (r2.charts?.bytes ?? 0) + (r2.radar?.bytes ?? 0) + (r2.longRange?.bytes ?? 0);

  const lastOk = async (t: string) => (await one<{ at: string }>(db, `SELECT MAX(at) AS at FROM ${t} WHERE ok = 1`))?.at ?? null;
  const latest = await all<{ kind: string; issued_at: string }>(
    db,
    "SELECT kind, MAX(issued_at) AS issued_at FROM forecast_telegrams WHERE office = '390000' GROUP BY kind",
  );
  const stages = await all<{ stage: string; runs: number; failed: number; avg_ms: number; max_ms: number; avg_d1_ms: number | null; last: string }>(
    db,
    "SELECT stage, COUNT(*) AS runs, SUM(1 - ok) AS failed, CAST(AVG(ms) AS INTEGER) AS avg_ms, MAX(ms) AS max_ms, CAST(AVG(d1_ms) AS INTEGER) AS avg_d1_ms, MAX(at) AS last FROM cron_runs WHERE at >= ? GROUP BY stage ORDER BY stage",
    dayAgo,
  );
  // A day and a half back: the fixed window (cronGaps) starts 24 hours and 10 minutes before now.
  const runTimes = (await all<{ at: string }>(db, "SELECT DISTINCT at FROM cron_runs WHERE at >= ?", iso(now - 36 * 3_600_000))).map((r) => r.at);
  const gaps = cronGaps(runTimes, now);
  const errors = await all<{ place: string; n: number; last: string }>(
    db,
    "SELECT place, COUNT(*) AS n, MAX(at) AS last FROM app_errors WHERE at >= ? GROUP BY place ORDER BY n DESC",
    dayAgo,
  );
  // 失敗の種類ごとの数（文言そのものは出さない。shared/healthJudge.ts failureKind）。
  const kindCount = new Map<string, number>();
  for (const r of await all<{ message: string }>(db, "SELECT message FROM app_errors WHERE at >= ?", dayAgo)) {
    const k = failureKind(r.message);
    kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
  }
  const errorKinds = [...kindCount].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n);
  const unparsed = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM forecast_telegrams WHERE parser = 0");
  const parseFailed = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM forecast_telegrams WHERE parsed LIKE '{\"error\"%'");
  // Each source on its own (a table not made yet counts as none, and does not hide the others).
  const notCopiedOf = async (source: string, table: string) =>
    (await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM archive_copies c WHERE c.source = ? AND c.id = t.id)`, source))?.n ?? 0;
  const warningNotCopied = await notCopiedOf("warning", "warning_telegrams");
  const notCopied = (await notCopiedOf("forecast", "forecast_telegrams")) + (await notCopiedOf("typhoon", "typhoon_telegrams")) + warningNotCopied;
  const notPreferred = await one<{ issues: number; entries: number }>(
    db,
    "SELECT COUNT(*) AS issues, SUM(entries) AS entries FROM forecast_issues WHERE preferred = 0",
  );
  const failingFetch = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM forecast_fetch_log WHERE ok = 0 AND at >= ?", dayAgo);
  // 警報・注意報の電文 (warningArchive.ts): counts and times only. No "should have come" watch (they are
  // not issued on a schedule): the failures to fetch are what is told.
  const warningCount = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM warning_telegrams");
  const warningLatest = await all<{ kind: string; issued_at: string }>(db, "SELECT kind, MAX(issued_at) AS issued_at FROM warning_telegrams GROUP BY kind ORDER BY kind");
  const warningFailing = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM warning_fetch_log WHERE ok = 0 AND at >= ?", dayAgo);
  // 過去の記録の取り込み (#250): the months only — the last taken and the one to take next — for the
  // hourly check to ask the record whether that month is there yet (health-check.mjs, import-ready).
  const imported = await all<{ month: string }>(db, "SELECT DISTINCT month FROM forecast_imports WHERE source = ?", SHIROMATZ_SOURCE);
  // 毎時の見張り (healthWatch.ts): the last look — its time and counts only (finished: false when it did not end).
  const look = await one<{ at: string; done_at: string | null; problems: number | null; notes: number | null; opened: number | null; closed: number | null; sent: number | null }>(
    db,
    "SELECT at, done_at, problems, notes, opened, closed, sent FROM health_checks ORDER BY at DESC LIMIT 1",
  );
  const openAlerts = [
    ...(await all<{ key: string; opened_at: string }>(db, "SELECT key, opened_at FROM forecast_alerts WHERE closed_at IS NULL")),
    ...(await all<{ key: string; opened_at: string }>(db, "SELECT key, opened_at FROM typhoon_alerts WHERE closed_at IS NULL")),
  ];

  // The month's real use, as Cloudflare counts it (usage.ts); each part says itself when it could not be read.
  const u = await monthUsage(env, now, usageFetch);
  // 定時処理の回を Cloudflare 自身の記録でも（D1 とは別の記録）：決まった窓（cronGaps）と同じ288回。
  const cf = await scheduledRuns(env, { from: gaps.window.from, to: gaps.window.to }, usageFetch);
  const cfRuns = cf.ok
    ? {
        ok: true as const,
        empty: cf.value.empty,
        runs: cf.value.runs,
        byStatus: cf.value.byStatus,
        cpuMaxMs: Math.round(cf.value.cpuMaxUs / 1000),
        // Cloudflare が始めたのに D1 に何も残っていない回（D1 に書けなかった）と、Cloudflare にも D1 にも無い回。
        ...(cf.value.empty
          ? {}
          : (() => {
              const started = new Set(cf.value.times.map((t) => Math.floor(Date.parse(t) / SLOT_MS)));
              const keptSet = new Set(runTimes.map((a) => Math.floor(Date.parse(a) / SLOT_MS)));
              let startedNotKept = 0;
              for (const k of started) if (!keptSet.has(k)) startedNotKept++;
              return { startedNotKept, notStarted: CRON_WINDOW.runs - started.size };
            })()),
      }
    : { ok: false as const, error: cf.error };
  const measured = u.ok
    ? {
        from: u.from,
        workers: u.workers.ok
          ? {
              ...u.workers.value,
              requestsPercent: pct(u.workers.value.requests, PLAN.requestsMonth),
              // CPU for the month, roughly: requests × the median CPU time (Cloudflare bills the sum).
              cpuMsEstimate: Math.round((u.workers.value.requests * u.workers.value.cpuP50Us) / 1000),
              cpuPercentEstimate: pct((u.workers.value.requests * u.workers.value.cpuP50Us) / 1000, PLAN.cpuMsMonth),
              // The slowest invocations' CPU (99th percentile) against the limit of one run (30 s).
              cpuP99PercentOfRun: pct(u.workers.value.cpuP99Us / 1000, PLAN.cronCpuMs),
            }
          : { error: u.workers.error },
        d1: u.d1.ok
          ? { ...u.d1.value, rowsWrittenPercent: pct(u.d1.value.rowsWritten, PLAN.d1WritesMonth), rowsReadPercent: pct(u.d1.value.rowsRead, PLAN.d1ReadsMonth) }
          : { error: u.d1.error },
        r2: u.r2.ok
          ? { ...u.r2.value, bytesPercentOfFree: pct(u.r2.value.bytes, PLAN.r2FreeBytes), classAPercentOfFree: pct(u.r2.value.classA, PLAN.r2WritesMonthFree), classBPercentOfFree: pct(u.r2.value.classB, PLAN.r2ReadsMonthFree) }
          : { error: u.r2.error },
      }
    : { error: u.error };

  return {
    v: 1,
    at: iso(now),
    plan: PLAN,
    // 実際の使用量（今月、Cloudflare の集計）: the measure; `room` below is the app's own count beside it.
    usage: measured,
    // 余裕: each use against its limit (percent), with what it rests on.
    room: {
      d1Size: d1Bytes == null ? null : { bytes: d1Bytes, percent: pct(d1Bytes, PLAN.d1Bytes) },
      d1WritesMonth: { estimate: writesMonth, percent: pct(writesMonth, PLAN.d1WritesMonth), rowsLastDay: rowsDay },
      r2: { bytes: r2Bytes, percentOfFree: pct(r2Bytes, PLAN.r2FreeBytes), chartsLastDay: r2.chartsDay?.n ?? 0, chartBytesLastDay: r2.chartsDay?.bytes ?? 0 },
      // Wall time (waiting on JMA, D1 and R2 included), not CPU: the stages run in two lines at once,
      // so their sum is no run's length. CPU against its limit is in `usage` (Cloudflare's count).
      // 抜け: the 5-minute times with no stage kept (cronGaps); the stage `start` (index.ts) is kept first
      // thing, so a run that started and was cut short is not among them.
      // runsLastDay: the runs kept in the fixed window of 288 (cronGaps), so it is out of 288 exactly.
      cron: { runsLastDay: gaps.kept, longestStageMs: Math.max(0, ...stages.map((s) => s.max_ms)), stages, ...gaps, cloudflare: cfRuns },
    },
    // 無駄: what is kept or done for nothing, or not done.
    waste: {
      xmlInDatabase: { bytes: xmlBytes, alsoInR2: xmlTwice },
      notCopiedToR2: notCopied,
      unparsed: unparsed?.n ?? 0,
      parseFailed: parseFailed?.n ?? 0,
      recordCopiesNotShown: { issues: notPreferred?.issues ?? 0, entries: notPreferred?.entries ?? 0 },
      fetchFailuresLastDay: failingFetch?.n ?? 0,
    },
    // 状態: whether it works.
    state: {
      forecastLastOk: await lastOk("forecast_fetch_log"),
      typhoonLastOk: await lastOk("typhoon_fetch_log"),
      chartsLastOk: await lastOk("wxchart_fetch_log"),
      // Not there until the saving has run once (a database without R2, or before the first run): not judged then.
      ...((await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM radar_fetch_log"))?.n ? { radarLastOk: await lastOk("radar_fetch_log") } : {}),
      ...((await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM longrange_fetch_log"))?.n ? { longRangeLastOk: await lastOk("longrange_fetch_log") } : {}),
      // 欠けの発見（completeness.ts、#299）：定時の発表・30分ごとの時刻が1つずつそろっているか。数と時刻だけ。
      completeness: await readCompleteness(db, now),
      warnings: {
        telegrams: warningCount?.n ?? 0,
        latest: Object.fromEntries(warningLatest.map((l) => [l.kind, l.issued_at])),
        notCopiedToR2: warningNotCopied,
        lastOk: await lastOk("warning_fetch_log"),
        fetchFailuresLastDay: warningFailing?.n ?? 0,
      },
      kochiLatest: Object.fromEntries(latest.map((l) => [l.kind, l.issued_at])),
      openAlerts: openAlerts.map((a) => ({ key: a.key, since: a.opened_at })),
      accountErrorsLastDay: errors.map((e) => ({ place: e.place, n: e.n, last: e.last })),
      accountErrorKindsLastDay: errorKinds,
      forecastImport: importPosition(imported.map((r) => r.month)),
      watch: look
        ? { at: look.at, finished: look.done_at != null, problems: look.problems, notes: look.notes, opened: look.opened, closed: look.closed, sent: look.sent }
        : null,
    },
    tables,
  };
}

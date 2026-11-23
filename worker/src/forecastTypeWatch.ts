// 予報が外れやすい型の影の運用（2026-11-24、渡辺さん「型の検証を慎重に」）：固定した型（shared/forecastTypes.ts）に、
// これからの予報が当てはまるかを毎日判定して残し、実績が出たら答え合わせをして残す。画面には何も出さない。
// 合格の基準（PASS）を通った型だけを、あとで画面に出す。
//
// 1日1回（日本時間の2時台、前の日に出た発表がそろってから）：
//  - 判定：前の日 D に出た発表で、対象日 D+1〜D+7 の予報が、どの型に当てはまるか（当てはまらない件も分母として残す）。
//  - 答え合わせ：対象日が2日以上前になった件に、気象庁の過去の気象データ（日の表）の最高・最低・降水量を付ける。
// 決まり：予報どうしは混ぜない（材料は気象庁の予報だけ）。答え合わせは気象庁の観測。今は高知だけ。

import { addDays } from "../../shared/dates";
import { type HistoryEntry, type HistoryIssue, HISTORY_PLACES } from "../../shared/forecastHistory";
import { bigMiss, FORECAST_TYPES, type ForecastTypesResponse, leadLookup, PASS, TYPES_FROZEN_AT, type TypeSummary } from "../../shared/forecastTypes";
import type { Station } from "../../shared/types";
import type { Db } from "./accounts";
import { stations } from "./config";
import { fetchDailyMonth } from "./jma-tables";

const STATION = "47893";
const RUN_HOUR_JST = 2;
const H = 3_600_000;
const jst = (day: string) => `${day}T00:00:00+09:00`;
const jstDay = (ms: number) => new Date(ms + 9 * H).toISOString().slice(0, 10);

export const FORECAST_TYPE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forecast_type_log (
    station TEXT NOT NULL,
    target TEXT NOT NULL,
    lead INTEGER NOT NULL,
    type_id TEXT NOT NULL,
    matched INTEGER NOT NULL,
    forecast TEXT NOT NULL,
    judged_at TEXT NOT NULL,
    observed TEXT,
    big_miss INTEGER,
    checked_at TEXT,
    PRIMARY KEY (station, target, lead, type_id)
  )`,
  "CREATE INDEX IF NOT EXISTS forecast_type_log_check ON forecast_type_log (checked_at, target)",
  `CREATE TABLE IF NOT EXISTS forecast_type_runs (
    day TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    judged INTEGER NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    error TEXT
  )`,
];

export async function ensureForecastTypeSchema(db: Db): Promise<void> {
  for (const sql of FORECAST_TYPE_SCHEMA) await db.prepare(sql).run();
}

/** 今日の分を引き受ける（日本時間の2時台に1回だけ。`force` は試験用）。引き受けた日（前の日 D）を返す。 */
export async function claimForecastTypeRun(db: Db, now: number, force = false): Promise<string | null> {
  if (!force && new Date(now + 9 * H).getUTCHours() !== RUN_HOUR_JST) return null;
  await ensureForecastTypeSchema(db);
  const day = addDays(jstDay(now), -1);
  const r = await db.prepare("INSERT OR IGNORE INTO forecast_type_runs (day, at) VALUES (?, ?)").bind(day, new Date(now).toISOString()).run();
  return (r.meta.changes ?? 0) > 0 ? day : null;
}

/** 判定に使う電文の行：対象日 D+1〜D+7 と、その前の日の予報を、D−6〜D に出た発表から（並びは7日前まで遡る）。 */
async function rowsFor(db: Db, day: string): Promise<{ issues: HistoryIssue[]; entries: HistoryEntry[] }> {
  const places = HISTORY_PLACES[STATION];
  const kinds = JSON.stringify(["VPFD51", "VPFW50"]);
  const from = jst(addDays(day, -6));
  const to = jst(addDays(day, 1));
  const issues = (
    await db
      .prepare(
        `SELECT issue_id, source, office, kind, issued_at, info_type, revision_of, preferred, parser, entries, problems
         FROM forecast_issues WHERE office = ? AND kind IN (SELECT value FROM json_each(?)) AND issued_at >= ? AND issued_at < ?`,
      )
      .bind(places.office, kinds, from, to)
      .all<HistoryIssue>()
  ).results;
  const entries = (
    await db
      .prepare(
        `SELECT e.issue_id, e.place, e.place_name, e.place_type, e.element, e.valid_from, e.valid_to, e.period, e.label, e.value, e.unit, e.lower, e.upper, e.jma_type, e.condition
         FROM forecast_entries e JOIN forecast_issues i ON i.issue_id = e.issue_id
         WHERE i.office = ? AND i.kind IN (SELECT value FROM json_each(?)) AND i.issued_at >= ? AND i.issued_at < ?
           AND e.place IN (SELECT value FROM json_each(?)) AND e.element IN ('weather_code', 'pop', 'temp_max', 'temp_min')
           AND e.valid_from >= ? AND e.valid_from < ?`,
      )
      .bind(places.office, kinds, from, to, JSON.stringify([places.office, places.area, places.point]), jst(addDays(day, -6)), jst(addDays(day, 8)))
      .all<HistoryEntry>()
  ).results;
  return { issues, entries };
}

/** 判定：D に出た発表で、D+1〜D+7 の予報が型に当てはまるか。当てはまらない件も残す（分母）。 */
export async function judgeTypes(db: Db, day: string, now: number): Promise<number> {
  const rows = await rowsFor(db, day);
  const fc = leadLookup(rows, `${addDays(day, 1)}T00:00:00+09:00`);
  const at = new Date(now).toISOString();
  const stmts = [];
  for (let L = 1; L <= 7; L++) {
    const t = addDays(day, L);
    const f = fc(t, L);
    if (!f) continue;
    for (const type of FORECAST_TYPES) {
      if (!type.leads.includes(L)) continue;
      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO forecast_type_log (station, target, lead, type_id, matched, forecast, judged_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(STATION, t, L, type.id, type.match(t, L, fc) ? 1 : 0, JSON.stringify(f), at),
      );
    }
  }
  for (const s of stmts) await s.run();
  return stmts.length;
}

/** 答え合わせ：対象日が2日以上前になった件に、気象庁の日の表の最高・最低・降水量を付ける。 */
export async function checkTypes(db: Db, today: string, now: number, read = fetchDailyMonth): Promise<number> {
  const upto = addDays(today, -2);
  const open = (
    await db
      .prepare("SELECT DISTINCT target FROM forecast_type_log WHERE station = ? AND checked_at IS NULL AND target <= ? ORDER BY target LIMIT 40")
      .bind(STATION, upto)
      .all<{ target: string }>()
  ).results.map((r) => r.target);
  if (!open.length) return 0;
  const station = stations.find((s) => s.blockNo === STATION) as Station;
  const months = [...new Set(open.map((d) => d.slice(0, 7)))];
  const obs = new Map<string, { max: number | null; min: number | null; rainMm: number | null }>();
  for (const m of months) {
    const { rows } = await read(station, m, today);
    for (const r of rows) {
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      obs.set(r.date, { max: n(r.max), min: n(r.min), rainMm: n(r.rain) });
    }
  }
  let done = 0;
  const at = new Date(now).toISOString();
  for (const t of open) {
    const o = obs.get(t);
    if (!o || (o.max == null && o.min == null && o.rainMm == null)) continue; // まだ表に無い：次の日に
    const items = (
      await db
        .prepare("SELECT lead, type_id, forecast FROM forecast_type_log WHERE station = ? AND target = ? AND checked_at IS NULL")
        .bind(STATION, t)
        .all<{ lead: number; type_id: string; forecast: string }>()
    ).results;
    for (const it of items) {
      const type = FORECAST_TYPES.find((x) => x.id === it.type_id);
      const miss = type ? bigMiss(type.item, JSON.parse(it.forecast), o) : null;
      await db
        .prepare("UPDATE forecast_type_log SET observed = ?, big_miss = ?, checked_at = ? WHERE station = ? AND target = ? AND lead = ? AND type_id = ?")
        .bind(JSON.stringify(o), miss == null ? null : miss ? 1 : 0, at, STATION, t, it.lead, it.type_id)
        .run();
      done++;
    }
  }
  return done;
}

/** 定時処理から：引き受けた日だけ、判定と答え合わせ。結果は forecast_type_runs に。 */
export async function runForecastTypes(db: Db, now: number, force = false): Promise<void> {
  const day = await claimForecastTypeRun(db, now, force);
  if (!day) return;
  try {
    const judged = await judgeTypes(db, day, now);
    const checked = await checkTypes(db, jstDay(now), now);
    await db.prepare("UPDATE forecast_type_runs SET judged = ?, checked = ? WHERE day = ?").bind(judged, checked, day).run();
  } catch (e) {
    await db.prepare("UPDATE forecast_type_runs SET error = ? WHERE day = ?").bind(String(e).slice(0, 300), day).run();
    throw e;
  }
}

type LogRow = { target: string; lead: number; type_id: string; matched: number; forecast: string; observed: string | null; big_miss: number | null };

/** 対象日を7日ずつまとめて取り直す（ブロック・ブートストラップ）倍率の 95% の幅。件が少なければ null。 */
function blockCi(rows: LogRow[], seed = 7): [number, number] | null {
  const checked = rows.filter((r) => r.big_miss != null);
  if (checked.length < 20) return null;
  const blocks = new Map<string, LogRow[]>();
  for (const r of checked) {
    const k = String(Math.floor(Date.parse(`${r.target}T00:00:00Z`) / (7 * 86_400_000)));
    blocks.set(k, [...(blocks.get(k) ?? []), r]);
  }
  const list = [...blocks.values()];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ratios: number[] = [];
  for (let b = 0; b < 400; b++) {
    let im = 0, inn = 0, om = 0, on = 0;
    for (let i = 0; i < list.length; i++)
      for (const r of list[Math.floor(rnd() * list.length)]) {
        if (r.matched) {
          inn++;
          im += r.big_miss!;
        } else {
          on++;
          om += r.big_miss!;
        }
      }
    if (inn && on && om) ratios.push(im / inn / (om / on));
  }
  if (ratios.length < 100) return null;
  ratios.sort((a, b) => a - b);
  return [ratios[Math.floor(ratios.length * 0.025)], ratios[Math.floor(ratios.length * 0.975)]];
}

export async function forecastTypesSummary(db: Db): Promise<ForecastTypesResponse> {
  await ensureForecastTypeSchema(db);
  const runs = (
    await db.prepare("SELECT day, at, judged, checked, error FROM forecast_type_runs ORDER BY day DESC LIMIT 14").all<ForecastTypesResponse["runs"][number]>()
  ).results;
  const first = await db.prepare("SELECT MIN(judged_at) AS at FROM forecast_type_log").first<{ at: string | null }>();
  const rows = (
    await db
      .prepare("SELECT target, lead, type_id, matched, forecast, observed, big_miss FROM forecast_type_log WHERE station = ?")
      .bind(STATION)
      .all<LogRow>()
  ).results;
  const types = FORECAST_TYPES.map((type): TypeSummary => {
    const mine = rows.filter((r) => r.type_id === type.id);
    const inR = mine.filter((r) => r.matched && r.big_miss != null);
    const outR = mine.filter((r) => !r.matched && r.big_miss != null);
    const inMiss = inR.filter((r) => r.big_miss === 1);
    const ratio = inR.length && outR.length && outR.some((r) => r.big_miss === 1) ? inMiss.length / inR.length / (outR.filter((r) => r.big_miss === 1).length / outR.length) : null;
    // 向き：大外れの日に、記録した向き（"low"：実際が予報より低い）と同じ側だったか
    let same = 0;
    if (type.direction && type.item !== "rainMiss")
      for (const r of inMiss) {
        const f = JSON.parse(r.forecast)[type.item];
        const o = r.observed ? JSON.parse(r.observed)[type.item] : null;
        if (f != null && o != null && (type.direction === "low" ? o < f : o > f)) same++;
      }
    const matchedDays = new Set(mine.filter((r) => r.matched).map((r) => r.target)).size;
    const ci = blockCi(mine);
    const dirShare = type.direction && inMiss.length ? same / inMiss.length : null;
    const passed =
      matchedDays >= PASS.minDays &&
      ratio != null &&
      ratio >= PASS.minRatio &&
      ci != null &&
      ci[0] > PASS.ciLowAbove &&
      (!type.direction || (dirShare ?? 0) > PASS.directionShareAbove);
    return {
      id: type.id,
      stage: type.stage,
      fs05: type.fs05,
      item: type.item,
      leads: type.leads,
      text: type.text,
      frozenAt: type.frozenAt,
      expected: type.expected,
      judged: mine.length,
      matched: mine.filter((r) => r.matched).length,
      matchedDays,
      inRule: { n: inR.length, miss: inMiss.length },
      outRule: { n: outR.length, miss: outR.filter((r) => r.big_miss === 1).length },
      ratio,
      ci,
      directionShare: dirShare,
      status: passed ? "pass" : matchedDays >= PASS.minDays ? "notYet" : "checking",
    };
  });
  return { frozenAt: TYPES_FROZEN_AT, pass: PASS, runs, firstJudged: first?.at ?? null, types };
}

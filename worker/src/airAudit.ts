// 空気のデータの欠けの発見（2026-11-25 渡辺さん「漏れなく、抜かりなく、重複が無いように」）。completeness.ts の予報・雨雲と
// 同じ形（SeriesAudit：見た範囲・あるはずの数・ある数・続けて確かめられた位置・まだ取り戻せる欠け・出ていない）で、3つの系統を見る。
// 提供スケジュールの数（遅れの猶予・見る長さ）は shared/airSchedule.ts。
//
//   CAMS（終わった日）：手前14日の毎時（日付が変わって lateH 時間たってから昨日の分を数える）。PM2.5 の値があればそろった。
//                     いつでも取り戻せるので「取り戻せない」は無い。欠けは airQuality.ts の取り直しが埋める。
//   そらまめくん     ：手前14日の毎時（その1時間の終わりから lateH 時間たってから数える）。行があればそろった（その時間の
//                     どれかの値）。提供元が空欄で出した時間（測定局の欠測・調整）は data_absent に残し、欠けとしない。
//                     直近7日は毎時の CSV、それより前は6時間ごとの検索の API が埋める（1年までは取り戻せる）。
//   予測             ：今日の0時から4日先の23時までの96時間に PM2.5 の値があるか（毎時の取得で置き換わるので、欠けとしては残さない）。
// 重複は表の主キー（地点＋時刻）で起きない。時の書き方は、CAMS はその時ちょうど、そらまめくんはその1時間の終わり（1〜24）。

import type { Db } from "./accounts";
import { AIR_AUDIT_DAYS, AIR_FORECAST_FULL_HOURS, airFeed } from "../../shared/airSchedule";
import { addDays } from "../../shared/dates";
import { STATION_PLACES } from "../../shared/stationPlaces";

const H = 3_600_000;
const jstDay = (t: number) => new Date(t + 9 * H).toISOString().slice(0, 10);
/** 日本時間の ISO（"2026-11-25T14:00:00+09:00"）。 */
export const jstHourIso = (t: number) => `${new Date(t + 9 * H).toISOString().slice(0, 13)}:00:00+09:00`;
const dayStart = (d: string) => Date.parse(`${d}T00:00:00+09:00`);

export interface HourAudit {
  from: string | null;
  to: string | null;
  expected: number;
  kept: number;
  watermark: string | null;
  pending: string[];
  lost: string[];
  absent: string[];
}

/** 毎時の並び：have の時刻はそろった、absent の時刻は出ていない（欠けではない）、ほかは欠け（まだ取り戻せる）。 */
export function auditHours(times: string[], have: Set<string>, absentSet: Set<string>): HourAudit {
  const pending: string[] = [];
  const absent: string[] = [];
  let watermark: string | null = null;
  let broken = false;
  for (const t of times) {
    if (have.has(t) || absentSet.has(t)) {
      if (absentSet.has(t) && !have.has(t)) absent.push(t);
      if (!broken) watermark = t;
      continue;
    }
    broken = true;
    pending.push(t);
  }
  return { from: times[0] ?? null, to: times.at(-1) ?? null, expected: times.length - absent.length, kept: times.length - pending.length - absent.length, watermark, pending, lost: [], absent };
}

const hoursBetween = (fromMs: number, toMs: number) => {
  const out: string[] = [];
  for (let t = fromMs; t <= toMs; t += H) out.push(jstHourIso(t));
  return out;
};

/** CAMS（終わった日）：手前14日の毎時。 */
export async function auditCams(db: Db, station: string, now: number): Promise<HourAudit> {
  const first = await db.prepare("SELECT MIN(valid_at) AS t FROM air_quality_hourly WHERE station = ? AND pm2_5 IS NOT NULL").bind(station).first<{ t: string | null }>();
  if (!first?.t) return auditHours([], new Set(), new Set());
  const today = jstDay(now);
  // 昨日の分は、日付が変わって lateH 時間たってから数える（まだ取りに行く前かもしれない）。
  const lastDay = now >= dayStart(today) + airFeed("cams").lateH * H ? addDays(today, -1) : addDays(today, -2);
  const fromMs = Math.max(Date.parse(first.t), dayStart(addDays(lastDay, -(AIR_AUDIT_DAYS - 1))));
  const toMs = dayStart(lastDay) + 23 * H;
  const have = new Set(
    (
      await db
        .prepare("SELECT valid_at FROM air_quality_hourly WHERE station = ? AND valid_at >= ? AND valid_at <= ? AND pm2_5 IS NOT NULL")
        .bind(station, jstHourIso(fromMs), jstHourIso(toMs))
        .all<{ valid_at: string }>()
    ).results.map((r) => r.valid_at),
  );
  return auditHours(hoursBetween(fromMs, toMs), have, new Set());
}

/** そらまめくんの (date, hour 1〜24) を、その1時間の終わりの時刻（日本時間の ISO）に。 */
export const soramameEnd = (date: string, hour: number) => jstHourIso(dayStart(date) + hour * H);

/** そらまめくん：手前14日の毎時（その1時間の終わり）。 */
export async function auditSoramame(db: Db, station: string, now: number): Promise<HourAudit & { newest: string | null }> {
  const first = await db.prepare("SELECT date, hour FROM soramame_hourly WHERE station = ? ORDER BY date, hour LIMIT 1").bind(station).first<{ date: string; hour: number }>();
  const last = await db.prepare("SELECT date, hour FROM soramame_hourly WHERE station = ? ORDER BY date DESC, hour DESC LIMIT 1").bind(station).first<{ date: string; hour: number }>();
  if (!first) return { ...auditHours([], new Set(), new Set()), newest: null };
  // その1時間の終わりから lateH 時間たった時間まで数える（まだ出ていないかもしれない）。
  const toMs = Math.floor((now - airFeed("soramame").lateH * H) / H) * H;
  const fromMs = Math.max(Date.parse(soramameEnd(first.date, first.hour)), toMs - (AIR_AUDIT_DAYS * 24 - 1) * H);
  const fromDay = jstDay(fromMs - H);
  const have = new Set(
    (await db.prepare("SELECT date, hour FROM soramame_hourly WHERE station = ? AND date >= ?").bind(station, fromDay).all<{ date: string; hour: number }>()).results.map((r) => soramameEnd(r.date, r.hour)),
  );
  const absentSet = new Set(
    await db
      .prepare("SELECT item FROM data_absent WHERE source = ? AND item >= ?")
      .bind(`air:soramame:${station}`, jstHourIso(fromMs))
      .all<{ item: string }>()
      .then((r) => r.results.map((x) => x.item))
      .catch((e) => (/no such table/i.test(String(e)) ? [] : Promise.reject(e))),
  );
  return { ...auditHours(fromMs <= toMs ? hoursBetween(fromMs, toMs) : [], have, absentSet), newest: last ? soramameEnd(last.date, last.hour) : null };
}

/** 予測：今日の0時から4日先の23時までの96時間に、PM2.5 の値があるか。 */
export async function auditForecast(db: Db, station: string, now: number): Promise<{ expected: number; kept: number; pending: string[] }> {
  const today = jstDay(now);
  const fromMs = dayStart(today);
  const times = hoursBetween(fromMs, fromMs + (AIR_FORECAST_FULL_HOURS - 1) * H);
  const have = new Set(
    (
      await db
        .prepare("SELECT valid_at FROM air_quality_forecast WHERE station = ? AND valid_at >= ? AND valid_at <= ? AND pm2_5 IS NOT NULL")
        .bind(station, times[0], times.at(-1)!)
        .all<{ valid_at: string }>()
    ).results.map((r) => r.valid_at),
  );
  const pending = times.filter((t) => !have.has(t));
  return { expected: times.length, kept: times.length - pending.length, pending };
}

export interface AirAudits {
  cams: HourAudit;
  soramame: HourAudit & { newest: string | null };
  forecast: { expected: number; kept: number; pending: string[] };
}

/** 3つの系統をまとめて（地点は1つ：高知）。表がまだ無い部分は空で返す。 */
export async function auditAir(db: Db, now: number): Promise<AirAudits> {
  const [station, place] = Object.entries(STATION_PLACES)[0];
  const soft = async <T>(f: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (/no such table|no such column/i.test(String(e))) return empty;
      throw e;
    }
  };
  const none = auditHours([], new Set(), new Set());
  return {
    cams: await soft(() => auditCams(db, station, now), none),
    soramame: await soft(() => auditSoramame(db, place.soramame.station, now), { ...none, newest: null }),
    forecast: await soft(() => auditForecast(db, station, now), { expected: 0, kept: 0, pending: [] }),
  };
}

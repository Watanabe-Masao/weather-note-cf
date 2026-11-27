// 天気の記録（2026-11-28 渡辺さん「今の天気だけをアンケート形式で」「その天気の記録が正本で、後はジョインして使う」）。
// 見た空（快晴〜雪）と、雨・雪なら強さ（ポツポツ〜ゴウゴウ、チラチラ〜ゴウゴウ）を、1 行ずつ貯める。入り口は 3 つ：
//   - survey：記録のシートの「今の天気」（このファイルの /api/me/weather）
//   - feel：肌感の記録の「今の天気」（reports を受け取ったときに、ここにも写す。id は "feel:" ＋ 記録の id）
//   - photo：空の写真の天気（写真の受け取りを作るときに入れる。まだ無い）
// 肌感・写真の記録とは ref_id で結ぶ。アメダスとの突き合わせは、今は作らない（渡辺さん「今は実装しない」）。
// 場所は観測所の番号。緯度経度は送られたときだけ、0.01 度（約 1 km）に丸めて残す。

import { intensitiesOf, isIntensityOf, isSky, SKIES } from "../../shared/nowWeather";
import type { Db } from "./accounts";

type Stmt = ReturnType<Db["prepare"]>;

export const WEATHER_OBS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS weather_obs (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    source TEXT NOT NULL,
    ref_id TEXT,
    at TEXT NOT NULL,
    sky TEXT NOT NULL,
    intensity TEXT,
    station TEXT,
    lat REAL,
    lon REAL,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  "CREATE INDEX IF NOT EXISTS weather_obs_at ON weather_obs (at)",
];

/**
 * 版ごとの変更（migrate.ts）。版 1：それより前の肌感の記録の「今の天気」を写す（1 回だけ。入っているものは触らない）。
 */
export const WEATHER_OBS_MIGRATIONS = [
  [
    `INSERT OR IGNORE INTO weather_obs (user_id, id, source, ref_id, at, sky, intensity, station, deleted, updated_at, received_at)
    SELECT user_id, 'feel:' || id, 'feel', id, at, sky, json_extract(body, '$.intensity'), station, 0, updated_at, received_at
    FROM reports WHERE deleted = 0 AND sky IN (${SKIES.map((s) => `'${s.id}'`).join(",")})`,
  ],
];

/** 1 人が貯められる行の上限（肌感の記録と同じ考え：壊れた端末が送り続けても止まる）。 */
export const MAX_WEATHER_OBS = 20_000;

export class WeatherObsRefused extends Error {}

const round = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null);

export interface SurveyIn {
  id: string;
  at: string;
  sky: string;
  intensity: string | null;
  station: string | null;
  lat: number | null;
  lon: number | null;
}

/** アンケートの 1 件を確かめる。強さは、雨・雪のときに、その空の強さだけ残す。 */
export function checkSurvey(b: Record<string, unknown>, now: number): SurveyIn {
  const id = typeof b.id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(b.id) ? b.id : null;
  const at = typeof b.at === "string" && b.at.length <= 40 && Number.isFinite(Date.parse(b.at)) ? b.at : null;
  if (!id || !at) throw new WeatherObsRefused("天気の記録の形が正しくありません。");
  // 先の時刻と、1 週間より前の時刻は受けない（今の天気の記録なので）。
  const t = Date.parse(at);
  if (t > now + 10 * 60_000 || t < now - 7 * 86_400_000) throw new WeatherObsRefused("記録の時刻が正しくありません。");
  if (!isSky(b.sky)) throw new WeatherObsRefused("今の天気を選んでください。");
  // 雨・雪で、その空のものでない強さは受けない。雨・雪でない空に付いてきた強さは捨てる（空を選び直した残り）。
  if (b.intensity != null && intensitiesOf(b.sky) && !isIntensityOf(b.sky, b.intensity)) throw new WeatherObsRefused("降り方の強さが正しくありません。");
  const station = typeof b.station === "string" && /^[0-9A-Za-z_-]{1,20}$/.test(b.station) ? b.station : null;
  const lat = round(b.lat, -90, 90);
  const lon = round(b.lon, -180, 180);
  return { id, at, sky: b.sky, intensity: isIntensityOf(b.sky, b.intensity) ? b.intensity : null, station, lat: lat != null && lon != null ? lat : null, lon: lat != null && lon != null ? lon : null };
}

export async function saveSurvey(db: Db, userId: string, s: SurveyIn, now: number): Promise<void> {
  const held = await db.prepare("SELECT COUNT(*) AS n FROM weather_obs WHERE user_id = ?").bind(userId).first<{ n: number }>();
  if ((held?.n ?? 0) >= MAX_WEATHER_OBS) throw new WeatherObsRefused("保存できる天気の記録の上限に達しました。");
  await db
    .prepare(
      `INSERT INTO weather_obs (user_id, id, source, ref_id, at, sky, intensity, station, lat, lon, deleted, updated_at, received_at)
       VALUES (?, ?, 'survey', NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET at = excluded.at, sky = excluded.sky, intensity = excluded.intensity, station = excluded.station,
         lat = excluded.lat, lon = excluded.lon, deleted = 0, updated_at = excluded.updated_at, received_at = excluded.received_at`,
    )
    .bind(userId, s.id, s.at, s.sky, s.intensity, s.station, s.lat, s.lon, now, now)
    .run();
}

export async function deleteSurvey(db: Db, userId: string, id: unknown, now: number): Promise<void> {
  if (typeof id !== "string" || id.length > 80) throw new WeatherObsRefused("消す記録が正しくありません。");
  // アンケートの行だけ（肌感・写真から来た行は、その記録を消すと消える）。
  await db.prepare("UPDATE weather_obs SET deleted = 1, updated_at = ? WHERE user_id = ? AND id = ? AND source = 'survey'").bind(now, userId, id).run();
}

export interface ObsOut {
  id: string;
  source: string;
  at: string;
  sky: string;
  intensity: string | null;
  station: string | null;
}

/** その人の天気の記録の新しい順（記録のシートの一覧）。 */
export async function listMine(db: Db, userId: string, limit = 20): Promise<ObsOut[]> {
  return (
    await db
      .prepare("SELECT id, source, at, sky, intensity, station FROM weather_obs WHERE user_id = ? AND deleted = 0 ORDER BY at DESC LIMIT ?")
      .bind(userId, Math.min(Math.max(limit, 1), 100))
      .all<ObsOut>()
  ).results;
}

/** 肌感の記録を受け取ったとき、その「今の天気」を天気の記録にも写す文（pushReports の batch に入れる）。 */
export function mirrorFeel(
  db: Db,
  userId: string,
  reports: { id: string; at: string; updatedAt: number; deleted?: boolean; station?: unknown; sky?: unknown; intensity?: unknown }[],
  now: number,
): Stmt[] {
  return reports.map((r) => {
    const id = `feel:${r.id}`;
    if (r.deleted || !isSky(r.sky)) return db.prepare("UPDATE weather_obs SET deleted = 1, updated_at = ? WHERE user_id = ? AND id = ?").bind(r.updatedAt, userId, id);
    const intensity = isIntensityOf(r.sky, r.intensity) ? r.intensity : null;
    const station = typeof r.station === "string" ? r.station.slice(0, 20) : null;
    return db
      .prepare(
        `INSERT INTO weather_obs (user_id, id, source, ref_id, at, sky, intensity, station, deleted, updated_at, received_at)
         VALUES (?, ?, 'feel', ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT (user_id, id) DO UPDATE SET at = excluded.at, sky = excluded.sky, intensity = excluded.intensity, station = excluded.station,
           deleted = 0, updated_at = excluded.updated_at, received_at = excluded.received_at
         WHERE excluded.updated_at >= weather_obs.updated_at`,
      )
      .bind(userId, id, r.id, r.at, r.sky, intensity, station, r.updatedAt, now);
  });
}

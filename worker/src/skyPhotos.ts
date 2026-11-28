// 空の写真の保存と削除（段階 1a、2026-11-28）。決まりは Project の「研究目的の個人データの取り扱い」と「空の写真_段階1a_計画」。
//   - 受けるのは「空の写真」の研究に同意している人（kind 'research-sky'）だけ（渡辺さん「厳密になので写真の保存は同意した人のみ」）。
//   - 写真は端末で描き直した JPEG（位置・XMP・メーカー情報・埋め込みの縮小画像が落ちる）。EXIF・XMP が残っていたら受けない。
//     撮影情報は決めた項目だけを別に受ける。場所は 0.01 度（約 1 km）に丸める。
//   - 置き場所は R2 `weather-note-research`（バインディング RESEARCH）。合計が 5 GB の 95% を超えたら受けない。
//   - 同じ写真の ID の再送は 1 件。R2 に置いてから D1 に書き、D1 に書けなかったら R2 の写真を消す。
//   - 天気を選んでいたら、天気の記録（正本、weather_obs）に `photo:<写真の ID>` の行を同じまとまりで書く。
//   - 保存は無期限。消すのは本人か管理者。R2 を先に消してから D1 を消す（D1 が消えて写真だけ残ることがないように）。
//   - 方位は真北にそろえる（shared/declination.ts、国土地理院の近似式 2020.0）。太陽は撮影地点（無ければ高知の観測所）で計算する。
//   - 衛星画像はまだ取りに行かない（段階 1c）。

import { toTrueNorth } from "../../shared/declination";
import { intensitiesOf, isIntensityOf, isSky } from "../../shared/nowWeather";
import { solarAltitude, solarAzimuth } from "../../shared/sunTimes";
import type { Db } from "./accounts";

export interface ResearchBucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<unknown>;
}

/** 研究用の保存先の上限（渡辺さん 11/27「5 GB」）と、受けるのを止める割合。 */
export const RESEARCH_CAP_BYTES = 5 * 1024 ** 3;
export const STOP_AT = 0.95;
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_THUMB = 400 * 1024;
/** 場所が無いときに太陽・偏角を計算する所（高知の観測所）。 */
export const KOCHI = { lat: 33.5667, lon: 133.5483 };

export const SKY_PHOTO_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sky_photos (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    taken_at TEXT,
    time_source TEXT,
    lat REAL,
    lon REAL,
    dir_raw REAL,
    dir_ref TEXT,
    dir_source TEXT,
    dir_true REAL,
    dir_estimated INTEGER NOT NULL DEFAULT 1,
    declination REAL,
    decl_model TEXT,
    sun_alt REAL,
    sun_az REAL,
    sun_at TEXT,
    camera TEXT,
    sky TEXT,
    intensity TEXT,
    look TEXT,
    note TEXT,
    bytes INTEGER NOT NULL,
    thumb_bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  "CREATE INDEX IF NOT EXISTS sky_photos_taken ON sky_photos (taken_at)",
];

export class PhotoRefused extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const imageKey = (id: string) => `photos/${id}.jpg`;
const thumbKey = (id: string) => `photos/${id}.thumb.jpg`;
const LOOKS = ["西だけ晴れ", "まだら"];
const round2 = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/**
 * JPEG か、そして写真の情報（EXIF・XMP）が残っていないか。端末で描き直したものだけを受けるため。
 * 先頭のマーカーを、画像の本体（SOS）まで見る。
 */
export function cleanJpeg(buf: ArrayBuffer): "ok" | "not-jpeg" | "has-metadata" {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return "not-jpeg";
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p);
    if ((marker & 0xff00) !== 0xff00) return "not-jpeg";
    if (marker === 0xffda) return "ok";
    const size = v.getUint16(p + 2);
    if (marker === 0xffe1) return "has-metadata"; // Exif・XMP
    p += 2 + size;
  }
  return "not-jpeg";
}

export interface PhotoMeta {
  id: string;
  takenAt: string | null;
  timeSource: "exif" | "file" | "manual" | null;
  lat: number | null;
  lon: number | null;
  dir: number | null;
  dirRef: "T" | "M" | null;
  dirSource: "exif" | "manual" | null;
  camera: Record<string, string | number> | null;
  sky: string | null;
  intensity: string | null;
  look: string | null;
  note: string | null;
}

export function checkMeta(m: Record<string, unknown>): PhotoMeta {
  const id = typeof m.id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(m.id) ? m.id : null;
  if (!id) throw new PhotoRefused("写真の形が正しくありません。");
  const takenAt = typeof m.takenAt === "string" && m.takenAt.length <= 40 && Number.isFinite(Date.parse(m.takenAt)) ? m.takenAt : null;
  const lat = round2(m.lat, -90, 90);
  const lon = round2(m.lon, -180, 180);
  const dir = num(m.dir);
  const camera: Record<string, string | number> = {};
  const c = (m.camera ?? {}) as Record<string, unknown>;
  for (const k of ["make", "model", "lens"]) {
    const t = text(c[k], 60);
    if (t) camera[k] = t;
  }
  for (const k of ["exposure", "fNumber", "iso", "focalLength"]) {
    const n = num(c[k]);
    if (n != null && n > 0 && n < 1e6) camera[k] = n;
  }
  if (m.sky != null && !isSky(m.sky)) throw new PhotoRefused("天気が正しくありません。");
  if (m.intensity != null && intensitiesOf(m.sky as string) && !isIntensityOf(m.sky, m.intensity)) throw new PhotoRefused("降り方の強さが正しくありません。");
  return {
    id,
    takenAt,
    timeSource: m.timeSource === "exif" || m.timeSource === "file" || m.timeSource === "manual" ? m.timeSource : null,
    lat: lat != null && lon != null ? lat : null,
    lon: lat != null && lon != null ? lon : null,
    dir: dir != null && dir >= 0 && dir < 360 ? dir : null,
    dirRef: m.dirRef === "T" || m.dirRef === "M" ? m.dirRef : null,
    dirSource: m.dirSource === "exif" || m.dirSource === "manual" ? m.dirSource : null,
    camera: Object.keys(camera).length ? camera : null,
    sky: isSky(m.sky) ? m.sky : null,
    intensity: isIntensityOf(m.sky, m.intensity) ? (m.intensity as string) : null,
    look: typeof m.look === "string" && LOOKS.includes(m.look) ? m.look : null,
    note: text(m.note, 400),
  };
}

/** 撮影時刻の太陽（場所があれば撮影地点、無ければ高知の観測所）。 */
export function sunOf(takenAt: string | null, lat: number | null, lon: number | null) {
  if (!takenAt) return { alt: null, az: null, at: null };
  const p = lat != null && lon != null ? { lat, lon } : KOCHI;
  const t = Date.parse(takenAt);
  const date = new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
  const min = (t - Date.parse(`${date}T00:00:00+09:00`)) / 60_000;
  return { alt: solarAltitude(date, min, p.lat, p.lon), az: solarAzimuth(date, min, p.lat, p.lon), at: lat != null && lon != null ? "photo" : "station" };
}

export async function usedBytes(db: Db): Promise<number> {
  return (await db.prepare("SELECT COALESCE(SUM(bytes + thumb_bytes), 0) AS n FROM sky_photos").first<{ n: number }>())?.n ?? 0;
}

async function granted(db: Db, userId: string): Promise<boolean> {
  const c = await db.prepare("SELECT granted FROM consents WHERE user_id = ? AND kind = 'research-sky' ORDER BY at DESC, rowid DESC LIMIT 1").bind(userId).first<{ granted: number }>();
  return c?.granted === 1;
}

/** 写真を受け取る（multipart：meta は JSON、image と thumb は JPEG）。同じ ID はもう一度書かない。 */
export async function savePhoto(db: Db, bucket: ResearchBucket | undefined, userId: string, form: FormData, now: number): Promise<{ id: string; again: boolean }> {
  if (!bucket) throw new PhotoRefused("写真の保存先がこのサーバーではまだ使えません。", 503);
  if (!(await granted(db, userId))) throw new PhotoRefused("「空の写真」の研究への協力に同意した人だけが写真を保存できます。", 403);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(String(form.get("meta") ?? "")) as Record<string, unknown>;
  } catch {
    throw new PhotoRefused("写真の形が正しくありません。");
  }
  const meta = checkMeta(raw);
  if (await db.prepare("SELECT 1 FROM sky_photos WHERE user_id = ? AND id = ?").bind(userId, meta.id).first()) return { id: meta.id, again: true };
  const image = form.get("image");
  const thumb = form.get("thumb");
  if (!(image instanceof Blob) || !(thumb instanceof Blob)) throw new PhotoRefused("写真が届いていません。");
  if (image.size > MAX_IMAGE || thumb.size > MAX_THUMB) throw new PhotoRefused("写真が大きすぎます。", 413);
  const [img, th] = [await image.arrayBuffer(), await thumb.arrayBuffer()];
  for (const b of [img, th]) {
    const c = cleanJpeg(b);
    if (c === "not-jpeg") throw new PhotoRefused("JPEG の写真だけを受けます。", 415);
    if (c === "has-metadata") throw new PhotoRefused("写真に位置などの情報が残っています。アプリを新しくしてから送り直してください。");
  }
  if ((await usedBytes(db)) + img.byteLength + th.byteLength > RESEARCH_CAP_BYTES * STOP_AT)
    throw new PhotoRefused("写真の保存先がいっぱいに近いので、受け取りを止めています（管理者に知らせました）。", 507);

  const bearing = meta.dir == null ? null : toTrueNorth(meta.dir, meta.dirSource === "manual" ? "T" : meta.dirRef, meta.lat != null && meta.lon != null ? { lat: meta.lat, lon: meta.lon } : null, KOCHI);
  const estimated = !bearing || bearing.deg == null || bearing.estimated || meta.dirSource === "manual";
  const sun = sunOf(meta.takenAt, meta.lat, meta.lon);

  await bucket.put(imageKey(meta.id), img, { httpMetadata: { contentType: "image/jpeg" } });
  await bucket.put(thumbKey(meta.id), th, { httpMetadata: { contentType: "image/jpeg" } });
  try {
    const statements = [
      db
        .prepare(
          `INSERT INTO sky_photos (user_id, id, taken_at, time_source, lat, lon, dir_raw, dir_ref, dir_source, dir_true, dir_estimated, declination, decl_model,
             sun_alt, sun_az, sun_at, camera, sky, intensity, look, note, bytes, thumb_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          userId,
          meta.id,
          meta.takenAt,
          meta.timeSource,
          meta.lat,
          meta.lon,
          meta.dir,
          meta.dirRef,
          meta.dirSource,
          bearing?.deg ?? null,
          estimated ? 1 : 0,
          bearing?.declination ?? null,
          bearing?.model ?? null,
          sun.alt,
          sun.az,
          sun.at,
          meta.camera ? JSON.stringify(meta.camera) : null,
          meta.sky,
          meta.intensity,
          meta.look,
          meta.note,
          img.byteLength,
          th.byteLength,
          now,
        ),
    ];
    if (meta.sky)
      statements.push(
        db
          .prepare(
            `INSERT INTO weather_obs (user_id, id, source, ref_id, at, sky, intensity, station, lat, lon, deleted, updated_at, received_at)
             VALUES (?, ?, 'photo', ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?)
             ON CONFLICT (user_id, id) DO NOTHING`,
          )
          .bind(userId, `photo:${meta.id}`, meta.id, meta.takenAt ?? new Date(now).toISOString(), meta.sky, meta.intensity, meta.lat, meta.lon, now, now),
      );
    await db.batch(statements);
  } catch (e) {
    // D1 に書けなかった：置いた写真を消す（持ち主の分からない写真を残さない）。
    await bucket.delete([imageKey(meta.id), thumbKey(meta.id)]).catch(() => {});
    throw e;
  }
  return { id: meta.id, again: false };
}

export interface PhotoRow {
  id: string;
  taken_at: string | null;
  time_source: string | null;
  dir_true: number | null;
  dir_estimated: number;
  sun_alt: number | null;
  sun_az: number | null;
  sun_at: string | null;
  sky: string | null;
  intensity: string | null;
  look: string | null;
  note: string | null;
  created_at: number;
}

const LIST_COLUMNS = "id, taken_at, time_source, dir_true, dir_estimated, sun_alt, sun_az, sun_at, sky, intensity, look, note, created_at";

export async function listPhotos(db: Db, userId: string): Promise<PhotoRow[]> {
  return (await db.prepare(`SELECT ${LIST_COLUMNS} FROM sky_photos WHERE user_id = ? ORDER BY COALESCE(taken_at, '') DESC, created_at DESC LIMIT 200`).bind(userId).all<PhotoRow>()).results;
}

/** 管理者の一覧：名前やログイン ID は出さず、研究用の番号で。 */
export async function listAllPhotos(db: Db): Promise<(PhotoRow & { research_id: string })[]> {
  return (
    await db
      .prepare(`SELECT p.${LIST_COLUMNS.split(", ").join(", p.")}, u.research_id FROM sky_photos p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 500`)
      .all<PhotoRow & { research_id: string }>()
  ).results;
}

export async function photoCount(db: Db, userId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM sky_photos WHERE user_id = ?").bind(userId).first<{ n: number }>())?.n ?? 0;
}

/** 写真の中身（本人か管理者）。 */
export async function photoFile(db: Db, bucket: ResearchBucket | undefined, who: { id: string; admin: boolean }, id: string | null, kind: "image" | "thumb"): Promise<Response> {
  if (!bucket || !id) throw new PhotoRefused("写真が見つかりません。", 404);
  const row = await db.prepare("SELECT user_id FROM sky_photos WHERE id = ?").bind(id).first<{ user_id: string }>();
  if (!row || (row.user_id !== who.id && !who.admin)) throw new PhotoRefused("写真が見つかりません。", 404);
  const obj = await bucket.get(kind === "image" ? imageKey(id) : thumbKey(id));
  if (!obj) throw new PhotoRefused("写真のファイルが見つかりません。", 404);
  return new Response(await obj.arrayBuffer(), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}

/**
 * 写真を消す（本人か管理者）。R2 の写真と縮小画像を先に消し、そのあと D1 の行と天気の記録の `photo:` の行を消す。
 * 元に戻せない。衛星画像は段階 1c で（結び付きの数を見て、どの写真からも結ばれていないものだけ消す）。
 */
export async function deletePhoto(db: Db, bucket: ResearchBucket | undefined, who: { id: string; admin: boolean }, id: unknown): Promise<void> {
  if (!bucket) throw new PhotoRefused("写真の保存先がこのサーバーではまだ使えません。", 503);
  if (typeof id !== "string" || id.length > 80) throw new PhotoRefused("消す写真が正しくありません。");
  const row = await db.prepare("SELECT user_id FROM sky_photos WHERE id = ?").bind(id).first<{ user_id: string }>();
  if (!row || (row.user_id !== who.id && !who.admin)) throw new PhotoRefused("写真が見つかりません。", 404);
  await bucket.delete([imageKey(id), thumbKey(id)]);
  await db.batch([
    db.prepare("DELETE FROM sky_photos WHERE user_id = ? AND id = ?").bind(row.user_id, id),
    db.prepare("DELETE FROM weather_obs WHERE user_id = ? AND id = ?").bind(row.user_id, `photo:${id}`),
  ]);
}

/** アカウントを消すとき：その人の写真のファイルを全部消す（行はアカウントの削除で消える）。 */
export async function deleteAllPhotoFiles(db: Db, bucket: ResearchBucket | undefined, userId: string): Promise<void> {
  const ids = (await db.prepare("SELECT id FROM sky_photos WHERE user_id = ?").bind(userId).all<{ id: string }>()).results.map((r) => r.id);
  if (!ids.length) return;
  if (!bucket) throw new PhotoRefused("写真の保存先に届かないので、今はアカウントを消せません。", 503);
  for (let i = 0; i < ids.length; i += 400) await bucket.delete(ids.slice(i, i + 400).flatMap((id) => [imageKey(id), thumbKey(id)]));
}

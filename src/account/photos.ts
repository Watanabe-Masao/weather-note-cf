// 空の写真のやり取り（段階 1a）：端末で描き直してから送る・一覧・消す。サーバーは worker/src/skyPhotos.ts。
// 描き直す理由：位置・XMP・メーカー情報・埋め込みの縮小画像を、送る前に全部落とすため（サーバーも EXIF が残った JPEG は受けない）。

import { intensityLabel, skyLabel } from "../../shared/nowWeather";
import { api, refreshAccount } from "./account";
import { compass16 } from "./exif";
import type { PhotoItem } from "./MyPhotos";

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
}

export const toItem = (r: PhotoRow): PhotoItem => ({
  id: r.id,
  takenAt: r.taken_at,
  dir: r.dir_true == null ? null : compass16(r.dir_true),
  dirEstimated: r.dir_true != null && r.dir_estimated === 1,
  weather: r.sky ? `${skyLabel(r.sky) ?? r.sky}${r.intensity ? `（${intensityLabel(r.intensity) ?? r.intensity}）` : ""}` : null,
  thumb: `/api/me/photos/thumb?id=${encodeURIComponent(r.id)}`,
  note: [r.look, r.note].filter(Boolean).join("・") || undefined,
});

export async function fetchPhotos(): Promise<PhotoItem[]> {
  return (await api<{ photos: PhotoRow[] }>("/api/me/photos")).photos.map(toItem);
}

export async function removePhoto(id: string): Promise<PhotoItem[]> {
  const r = await api<{ photos: PhotoRow[] }>("/api/me/photos/delete", { id });
  void refreshAccount(); // 写真の数（設定の「自分の写真」を出すか）
  return r.photos.map(toItem);
}

/** iOS の canvas の上限（約 1,677 万画素）を超えないように縮める割合。 */
const scaleFor = (w: number, h: number, maxPixels: number, maxSide = Infinity) => Math.min(1, Math.sqrt(maxPixels / (w * h)), maxSide / Math.max(w, h));

async function draw(file: File, maxPixels: number, maxSide: number, quality: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // 写真の向き（EXIF の回転）は、ブラウザが描くときに当てる
    const s = scaleFor(img.naturalWidth, img.naturalHeight, maxPixels, maxSide);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", quality));
    if (!blob) throw new Error("写真を JPEG にできませんでした。");
    return blob;
  } catch (e) {
    throw e instanceof Error && e.message.includes("JPEG") ? e : new Error("この写真は読めませんでした（形式が合わないかもしれません）。");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPhoto(file: File, meta: Record<string, unknown>): Promise<PhotoItem[]> {
  const [image, thumb] = [await draw(file, 16_000_000, Infinity, 0.92), await draw(file, 16_000_000, 512, 0.8)];
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("image", image, "photo.jpg");
  form.set("thumb", thumb, "thumb.jpg");
  let res: Response;
  try {
    res = await fetch("/api/me/photos", { method: "POST", credentials: "same-origin", body: form });
  } catch {
    throw new Error("通信できませんでした。電波のあるところで、もう一度お試しください（同じ写真を送り直しても 1 件になります）。");
  }
  const data = (await res.json().catch(() => null)) as { photos?: PhotoRow[]; error?: string } | null;
  if (!res.ok || !data?.photos) throw new Error(data?.error ?? "保存に失敗しました。時間をおいて再試行してください。");
  void refreshAccount();
  return data.photos.map(toItem);
}

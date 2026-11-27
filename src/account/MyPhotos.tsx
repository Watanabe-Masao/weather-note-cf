// 自分の空の写真の一覧と削除（段階 1a、2026-11-28）。
// 渡辺さん：「写真の保存は無期限。管理者と撮った本人は削除可能なUIの実装」「おすすめで」（同意を取り消した人も、写真が残って
// いれば設定のアカウントに「自分の写真」の一覧と削除だけを出す。撮る・上げるは無い）。
// 消すと：写真・縮小画像・この写真から来た天気の記録。元に戻せないので、消す前に何が消えるかを出して確かめる。

import { useEffect, useState } from "react";
import { fetchPhotos, removePhoto } from "./photos";
import { Button } from "../ui/kit";

export interface PhotoItem {
  id: string;
  /** 撮影時刻（ISO）。分からなければ null */
  takenAt: string | null;
  /** 写した方角の言葉（真北にそろえたあと）。分からなければ null */
  dir: string | null;
  /** 方角が推定か（磁北・基準不明・手で選んだなど） */
  dirEstimated?: boolean;
  /** 天気（天気の記録に入れたもの）の言葉 */
  weather: string | null;
  /** 一覧の小さな絵の URL */
  thumb: string;
  note?: string;
}

const jst = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });


/** 写真の一覧。各行に［消す］があり、押すとその行の中で確かめる。 */
export function PhotoList({ photos, onDelete, empty }: { photos: PhotoItem[]; onDelete: (id: string) => Promise<void> | void; empty: string }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!photos.length) return <p className="set-help">{empty}</p>;
  const remove = (id: string) => {
    setBusy(true);
    setError(null);
    Promise.resolve(onDelete(id))
      .then(() => setAsking(null))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <ul className="sp-list">
      {photos.map((p) => (
        <li key={p.id} className="sp-item">
          <img className="sp-mini" src={p.thumb} alt="" loading="lazy" />
          <span className="sp-item-text">
            <b>
              {p.takenAt ? jst(p.takenAt) : "撮影時刻 不明"}・{p.dir ? `${p.dir}${p.dirEstimated ? "（推定）" : ""}` : "方角 不明"}
              {p.weather ? `・${p.weather}` : ""}
            </b>
            {p.note ? <small>{p.note}</small> : null}
            {asking === p.id ? (
              <span className="sp-confirm" role="group" aria-label="写真を消す確かめ">
                <small className="warn">
                  この写真と縮小画像{p.weather ? "、この写真の天気の記録" : ""}を消します。元に戻せません。
                </small>
                {error ? <small className="warn">{error}</small> : null}
                <span className="sp-actions">
                  <Button size="sm" onClick={() => (setAsking(null), setError(null))} disabled={busy}>
                    やめる
                  </Button>
                  <Button size="sm" kind="danger" busy={busy} disabled={busy} onClick={() => remove(p.id)}>
                    消す
                  </Button>
                </span>
              </span>
            ) : (
              <span className="sp-actions">
                <Button size="sm" kind="quiet" onClick={() => (setAsking(p.id), setError(null))} disabled={busy}>
                  消す
                </Button>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 自分の写真を読む（読めなければ空の一覧と知らせ）。 */
export function useMyPhotos() {
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchPhotos()
      .then(setPhotos)
      .catch((e) => (setError((e as Error).message), setPhotos([])));
  }, []);
  return { photos, setPhotos, error, remove: async (id: string) => setPhotos(await removePhoto(id)) };
}

/** 設定のアカウントの「自分の写真」。写真が 1 枚でも残っている人にだけ出す（AccountSection、同意を取り消した人も）。見る・消すだけ。 */
export function MyPhotosSection() {
  const { photos, error, remove } = useMyPhotos();
  return (
    <div className="set-row" id="set-my-photos">
      <span className="set-label">
        自分の写真
        <small className="set-help">
          送った空の写真です。研究への協力を取り消しても、写真は残ります（研究には使いません）。消すと元に戻せません。ここでは撮る・送るはできません。
        </small>
      </span>
      {error ? <p className="warn">{error}</p> : null}
      {photos == null ? <p className="set-help">読み込んでいます…</p> : <PhotoList photos={photos} onDelete={remove} empty="写真はもうありません。" />}
    </div>
  );
}

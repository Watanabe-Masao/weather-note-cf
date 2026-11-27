// 自分の空の写真の一覧と削除（段階 1a の見本、2026-11-28）。
// 渡辺さん：「写真の保存は無期限。管理者と撮った本人は削除可能なUIの実装」「おすすめで」（同意を取り消した人も、写真が残って
// いれば設定のアカウントに「自分の写真」の一覧と削除だけを出す。撮る・上げるは無い）。
// 消すと：写真・縮小画像・この写真から来た天気の記録。元に戻せないので、消す前に何が消えるかを出して確かめる。
// **見本なので、まだサーバーに写真は無い**（一覧は作り物。消しても、この画面の中だけ）。

import { useState } from "react";
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
  /** 一覧の小さな絵（見本では色の帯） */
  tone: string;
  note?: string;
}

const jst = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const SAMPLE_PHOTOS: PhotoItem[] = [
  { id: "s1", takenAt: "2026-11-15T16:52:00+09:00", dir: "西", weather: "曇り", tone: "linear-gradient(180deg, #5b6b8c 0%, #c98a5a 70%, #3a2f2a 100%)", note: "西だけ晴れ・雲の切れ目から夕陽" },
  { id: "s2", takenAt: "2026-11-17T16:40:00+09:00", dir: "南西", dirEstimated: true, weather: "雨（パラパラ）", tone: "linear-gradient(180deg, #4a4f57 0%, #6c727b 80%, #2c2f33 100%)" },
  { id: "s3", takenAt: null, dir: null, weather: null, tone: "linear-gradient(180deg, #3d6fb6 0%, #9cc3e8 100%)", note: "撮影時刻が読めなかった写真" },
];

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
          <span className="sp-mini" style={{ background: p.tone }} aria-hidden />
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

/**
 * 設定のアカウントの「自分の写真」。写真が 1 枚でも残っている人にだけ出す（同意を取り消した人も）。見る・消すだけ。
 * 見本のあいだは管理者にだけ、作り物の一覧で出す。
 */
export function MyPhotosSection() {
  const [photos, setPhotos] = useState(SAMPLE_PHOTOS);
  return (
    <div className="set-row" id="set-my-photos">
      <span className="set-label">
        自分の写真（見本）
        <small className="set-help">
          送った空の写真です。研究への協力を取り消しても、写真は残ります（研究には使いません）。消すと元に戻せません。ここでは撮る・送るはできません。
        </small>
      </span>
      <PhotoList photos={photos} onDelete={(id) => setPhotos((l) => l.filter((p) => p.id !== id))} empty="写真はもうありません（見本）。" />
    </div>
  );
}

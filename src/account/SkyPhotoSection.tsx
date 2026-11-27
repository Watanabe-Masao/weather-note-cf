// 空の写真を保存する（段階 1a、2026-11-28。見本は #550）。記録のシートで「空の写真」を選んだとき
// （渡辺さん「場所は記録に。記録タブで肌感か写真を選べるように」）。
// 出るのは「空の写真」の研究に同意した人だけ（11/28 渡辺さん「厳密になので写真の保存は同意した人のみ。そもそも画面にも
// 出さない」）。外の記録のシート（ReportSheet.tsx）と、この画面そのものの両方で確かめる。サーバーも同意を確かめてから保存する。
// 写真は端末で描き直した JPEG にして送る（位置などの情報は落ちる。photos.ts）。撮影情報は決めた項目だけを別に送る。
// 方角は真北にそろえ（磁北なら国土地理院の近似式 2020.0 で直す）、太陽は撮影地点（無ければ高知の観測所）で計算する。
// 写真は決まった時刻でなくてよい（11/27 渡辺さん「固定の時刻に撮影が難しいかもしれません」）。
// 衛星画像を取りに行くのは段階 1c。

import { useMemo, useState } from "react";
import { toTrueNorth } from "../../shared/declination";
import { solarAltitude, solarAzimuth } from "../../shared/sunTimes";
import { Button, Chip } from "../ui/kit";
import { type Intensity, intensitiesOf, intensityTitle, type Sky, SKIES } from "../../shared/nowWeather";
import { useAccount } from "./account";
import { PhotoList, useMyPhotos } from "./MyPhotos";
import { uploadPhoto } from "./photos";
import { newId } from "../beta/reports";
import { compass16, type PhotoExif, readExif, takenIso } from "./exif";

const KOCHI = { lat: 33.5667, lon: 133.5483 };
// 天気は天気の記録（正本、#553）と同じ言葉。写真ならではの様子（西だけ晴れ・まだら）は別に選ぶ。
const LOOKS = ["西だけ晴れ", "まだら"] as const;
const DIRS = [
  { label: "西", deg: 270 },
  { label: "南西", deg: 225 },
  { label: "北西", deg: 315 },
  { label: "南", deg: 180 },
  { label: "東", deg: 90 },
  { label: "真上", deg: -1 },
];

type Picked = { file: File; url: string; exif: PhotoExif; from: "exif" | "file"; id: string };

const jst = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const localInput = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 16);
const fromInput = (v: string) => `${v}:00+09:00`;

/** 撮影時刻の太陽（場所があれば撮影地点、無ければ高知の観測所。サーバーの skyPhotos.ts sunOf と同じ）。 */
function sunAt(iso: string, at: { lat: number; lon: number } | null) {
  const p = at ?? KOCHI;
  const date = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
  const min = (Date.parse(iso) - Date.parse(`${date}T00:00:00+09:00`)) / 60_000;
  return { alt: solarAltitude(date, min, p.lat, p.lon), az: solarAzimuth(date, min, p.lat, p.lon), station: !at };
}
const round2 = (v: number) => Math.round(v * 100) / 100;

export function SkyPhotoSection() {
  // 画面そのものも同意を確かめる（外の記録のシートの出し分けに頼りきらない。11/28 レビュー：肌感だけの同意で写真の案内が出ていた）。
  const { me } = useAccount();
  const granted = !!me?.researchSky?.granted;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [when, setWhen] = useState<string | null>(null);
  const [timeEdited, setTimeEdited] = useState(false);
  /** 手で選んだ方角（真北、-1 は真上）。null なら写真の情報の方角を使う。 */
  const [dir, setDir] = useState<number | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  const [intensity, setIntensity] = useState<Intensity | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const mine = useMyPhotos();

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const exif = readExif(await f.arrayBuffer());
    const iso = takenIso(exif);
    if (picked) URL.revokeObjectURL(picked.url);
    // 送信の ID は選んだときに決める（送り直しても 1 件）。
    setPicked({ file: f, url: URL.createObjectURL(f), exif, from: iso ? "exif" : "file", id: newId() });
    setWhen(iso ?? new Date(f.lastModified).toISOString());
    setTimeEdited(false);
    setDir(null);
    setSaved(null);
    setError(null);
  };
  const e = picked?.exif;
  const place = e?.lat != null && e?.lon != null ? { lat: round2(e.lat), lon: round2(e.lon) } : null;
  const sun = useMemo(() => (when ? sunAt(when, place) : null), [when, place?.lat, place?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  // 写した方角（真北）：手で選んだものか、写真の情報（磁北なら直す）。
  const fromExif = e?.direction != null && dir == null ? toTrueNorth(e.direction, e.directionRef, place, KOCHI) : null;
  const bearing = dir != null ? (dir >= 0 ? dir : null) : (fromExif?.deg ?? null);
  const diff = sun && bearing != null ? Math.round((((bearing - sun.az) % 360) + 540) % 360) - 180 : null;

  const save = () => {
    if (!picked || !when || saving) return;
    setSaving(true);
    setError(null);
    const meta = {
      id: picked.id,
      takenAt: when,
      timeSource: timeEdited ? "manual" : picked.from,
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
      dir: dir != null ? (dir >= 0 ? dir : null) : (e?.direction ?? null),
      dirRef: dir != null ? "T" : (e?.directionRef ?? null),
      dirSource: dir != null ? (dir >= 0 ? "manual" : null) : e?.direction != null ? "exif" : null,
      camera: { make: e?.make, model: e?.model, lens: e?.lens, exposure: e?.exposure, fNumber: e?.fNumber, iso: e?.iso, focalLength: e?.focalLength },
      sky,
      intensity: intensitiesOf(sky) ? intensity : null,
      look,
      note: [dir === -1 ? "真上" : null, note.trim() || null].filter(Boolean).join("・") || null,
    };
    uploadPhoto(picked.file, meta)
      .then((list) => {
        mine.setPhotos(list);
        setSaved(`${jst(when)} の写真を保存しました。`);
        URL.revokeObjectURL(picked.url);
        setPicked(null);
        setSky(null);
        setIntensity(null);
        setLook(null);
        setNote("");
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setSaving(false));
  };

  if (!granted) return null;
  return (
    <>
      <section className="set-group" aria-labelledby="sp-add">
        <h3 id="sp-add">空の写真を保存する</h3>
        <p className="set-lead">
          空の絵の答え合わせに使う写真です。撮れたときに、撮れた時刻で構いません。日の入りの前後の西の空が、いちばん役に立ちます。
        </p>
        <p className="set-help">
          「空の写真」の研究への協力に同意しているので、写真と撮影時刻・方角・場所（約 1 km に丸めたもの）を、名前と切り離して研究に使います。写真の位置などの情報は、送る前にこの端末で外します。写った景色から場所が分かることもあります。同意を取り消すと、この画面は出なくなります（設定のアカウントで変えられます）。
        </p>
        <label className="sp-file">
          <input type="file" accept="image/*" onChange={(ev) => void pick(ev.target.files?.[0])} />
          <span>写真を選ぶ</span>
        </label>
        {picked && (
          <>
            <img className="sp-thumb" src={picked.url} alt="選んだ写真" />
            <dl className="report">
              <dt>撮影時刻</dt>
              <dd>
                <input type="datetime-local" value={when ? localInput(when) : ""} onChange={(ev) => (setWhen(fromInput(ev.target.value)), setTimeEdited(true))} aria-label="撮影時刻（日本時間）" />
                <small>{picked.from === "exif" ? "写真の情報から読みました（違えば直す）" : "写真の情報に無かったので、ファイルの時刻です。直してください"}</small>
              </dd>
              <dt>写した方角</dt>
              <dd>
                <div className="chip-row">
                  {DIRS.map((d) => (
                    <Chip key={d.label} on={dir === d.deg} onClick={() => setDir(d.deg)}>
                      {d.label}
                    </Chip>
                  ))}
                </div>
                <small>
                  {dir != null
                    ? "選んだ方角を使います（おおよそ。推定として保存）"
                    : e?.direction != null
                      ? `写真の情報：${Math.round(e.direction)}°（${e.directionRef === "M" ? "磁北" : e.directionRef === "T" ? "真北" : "基準不明"}）${fromExif?.deg != null && e.directionRef === "M" ? ` → 真北 ${Math.round(fromExif.deg)}°（${compass16(fromExif.deg)}、偏角 西 ${fromExif.declination!.toFixed(1)}°）` : fromExif?.deg != null ? `（${compass16(fromExif.deg)}）` : ""}${fromExif?.estimated ? "・推定" : ""}`
                      : "写真の情報に向きがありません。選んでください"}
                </small>
              </dd>
              <dt>撮った時の太陽</dt>
              <dd>
                {sun ? `高さ ${sun.alt.toFixed(1)}°・方位 ${Math.round(sun.az)}°（${compass16(sun.az)}）${sun.station ? "・高知の観測所で計算" : "・撮った場所で計算"}` : "—"}
                {diff != null && <small>写した方角との差 {diff > 0 ? "+" : ""}{diff}°{Math.abs(diff) < 20 ? "（太陽のほう。太陽が入ると、まわりが白く飛びます）" : ""}</small>}
              </dd>
              <dt>カメラ</dt>
              <dd>
                {e?.model ?? "—"}
                <small>
                  {[e?.exposure ? `1/${Math.round(1 / e.exposure)} 秒` : null, e?.fNumber ? `F${e.fNumber.toFixed(1)}` : null, e?.iso ? `ISO ${e.iso}` : null, e?.focalLength ? `${e.focalLength.toFixed(1)} mm` : null].filter(Boolean).join("・") || "設定は読めませんでした"}
                </small>
              </dd>
              <dt>位置</dt>
              <dd>{e?.lat != null && e?.lon != null ? `${e.lat.toFixed(2)}, ${e.lon.toFixed(2)}（約 1 km に丸めて保存します。細かい位置は残しません）` : "写真の情報にありません（高知の観測所の位置で計算）"}</dd>
              <dt>ファイル</dt>
              <dd>
                {picked.file.type || "不明"}・{(picked.file.size / 1e6).toFixed(1)} MB
              </dd>
            </dl>
            <p className="set-help">撮った時の天気（天気の記録にも入ります）</p>
            <div className="chip-row" role="group" aria-label="撮った時の天気">
              {SKIES.map((k) => (
                <Chip key={k.id} on={sky === k.id} onClick={() => { setSky(sky === k.id ? null : k.id); setIntensity(null); }}>
                  {k.label}
                </Chip>
              ))}
            </div>
            {intensitiesOf(sky) && (
              <div className="chip-row" role="group" aria-label={intensityTitle(sky)!}>
                {intensitiesOf(sky)!.map((k) => (
                  <Chip key={k.id} on={intensity === k.id} onClick={() => setIntensity(intensity === k.id ? null : k.id)}>
                    {k.label}
                  </Chip>
                ))}
              </div>
            )}
            <p className="set-help">空の様子（あれば）</p>
            <div className="chip-row" role="group" aria-label="空の様子">
              {LOOKS.map((w) => (
                <Chip key={w} on={look === w} onClick={() => setLook(look === w ? null : w)}>
                  {w}
                </Chip>
              ))}
            </div>
            <label className="sp-note">
              メモ
              <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={2} placeholder="例：雲の底が赤い、西の山の上だけ晴れ" />
            </label>
            {error ? <p className="warn">{error}</p> : null}
            <Button kind="primary" block busy={saving} onClick={save} disabled={!when || saving}>
              保存する
            </Button>
            <p className="set-help">保存すると、写真は研究用の保存先に入ります（あとで「あなたの写真」から消せます）。選んだ天気は、天気の記録にも 1 件入ります。衛星画像との照合は、次の段階で足します。</p>
          </>
        )}
        {saved ? (
          <p className="set-help" role="status">
            {saved}
          </p>
        ) : null}
      </section>
      <section className="set-group" aria-labelledby="sp-list">
        <h3 id="sp-list">あなたの写真</h3>
        {mine.error ? <p className="warn">{mine.error}</p> : null}
        {mine.photos == null ? <p className="set-help">読み込んでいます…</p> : <PhotoList photos={mine.photos} onDelete={mine.remove} empty="写真はまだありません。" />}
      </section>
    </>
  );
}

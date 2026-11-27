// 見本：空の写真を上げる（2026-11-27 渡辺さん「1・2・3 が貯められる仕組み」の 3、#537）。記録のシートで「空の写真」を選んだとき
// （渡辺さん「場所は記録に。記録タブで肌感か写真を選べるように」）。
// 出るのは「空の写真」の研究に同意した人だけ（11/28 渡辺さん「厳密になので写真の保存は同意した人のみ。そもそも画面にも
// 出さない」）。同意していない人には、記録のシートにこの画面を出さない（ReportSheet.tsx）。写真を受け取るサーバーの処理も、
// 同意（kind 'research-sky'）を確かめてから保存する（作るとき）。
// **見本なので、まだ送らない**（保存先のバケット・受け取り・衛星画像の取得はこのあと）。確かめたいこと：
//   - iPhone で選んだ写真から、撮影時刻・向き・カメラの設定（EXIF）がどこまで読めるか（読めない所は手で直す）
//   - 撮った時の太陽の高さ・方位と、写した方角の差が、その場で分かるか
//   - 上げたら何が起こるか（衛星画像を撮影時刻の前後で取りに行く）が、上げる前に分かるか
// 写真は決まった時刻でなくてよい（11/27 渡辺さん「固定の時刻に撮影が難しいかもしれません」）。

import { useMemo, useState } from "react";
import { solarAltitude, solarAzimuth } from "../../shared/sunTimes";
import { Button, Chip } from "../ui/kit";
import { type Intensity, intensitiesOf, intensityTitle, type Sky, SKIES } from "../../shared/nowWeather";
import { useAccount } from "./account";
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

type Picked = { file: File; url: string; exif: PhotoExif; from: "exif" | "file" };

const jst = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const localInput = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 16);
const fromInput = (v: string) => `${v}:00+09:00`;

function sunAt(iso: string) {
  const date = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
  const min = (Date.parse(iso) - Date.parse(`${date}T00:00:00+09:00`)) / 60_000;
  return { alt: solarAltitude(date, min, KOCHI.lat, KOCHI.lon), az: solarAzimuth(date, min, KOCHI.lat, KOCHI.lon) };
}

/** 衛星画像を取りに行く時刻：撮影時刻の前後 30 分を 10 分ごと（日本域は 2.5 分ごとに出るが、10 分ごとに間引く）。 */
function satelliteTimes(iso: string): string[] {
  const t = Math.round(Date.parse(iso) / 600_000) * 600_000;
  return [-30, -20, -10, 0, 10, 20, 30].map((m) => new Date(t + m * 60_000).toISOString());
}

const SAMPLES = [
  { when: "2026-11-15T16:52:00+09:00", dir: "西", weather: "曇り・西だけ晴れ", sat: "7 時刻・28 枚", note: "雲の切れ目から夕陽" },
  { when: "2026-11-17T16:40:00+09:00", dir: "南西", weather: "雨（パラパラ）", sat: "取れなかった（一覧に無い）", note: "" },
];

export function SkyPhotoSection() {
  // 画面そのものも同意を確かめる（外の記録のシートの出し分けに頼りきらない。11/28 レビュー：肌感だけの同意で写真の案内が出ていた）。
  const { me } = useAccount();
  const granted = !!me?.researchSky?.granted;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [when, setWhen] = useState<string | null>(null);
  const [dir, setDir] = useState<number | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  const [intensity, setIntensity] = useState<Intensity | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const exif = readExif(await f.arrayBuffer());
    const iso = takenIso(exif);
    setPicked({ file: f, url: URL.createObjectURL(f), exif, from: iso ? "exif" : "file" });
    setWhen(iso ?? new Date(f.lastModified).toISOString());
    setDir(exif.direction != null && exif.directionRef !== "M" ? Math.round(exif.direction) : exif.direction != null ? Math.round(exif.direction) : null);
    setShown(false);
  };
  const sun = useMemo(() => (when ? sunAt(when) : null), [when]);
  const e = picked?.exif;
  const diff = sun && dir != null && dir >= 0 ? Math.round((((dir - sun.az) % 360) + 540) % 360) - 180 : null;

  if (!granted) return null;
  return (
    <>
      <section className="set-group" aria-labelledby="sp-add">
        <h3 id="sp-add">空の写真を上げる（見本）</h3>
        <p className="set-lead">
          空の絵の答え合わせに使う写真です。撮れたときに、撮れた時刻で構いません。日の入りの前後の西の空が、いちばん役に立ちます。見本なので、まだ送りません。
        </p>
        <p className="set-help">
          「空の写真」の研究への協力に同意しているので、写真と撮影時刻・方角・場所（約 1 km に丸めたもの）を、名前と切り離して研究に使います。同意を取り消すと、この画面は出なくなります（設定のアカウントで変えられます）。
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
                <input type="datetime-local" value={when ? localInput(when) : ""} onChange={(ev) => setWhen(fromInput(ev.target.value))} aria-label="撮影時刻（日本時間）" />
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
                <small>{e?.direction != null ? `写真の情報：${Math.round(e.direction)}°（${compass16(e.direction)}、${e.directionRef === "M" ? "磁北" : "真北"}基準）` : "写真の情報に向きがありません。選んでください"}</small>
              </dd>
              <dt>撮った時の太陽</dt>
              <dd>
                {sun ? `高さ ${sun.alt.toFixed(1)}°・方位 ${Math.round(sun.az)}°（${compass16(sun.az)}）` : "—"}
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
            <Button onClick={() => setShown(true)} disabled={!when}>
              上げる（見本では送りません）
            </Button>
            {shown && when && (
              <div className="sp-after" role="status">
                <b>上げると、こうなります</b>
                <ul>
                  <li>写真を研究用の保存先に入れます（上限 5 GB。近づいたら止めて知らせます）。写真から位置の情報を外し、場所は約 1 km に丸めて別に記録します。</li>
                  <li>
                    気象庁の衛星画像（ひまわり、日本域）を取りに行きます：{jst(satelliteTimes(when)[0])}〜{jst(satelliteTimes(when).at(-1)!)} の 10 分ごと 7 時刻、赤外とトゥルーカラー、高知と西の 2 枚分（28 枚まで）。
                  </li>
                  <li>気象庁の一覧から消えた時刻は「取れなかった」と記録します（一覧に何時間前まで残るかは、最初の数回で確かめます）。</li>
                  <li>選んだ天気は、天気の記録（正本）にも 1 件入ります（写真と結んで残します）。</li>
                  <li>その日の観測（高知の日照・日射）と予報の履歴は、あとから答え合わせのときに組み合わせます。</li>
                </ul>
              </div>
            )}
          </>
        )}
      </section>
      <section className="set-group" aria-labelledby="sp-list">
        <h3 id="sp-list">あなたの写真（見本の例）</h3>
        <ul className="sp-list">
          {SAMPLES.map((s) => (
            <li key={s.when}>
              <b>
                {jst(s.when)}・{s.dir}・{s.weather}
              </b>
              <small>
                衛星画像：{s.sat}
                {s.note ? `・${s.note}` : ""}
              </small>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// 雨・風の根拠と記録（2026-11-24 渡辺さん「根拠と記録は項目ごとに」「予報の移り変わりを風にも」）：
// その日の降水確率と風の予報が、発表ごとにどう変わったか。気象庁の値だけ（府県天気予報・府県週間天気予報）。
//   - 府県：6時間降水確率（0・6・12・18時から）と、その日の風の文
//   - 週間：日降水確率（風は無い）
//   - 前の同じ種類の発表から変わった値に印（shared/forecastHistoryModel.ts markChanges：区切りの違う値は比べない）
//   - 新しい4回を出し、それより前は畳む。取り置き・取り直しは予報の移り変わりと同じ（src/data/historyCache.ts）。

import { useMemo, useState } from "react";
import { ForecastHistory as Model, issueLabel, leadLabel, oneSource, type Slot, type V } from "../../../shared/forecastHistoryModel";
import { useForecastHistory } from "../../data/historyCache";
import { Badge, Fold } from "../kit";

const jstNow = () => `${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;
const hm = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16);
const SHOWN = 4;

/** 1つの値：値・値なし・その区切りは対象外（—）。 */
const cell = (v: V | null | undefined) => (!v || v.s === "absent" ? "—" : v.s === "none" ? "値なし" : String(v.v));

function Row({ s }: { s: Slot }) {
  const v = s.values!;
  const popChanged = s.changed.has("pop");
  return (
    <li className="rw-row">
      <p className="rw-head">
        <b>{issueLabel(s.at)}</b>
        <Badge kind={s.kind === "VPFD51" ? "府県" : "週間"} />
        <small>{leadLabel(s.lead)}</small>
      </p>
      <p className={popChanged ? "rw-pop chg" : "rw-pop"}>
        <small>降水確率</small>
        {v.pop6 ? (
          <span>
            {v.pop6.map((p, i) => (
              <span key={i} className={s.changed.has(`pop6-${i}`) ? "rw-v chg" : "rw-v"}>
                {cell(p)}
              </span>
            ))}
            <small>%（0・6・12・18時から）</small>
          </span>
        ) : (
          <span>
            <span className="rw-v">{cell(v.popDay)}</span>
            <small>%（1日）</small>
          </span>
        )}
      </p>
      {v.wind && (
        <p className={s.changed.has("wind") ? "rw-wind chg" : "rw-wind"}>
          <small>風{v.wind.from ? `（${v.wind.from}時から）` : ""}</small>
          <span>{v.wind.text.replace(/　/g, " ")}</span>
        </p>
      )}
    </li>
  );
}

export function RainWindHistory({ station, date }: { station: string; date: string }) {
  const h = useForecastHistory(station, date);
  const [older, setOlder] = useState(false);
  const slots = useMemo(() => (h.r?.supported ? oneSource(new Model(h.r).slots(date, jstNow())).filter((s) => s.state === "ok" && s.values) : []), [h.r, date]);
  if (!h.r) return <p className="fh-note">{h.failed ? "予報の移り変わりを読み込めませんでした。時間をおいて開き直してください。" : "予報の移り変わりを読み込み中…"}</p>;
  if (!h.r.supported) return <p className="fh-note">この地点の予報の移り変わりは、まだありません（今は高知だけ）。</p>;
  if (!slots.length) return <p className="fh-note">この日を予報した発表の記録はありません。</p>;
  const recent = slots.slice(-SHOWN);
  const before = slots.slice(0, -SHOWN);
  return (
    <section className="rw" aria-label="降水確率と風の予報の移り変わり">
      <p className="rw-lead">
        降水確率と風の予報が、発表ごとにどう変わったか。<b className="rw-mark">太字</b>は前の同じ種類の発表から変わった値。
        {h.at != null && <small className="fh-checked">{h.loading ? `${hm(h.at)} の分・確かめています…` : h.failed ? `${hm(h.at)} の分（取り直せませんでした）` : `${hm(h.at)} に確認`}</small>}
      </p>
      {before.length > 0 && (
        <Fold open={older} onToggle={() => setOlder(!older)} openLabel={`前の発表も見る（${before.length}回）`} closeLabel="前の発表を閉じる">
          <ol className="rw-list">
            {before.map((s) => (
              <Row key={s.key} s={s} />
            ))}
          </ol>
        </Fold>
      )}
      <ol className="rw-list">
        {recent.map((s) => (
          <Row key={s.key} s={s} />
        ))}
      </ol>
      <p className="rw-src">出典：気象庁（府県天気予報・府県週間天気予報、防災情報XML）。風は府県天気予報だけ（11/24 からの読み直しの分）。</p>
    </section>
  );
}

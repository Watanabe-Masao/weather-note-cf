// 出どころのリンク（2026-11-19 渡辺さん「データソースのリンクを貼るのもいい」）：予報の移り変わりの下の「出典 ⓘ」を
// 開くと、その数字の元を確かめられる。選んでいる発表の原文（アプリが保存した気象庁の電文。気象庁の一覧からは7日で
// 消える）、取り込んだ記録の元、その日の実績（気象庁「過去の気象データ」）、今の予報（気象庁の天気予報）。
// 外のサイトは新しいタブで開く。原文はアプリの中のシートで（閉じると元の位置）。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import stationList from "../../../shared/stations.json";
import { hourOf, KIND_SHORT, md, type Slot } from "../../../shared/forecastHistoryModel";
import { Button, InfoNote } from "../kit";
import { ModalSheet } from "../ModalSheet";

type Station = { precNo: number; blockNo: string; name: string };
const stations = stationList as Station[];

/** 気象庁「過去の気象データ」のその日の1時間ごとの表（気象台・特別地域気象観測所は s1、アメダスは a1）。 */
export function etrnHourlyUrl(station: string, day: string): string | null {
  const s = stations.find((x) => x.blockNo === station || x.name === station);
  if (!s) return null;
  const [y, m, d] = day.split("-").map(Number);
  const page = s.blockNo.length === 5 ? "hourly_s1" : "hourly_a1";
  return `https://www.data.jma.go.jp/stats/etrn/view/${page}.php?prec_no=${s.precNo}&block_no=${s.blockNo}&year=${y}&month=${m}&day=${d}&view=`;
}
export const jmaForecastUrl = (office: string) => `https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=${office}`;
export const SHIROMATZ_URL = "https://github.com/shiromatz/Japan-Meteorological-Agency-Weather-Forecast";

type Telegram = { found: boolean; id: string; kind?: string; office?: string; url?: string; issuedAt?: string; fetchedAt?: string; hash?: string; xml?: string; source?: string };

/** 保存した電文の原文：発表時刻・種類・取得時刻・ハッシュを上に、原文（XML）をそのまま下に。 */
function TelegramSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [t, setT] = useState<Telegram | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`/api/telegram?id=${encodeURIComponent(id)}`)
      .then((r) => r.json() as Promise<Telegram>)
      .then(setT)
      .catch(() => setError(true));
  }, [id]);
  const jst = (iso?: string) => (iso ? new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ") : "—");
  return createPortal(
    <ModalSheet title="発表の原文" onClose={onClose} className="telegram-sheet">
      {error ? <p className="warn">原文を読み込めませんでした。</p> : !t ? <p className="set-help">読み込んでいます…</p> : !t.found ? <p className="set-help">この発表の原文は保存されていません。</p> : (
        <div className="tg">
          <dl className="tg-meta">
            <dt>種類</dt>
            <dd>{t.kind}（予報区 {t.office}）</dd>
            <dt>発表</dt>
            <dd>{jst(t.issuedAt)}</dd>
            <dt>保存</dt>
            <dd>{jst(t.fetchedAt)}</dd>
            <dt>電文</dt>
            <dd className="tg-id">{t.id}</dd>
          </dl>
          <small className="set-help">出典：{t.source}。気象庁の一覧から消えた後も、アプリが保存した写しを開いています（中身は保存したときのまま。ハッシュ {t.hash?.slice(0, 12)}…）。</small>
          <pre className="tg-xml">{t.xml}</pre>
        </div>
      )}
    </ModalSheet>,
    document.body,
  );
}

/** 予報の移り変わりの下の「出典 ⓘ」。 */
export function Sources({ slot, station, day, office }: { slot: Slot | null; station: string; day: string; office: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = slot?.state === "ok" ? slot.shown : null;
  const etrn = etrnHourlyUrl(station, day);
  const a = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
  return (
    <>
      <InfoNote
        className="fh-credit fh-sources"
        more={
          <span className="fh-src-list">
            {shown && slot ? (
              shown.source === "jma-xml" ? (
                <span>
                  選んでいる発表（{md(slot.at.slice(0, 10))} {hourOf(slot.at)}時 {KIND_SHORT[slot.kind]}）：
                  <Button size="sm" onClick={() => setOpen(shown.issue_id)}>
                    原文を見る
                  </Button>
                </span>
              ) : (
                <span>
                  選んでいる発表（{md(slot.at.slice(0, 10))} {hourOf(slot.at)}時 {KIND_SHORT[slot.kind]}）は取り込んだ記録から：{a(SHIROMATZ_URL, "記録の元（shiromatz、GitHub、CC BY-SA 4.0）")}
                </span>
              )
            ) : null}
            {etrn ? <span>実績：{a(etrn, `気象庁「過去の気象データ」${md(day)}（1時間ごと）`)}</span> : null}
            {office ? <span>今の予報：{a(jmaForecastUrl(office), "気象庁「天気予報」")}</span> : null}
          </span>
        }
      >
        出典：気象庁（府県天気予報・府県週間天気予報、防災情報XML）
      </InfoNote>
      {open ? <TelegramSheet id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

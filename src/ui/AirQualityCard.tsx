// 空気の質（2026-11-25 渡辺さん「大気質の UI」、見本の OK）：大気の仲間の画面の下に1枚。
//   - いま（今日）：PM2.5 と黄砂の、今の時の CAMS の予測。過ぎた日・先の日はその日の日平均と最大。
//   - 実測：そらまめくんの介良局の PM2.5（速報値）。今日までの日だけ。11/25 渡辺さん：商用利用でないのでそのまま使ってよい
//     （それまでは管理者だけ）。
//   - 全項目の内訳（ヒートマップ、AirBreakdownSheet）を開くボタン。
//   - 24時間のグラフ（今の時に縦の点線）：PM2.5 と黄砂（どちらもその日の値なので実線、色で分ける。破線は比べる日の決まり）、実測は点。
//   - 読み方：PM2.5 の日平均と環境省の基準、黄砂のいちばん多い時刻、気象庁の黄砂情報は見通しで伝えること。
//   - 出典：予測・実測・基準を分けて書く（design-system 4.0a）。
//   - 欠け（11/25 レビュー）：今の時の値が無ければ —（日平均で埋めない）。グラフは値の無い時間で線を切る。取得の時刻は
//     「M/D H:MM に取得」（モデルの計算の時刻ではない）。2時間以上たった・前の取得の値を含む・終わった日の値を待つ間の予測は
//     そのことを添える（2時間は約1時間ごとの取得から置いた目安）。
import { airAt, airDay, camsWord, dustReading, latestMeasured, measuredMean, pmReading } from "../airSummary";
import { airInRange, useAir, useMeasured } from "../data/air";
import { DATA, lineLook } from "../design/tokens";
import type { AirHour, MeasuredHour } from "../../shared/airQuality";
import { useState } from "react";
import { AirBreakdownSheet } from "./AirBreakdownSheet";
import { Button } from "./kit";
import type { WeatherRow } from "../../shared/types";

const W = 340;
const H = 150;
const LEFT = 28;
const RIGHT = 8;
const TOP = 10;
const BOTTOM = 22;
const TICKS = [0, 6, 12, 18, 23];

const hm = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16) : null);
const mdhm = (iso: string) => {
  const t = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
};
/** 取得からこれ以上たっていれば、そのことを添える（約1時間ごとの取得から置いた目安）。 */
const OLD_MS = 2 * 3_600_000;

function AirChart({ hours, measured, nowH }: { hours: AirHour[]; measured: MeasuredHour[]; nowH: number | null }) {
  const vals = [...hours.flatMap((x) => [x.pm2_5, x.dust]), ...measured.map((x) => x.pm2_5)].filter((v): v is number => v != null);
  const top = Math.max(10, Math.ceil(Math.max(0, ...vals) / 10) * 10);
  const x = (h: number) => LEFT + ((W - LEFT - RIGHT) * h) / 23;
  const y = (v: number) => TOP + (H - TOP - BOTTOM) * (1 - v / top);
  const path = (key: "pm2_5" | "dust") => {
    let d = "";
    let pen = false;
    let prev = -2;
    for (const p of hours) {
      const v = p[key];
      if (p.h !== prev + 1) pen = false; // 時間ごと抜けているところでも線を切る
      prev = p.h;
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.h).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const pm = lineLook("target", DATA.pm25);
  const dust = lineLook("target", DATA.dust);
  const steps = [0, top / 2, top];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="aq-chart" role="img" aria-label="PM2.5 と黄砂の24時間（µg/m³）">
      {steps.map((v) => (
        <g key={v}>
          <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} className="aq-grid" />
          <text x={LEFT - 4} y={y(v) + 3} className="aq-yl">
            {v}
          </text>
        </g>
      ))}
      {TICKS.map((h) => (
        <text key={h} x={x(h)} y={H - 6} className="aq-xl">
          {h}
        </text>
      ))}
      <path d={path("dust")} fill="none" stroke={dust.stroke} strokeWidth={dust.strokeWidth} />
      <path d={path("pm2_5")} fill="none" stroke={pm.stroke} strokeWidth={pm.strokeWidth} />
      {measured
        .filter((m) => m.pm2_5 != null)
        .map((m) => (
          // 実測はその1時間の終わりの時（24 は翌日0時なので右端）
          <circle key={m.hour} cx={x(Math.min(23, m.hour))} cy={y(m.pm2_5!)} r={3.2} className="aq-measured" />
        ))}
      {nowH != null && (
        <g>
          <line x1={x(nowH)} x2={x(nowH)} y1={TOP} y2={H - BOTTOM} className="aq-now" />
          <text x={x(nowH) + 3} y={H - BOTTOM - 4} className="aq-nowl">
            今
          </text>
        </g>
      )}
    </svg>
  );
}

export function AirQualityCard({ station, date, today, hours }: { station: string; date: string; today: string; hours?: WeatherRow[] | null }) {
  const air = useAir(station, date);
  const measured = useMeasured(station, date, date <= today);
  const [detail, setDetail] = useState(false);
  if (air.unsupported) return null;
  if (!airInRange(date, today))
    return (
      <section className="aq" aria-label="空気の質">
        <p className="aq-note">この日の空気の質はありません（CAMS の値は 2023年1月から、予測は今日から5日分）。</p>
      </section>
    );
  const r = air.r;
  const isToday = date === today;
  const nowH = isToday ? new Date(Date.now() + 9 * 3_600_000).getUTCHours() : null;
  const mh = measured.r?.hours ?? [];

  if (!r)
    return (
      <section className="aq" aria-label="空気の質">
        <p className="aq-note">{air.failed ? "空気の質を読み込めませんでした。時間をおいて開き直してください。" : "空気の質を読み込み中…"}</p>
      </section>
    );
  if (!r.hours.length)
    return (
      <section className="aq" aria-label="空気の質">
        <p className="aq-note">この日の空気の質（CAMS）のデータはありません。</p>
      </section>
    );

  const d = airDay(r.hours);
  const at = nowH != null ? airAt(r.hours, nowH) : null;
  const lastM = latestMeasured(mh);
  const meanM = measuredMean(mh);
  const pm = pmReading(d, r.kind);
  // 値の新しさ：古い取得・前の取得の値を含む・終わった日の値を待つ間の予測
  const fresh = [
    r.kind === "forecast" && date < today ? "終わった日の値がまだ届いていないので、保存しておいた予測を出しています" : null,
    r.fetchedAt && r.kind === "forecast" && Date.now() - Date.parse(r.fetchedAt) >= OLD_MS ? "取得から2時間以上たっています" : null,
    r.olderHours ? `${r.olderHours}時間分は、前に取得した値のままです` : null,
  ].filter((t): t is string => t != null);
  const dust = dustReading(d, r.kind);
  return (
    <section className="aq" aria-label="空気の質">
      <div className="dd-now" role="group" aria-label="空気の質の値">
        <p className="dd-now-head">
          空気の質<small>{camsWord(r.kind)}（モデル、約45km の格子）{nowH != null ? `・${nowH}時` : "・日平均と最大"}</small>
        </p>
        <div className="dd-now-vals">
          <span className="dd-now-val">
            <small>PM2.5{nowH != null ? "" : d.pmHours < 24 ? ` ${d.pmHours}時間の平均` : " 日平均"}</small>
            <b className="tone-pm25">{nowH != null ? (at?.pm2_5 != null ? Math.round(at.pm2_5) : "—") : d.pmMean != null ? Math.round(d.pmMean) : "—"}</b>
            <small>µg/m³</small>
          </span>
          <span className="dd-now-val">
            <small>黄砂{nowH != null ? "" : " 最大"}</small>
            <b className="tone-dust">{nowH != null ? (at?.dust != null ? Math.round(at.dust) : "—") : d.dustMax ? Math.round(d.dustMax.v) : "—"}</b>
            <small>µg/m³</small>
          </span>
        </div>
        {date <= today && (
          <p className="aq-measured-line">
            {measured.r == null ? (
              <span>{measured.failed ? "実測を読み込めませんでした" : measured.loading ? "実測を読み込み中…" : "実測はありません"}</span>
            ) : isToday && lastM ? (
              <span>
                実測 PM2.5 <b>{Math.round(lastM.pm2_5!)}</b> µg/m³（{lastM.hour - 1}〜{lastM.hour}時）
              </span>
            ) : meanM ? (
              <span>
                実測 PM2.5 日平均 <b>{Math.round(meanM.mean)}</b> µg/m³{meanM.n < 24 ? `（${meanM.n}時間分）` : ""}
              </span>
            ) : (
              <span>この日の実測はありません</span>
            )}
            {measured.r && (
              <small>
                環境省 そらまめくん・{measured.r.name}（速報値）{measured.r.checkedAt ? `・${hm(measured.r.checkedAt)} に確認` : ""}
              </small>
            )}
          </p>
        )}
      </div>

      <div className="aq-chartbox">
        <p className="aq-title">PM2.5 と黄砂（24時間、µg/m³）</p>
        <AirChart hours={r.hours} measured={mh} nowH={nowH} />
        <p className="aq-legend">
          <span className="aq-key pm" />
          PM2.5（{r.kind === "forecast" ? "予測" : "モデル"}）
          <span className="aq-key dust" />
          黄砂（{r.kind === "forecast" ? "予測" : "モデル"}）
          {mh.length > 0 && (
            <>
              <span className="aq-key dot" />
              PM2.5 の実測（介良局）
            </>
          )}
        </p>
        <Button size="sm" className="aq-more" onClick={() => setDetail(true)}>
          全項目の内訳（ヒートマップ）
        </Button>
      </div>
      {detail && <AirBreakdownSheet air={r} measured={date <= today ? measured.r : null} hours={hours} date={date} today={today} onClose={() => setDetail(false)} />}

      <div className="aq-read">
        {pm && (
          <p>
            <b>PM2.5</b>：{pm}
          </p>
        )}
        <p className="aq-small">環境省の環境基準は 1日平均 35 µg/m³ 以下、注意喚起の目安（暫定的な指針）は 1日平均 70 µg/m³ を超えるとき。CAMS は約45km の格子の値で、高知市の中の場所による違いは表せません。</p>
        {dust && (
          <p>
            <b>黄砂</b>：{dust}。
          </p>
        )}
        <p className="aq-small">気象庁の黄砂情報は、見通し（視程）で黄砂の強さを伝えています。この画面の視程も合わせて見てください。</p>
      </div>

      <div className="aq-src">
        <span>
          {r.kind === "forecast" ? "予測" : "モデルの値"}：Copernicus Atmosphere Monitoring Service（CAMS）、Open-Meteo.com（CC BY 4.0）{r.fetchedAt ? `・${mdhm(r.fetchedAt)} に取得` : ""}
        </span>
        {fresh.map((t) => (
          <span key={t} className="aq-stale">
            {t}
          </span>
        ))}
        {date <= today && <span>実測：環境省 大気汚染物質広域監視システム（そらまめくん）。データの著作権は環境省・高知市など</span>}
        <span>基準：環境省</span>
      </div>
    </section>
  );
}

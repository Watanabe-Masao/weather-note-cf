// 空気の質（2026-11-25 渡辺さん「大気質の UI」、見本の OK）：大気の仲間の画面の下に1枚。
//   - いま（今日）：PM2.5 と黄砂の、今の時の CAMS の予測。過ぎた日・先の日はその日の日平均と最大。
//   - 実測（管理者だけ）：そらまめくんの介良局の PM2.5（速報値）。条件が「個人利用」なので、ほかの人には出さない。
//   - 24時間のグラフ（今の時に縦の点線）：PM2.5 と黄砂（どちらもその日の値なので実線、色で分ける。破線は比べる日の決まり）、実測は点。
//   - 読み方：PM2.5 の日平均と環境省の基準、黄砂のいちばん多い時刻、気象庁の黄砂情報は見通しで伝えること。
//   - 出典：予測・実測・基準を分けて書く（design-system 4.0a）。
import { airAt, airDay, camsWord, dustReading, latestMeasured, measuredMean, pmReading } from "../airSummary";
import { useAccount } from "../account/account";
import { airInRange, useAir, useMeasured } from "../data/air";
import { DATA, lineLook } from "../design/tokens";
import type { AirHour, MeasuredHour } from "../../shared/airQuality";

const W = 340;
const H = 150;
const LEFT = 28;
const RIGHT = 8;
const TOP = 10;
const BOTTOM = 22;
const TICKS = [0, 6, 12, 18, 23];

const hm = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16) : null);

function AirChart({ hours, measured, nowH }: { hours: AirHour[]; measured: MeasuredHour[]; nowH: number | null }) {
  const vals = [...hours.flatMap((x) => [x.pm2_5, x.dust]), ...measured.map((x) => x.pm2_5)].filter((v): v is number => v != null);
  const top = Math.max(10, Math.ceil(Math.max(0, ...vals) / 10) * 10);
  const x = (h: number) => LEFT + ((W - LEFT - RIGHT) * h) / 23;
  const y = (v: number) => TOP + (H - TOP - BOTTOM) * (1 - v / top);
  const path = (key: "pm2_5" | "dust") => {
    let d = "";
    let pen = false;
    for (const p of hours) {
      const v = p[key];
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

export function AirQualityCard({ station, date, today }: { station: string; date: string; today: string }) {
  const admin = useAccount().me?.role === "admin";
  const air = useAir(station, date);
  const measured = useMeasured(station, date, admin && date <= today);
  if (air.unsupported || !airInRange(date, today)) return null;
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
  const dust = dustReading(d, r.kind);
  return (
    <section className="aq" aria-label="空気の質">
      <div className="dd-now" role="group" aria-label="空気の質の値">
        <p className="dd-now-head">
          空気の質<small>{camsWord(r.kind)}（モデル、約45km の格子）{at ? `・${at.h}時` : "・日平均と最大"}</small>
        </p>
        <div className="dd-now-vals">
          <span className="dd-now-val">
            <small>PM2.5{at ? "" : " 日平均"}</small>
            <b className="tone-pm25">{at?.pm2_5 != null ? Math.round(at.pm2_5) : d.pmMean != null ? Math.round(d.pmMean) : "—"}</b>
            <small>µg/m³</small>
          </span>
          <span className="dd-now-val">
            <small>黄砂{at ? "" : " 最大"}</small>
            <b className="tone-dust">{at?.dust != null ? Math.round(at.dust) : d.dustMax ? Math.round(d.dustMax.v) : "—"}</b>
            <small>µg/m³</small>
          </span>
        </div>
        {admin && (
          <p className="aq-measured-line">
            <span className="aq-admin">管理者だけ</span>
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
        <AirChart hours={r.hours} measured={admin ? mh : []} nowH={nowH} />
        <p className="aq-legend">
          <span className="aq-key pm" />
          PM2.5（{r.kind === "forecast" ? "予測" : "モデル"}）
          <span className="aq-key dust" />
          黄砂（{r.kind === "forecast" ? "予測" : "モデル"}）
          {admin && (
            <>
              <span className="aq-key dot" />
              PM2.5 の実測（管理者だけ）
            </>
          )}
        </p>
      </div>

      <div className="aq-read">
        {pm && (
          <p>
            <b>PM2.5</b>：{pm}
          </p>
        )}
        <p className="aq-small">環境省の環境基準は 1日平均 35 µg/m³ 以下、注意喚起の目安（暫定的な指針）は 1日平均 70 µg/m³ 以上。CAMS は約45km の格子の値で、高知市の中の場所による違いは表せません。</p>
        {dust && (
          <p>
            <b>黄砂</b>：{dust}。
          </p>
        )}
        <p className="aq-small">気象庁の黄砂情報は、見通し（視程）で黄砂の強さを伝えています。この画面の視程も合わせて見てください。</p>
      </div>

      <div className="aq-src">
        <span>
          {r.kind === "forecast" ? "予測" : "モデルの値"}：Copernicus Atmosphere Monitoring Service（CAMS）、Open-Meteo.com（CC BY 4.0）{r.fetchedAt ? `・${hm(r.fetchedAt)} に取得` : ""}
        </span>
        {admin && <span>実測：環境省 大気汚染物質広域監視システム（そらまめくん）。データの著作権は環境省・高知市など</span>}
        <span>基準：環境省</span>
      </div>
    </section>
  );
}

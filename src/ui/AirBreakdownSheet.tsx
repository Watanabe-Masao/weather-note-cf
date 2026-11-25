// 空気の質の内訳（2026-11-25 渡辺さん「内訳の詳細画面」→ 空気の質の全項目）：空気の質の画面の「全項目の内訳」から開くシート。
//   - CAMS（モデルの値、だれでも）：PM2.5・PM10・黄砂・AOD。
//   - 実測（そらまめくん 介良局の速報値、管理者だけ）：PM2.5・光化学オキシダント・SPM・NO2・SO2・風。
//   - 項目ごとに：今（今日）か日平均・最大、24時間の小さな線（値の無い時間で切る）、何の値か、基準と読み（airBreakdown.ts）。
//   - 誰の値かは見出しで分け、基準（環境省）は項目の下に（design-system 4.0a）。
import { type BreakdownItem, camsItems, fmt, lastWind, measuredItems, stats } from "../airBreakdown";
import { camsWord } from "../airSummary";
import type { AirResponse, MeasuredResponse } from "../../shared/airQuality";
import { ModalSheet } from "./ModalSheet";

const W = 300;
const H = 40;
const PAD = 3;

function Spark({ item, nowH, tone }: { item: BreakdownItem; nowH: number | null; tone: string }) {
  const s = stats(item.points);
  const top = Math.max(s.max?.v ?? 0, item.scaleTop ?? 0) || 1;
  const x = (h: number) => PAD + ((W - 2 * PAD) * h) / 23;
  const y = (v: number) => H - PAD - ((H - 2 * PAD) * v) / top;
  let d = "";
  let prev = -2;
  for (const p of item.points) {
    d += `${p.x === prev + 1 ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.v).toFixed(1)}`;
    prev = p.x;
  }
  return (
    <div className="abd-sparkbox">
    <span className="abd-top">
      上端 {fmt(top, item.digits)}
      {item.scaleTop && top === item.scaleTop ? "（基準の値）" : ""}
    </span>
    <svg viewBox={`0 0 ${W} ${H}`} className="abd-spark" preserveAspectRatio="none" aria-hidden="true">
      <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} className="aq-grid" />
      {nowH != null && <line x1={x(nowH)} x2={x(nowH)} y1={0} y2={H} className="aq-now" />}
      <path d={d} fill="none" className={`abd-line ${tone}`} vectorEffect="non-scaling-stroke" />
      {item.points.length === 1 && <circle cx={x(item.points[0].x)} cy={y(item.points[0].v)} r={2} className={`abd-dot ${tone}`} />}
    </svg>
    </div>
  );
}

function Row({ item, nowH, latest, extra }: { item: BreakdownItem; nowH: number | null; latest: "now" | "last" | "day"; extra?: string }) {
  const s = stats(item.points);
  const unit = item.unit ? ` ${item.unit}` : "";
  const nowP = latest === "now" ? (item.points.find((p) => p.x === nowH) ?? null) : latest === "last" ? s.last : null;
  const head =
    latest === "now" ? (nowP ? fmt(nowP.v, item.digits) : "—") : latest === "last" ? (nowP ? fmt(nowP.v, item.digits) : "—") : s.mean != null ? fmt(s.mean, item.digits) : "—";
  const headLabel = latest === "now" ? `${nowH}時` : latest === "last" ? (nowP ? `${nowP.x}時台` : "いちばん新しい値") : s.n < 24 ? `${s.n}時間の平均` : "日平均";
  const tone = item.key === "pm25" ? "pm25" : item.key === "dust" ? "dust" : "plain";
  return (
    <li className="abd-row" data-key={item.key}>
      <div className="abd-head">
        <span className="abd-name">{item.name}</span>
        <span className="abd-val">
          <small>{headLabel}</small>
          <b className={tone === "plain" ? undefined : `tone-${tone}`}>{head}</b>
          <small>{item.unit}</small>
        </span>
      </div>
      <Spark item={item} nowH={nowH} tone={tone} />
      <p className="abd-sub">
        {s.n
          ? `${s.n < 24 ? `取得できた ${s.n}時間の平均` : "日平均"} ${fmt(s.mean!, item.digits)}${unit}・最大 ${fmt(s.max!.v, item.digits)}${unit}（${s.max!.x}時${item.span ? "台" : ""}）`
          : "この日の値はありません"}
        {extra ? `・${extra}` : ""}
      </p>
      <p className="abd-about">{item.about}</p>
      {item.standard && <p className="abd-std">{item.standard}</p>}
    </li>
  );
}

export function AirBreakdownSheet({
  air,
  measured,
  date,
  today,
  admin,
  onClose,
}: {
  air: AirResponse;
  measured: MeasuredResponse | null;
  date: string;
  today: string;
  admin: boolean;
  onClose: () => void;
}) {
  const isToday = date === today;
  const nowH = isToday ? new Date(Date.now() + 9 * 3_600_000).getUTCHours() : null;
  const cams = camsItems(air.hours);
  const mh = measured?.hours ?? [];
  const wind = lastWind(mh);
  const [m, d] = date.slice(5).split("-").map(Number);
  return (
    <ModalSheet title={`空気の質の内訳・${m}/${d}`} onClose={onClose} className="abd-sheet">
      <div className="abd">
        <section aria-labelledby="abd-cams">
          <h3 id="abd-cams" className="abd-h">
            {camsWord(air.kind)}
            <small>モデル、約45km の格子・だれでも</small>
          </h3>
          <ul className="abd-list">
            {cams.map((it) => (
              <Row key={it.key} item={it} nowH={nowH} latest={isToday ? "now" : "day"} />
            ))}
          </ul>
        </section>

        {admin && (
          <section aria-labelledby="abd-meas">
            <h3 id="abd-meas" className="abd-h">
              実測：{measured?.name ?? "高知市 介良局"}
              <small>
                <span className="aq-admin">管理者だけ</span> そらまめくん・速報値
              </small>
            </h3>
            {mh.length ? (
              <ul className="abd-list">
                {measuredItems(mh).map((it) => (
                  <Row key={it.key} item={it} nowH={nowH} latest={isToday ? "last" : "day"} extra={it.key === "ws" && wind ? `風向 ${wind.word}（${wind.hour - 1}時台）` : undefined} />
                ))}
              </ul>
            ) : (
              <p className="aq-note">{measured ? "この日の実測はありません。" : "実測を読み込み中…"}</p>
            )}
          </section>
        )}

        <div className="aq-src">
          <span>モデルの値：Copernicus Atmosphere Monitoring Service（CAMS）、Open-Meteo.com（CC BY 4.0）</span>
          {admin && <span>実測：環境省 大気汚染物質広域監視システム（そらまめくん）。データの著作権は環境省・高知市など</span>}
          <span>基準：環境省「大気汚染に係る環境基準」「微小粒子状物質による大気の汚染に係る環境基準」、大気汚染防止法（光化学オキシダントの注意報）</span>
        </div>
      </div>
    </ModalSheet>
  );
}

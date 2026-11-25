// 比較の「空気」（2026-11-25 渡辺さん「比較も利用できるように」「どのようにデータを見せ、比較すべきか」「分かりやすいか」）。
//
// 日別（AirCompareDays）：対象の日の前後3日（表・ほかの項目の日別と同じ7日）を、上下3段で（横軸をそろえる、design-system 4.1）。
//   PM2.5（その日の平均、CAMS）／黄砂（その日の最大、CAMS）／視程（その日の最小、気象庁。表の「視程最小」と同じ値）。
//   対象の日は実線と塗った点、比べる日は破線と白抜きの点（線の決まり：破線＝比べる日）。数は対象の日だけに添える。
//   先の日（CAMS の予測）は斜線の地。値の無い日は線を切る（0 にしない）。日を押すとその日の時間帯へ。
//   PM2.5 の段には、値が 25 を超える日があるときだけ環境基準（日平均 35）の線を引く（日の平均どうしなので比べてよい）。
// 時間帯（AirCompareHours）：2つの日の PM2.5・黄砂の24時間を2段で重ね、介良局の実測を点（対象＝塗り、比べる日＝白抜き）。
//   視程の24時間は、その下のいつもの視程のグラフ（HourCompare）で。
// 説明・出典は ⓘ に畳む。
import { type ReactNode, useId } from "react";
import { addDays } from "../../shared/dates";
import { dayTone } from "../../shared/holidays";
import { hourlyExtreme } from "../chartMetrics";
import { useAir, useAirDays, useMeasured } from "../data/air";
import type { WeatherStore } from "../data/store";
import { DATA, lineLook, RADIUS } from "../design/tokens";
import { ForecastHatch, InfoNote } from "./kit";

const W = 340;
const LEFT = 30;
const RIGHT = 10;

const nice = (v: number, min: number) => {
  const top = Math.max(min, v);
  const step = top <= 10 ? 5 : top <= 50 ? 10 : top <= 100 ? 20 : 50;
  return Math.ceil(top / step) * step;
};
const fmt = (v: number | null, digits: number) => (v == null ? "" : digits ? v.toFixed(digits) : String(Math.round(v)));
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const dayOfWeek = (d: string) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];

interface PanelSpec {
  key: string;
  label: string;
  color: string;
  digits: number;
  top: number;
  a: (number | null)[];
  b: (number | null)[];
  guide?: { v: number; text: string };
  /** 数を添えない値。 */
  skip?: (v: number) => boolean;
}

/** 上下に並べる段（横は日または時）。点の x は fx(i)。 */
function Panels({
  panels,
  n,
  fx,
  heights,
  hatch,
  xLabels,
  onPick,
  numbers,
  extra,
  aria,
}: {
  panels: PanelSpec[];
  n: number;
  fx: (i: number) => number;
  heights: number[];
  hatch?: boolean[];
  xLabels: ReactNode;
  onPick?: (i: number) => void;
  /** 対象の日の数を添える（値が skip を満たすときは添えない：視程の 20km＝上限、毎日並ぶと読みにくい）。 */
  numbers?: boolean;
  extra?: (panel: PanelSpec, y: (v: number) => number) => ReactNode;
  aria: string;
}) {
  const hid = useId();
  const GAP = 30;
  const tops: number[] = [];
  let at = 18;
  for (const h of heights) {
    tops.push(at);
    at += h + GAP;
  }
  const H = at - GAP + 34;
  const colW = (W - LEFT - RIGHT) / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ac-chart" role="img" aria-label={aria}>
      <defs>
        <ForecastHatch id={hid} />
      </defs>
      {hatch?.map((f, i) => f && <rect key={i} x={fx(i) - colW / 2} width={colW} y={0} height={H - 30} fill={`url(#${hid})`} className="ac-hatch" />)}
      {panels.map((p, k) => {
        const y = (v: number) => tops[k] + heights[k] * (1 - v / p.top);
        const line = (vals: (number | null)[]) => {
          let d = "";
          let pen = false;
          vals.forEach((v, i) => {
            if (v == null) {
              pen = false;
              return;
            }
            d += `${pen ? "L" : "M"}${fx(i).toFixed(1)},${y(v).toFixed(1)}`;
            pen = true;
          });
          return d;
        };
        const la = lineLook("target", p.color);
        const lb = lineLook("compare", p.color);
        return (
          <g key={p.key}>
            {[0, p.top].map((v) => (
              <g key={v}>
                <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} className="aq-grid" />
                <text x={LEFT - 4} y={y(v) + 3} className="aq-yl">
                  {v}
                </text>
              </g>
            ))}
            {p.guide && (
              <g>
                <line x1={LEFT} x2={W - RIGHT} y1={y(p.guide.v)} y2={y(p.guide.v)} className="ac-guide" />
                <text x={W - RIGHT} y={y(p.guide.v) - 3} className="ac-guide-l">
                  {p.guide.text}
                </text>
              </g>
            )}
            <text x={LEFT} y={tops[k] - 6} className="aq-pl">
              {p.label}
            </text>
            <path d={line(p.b)} fill="none" stroke={lb.stroke} strokeWidth={lb.strokeWidth} strokeDasharray={lb.strokeDasharray} opacity={lb.opacity} />
            <path d={line(p.a)} fill="none" stroke={la.stroke} strokeWidth={la.strokeWidth} />
            {p.b.map((v, i) => v != null && <circle key={`b${i}`} cx={fx(i)} cy={y(v)} r={2.6} className="ac-dot-b" stroke={p.color} opacity={lb.opacity} />)}
            {p.a.map((v, i) => v != null && <circle key={`a${i}`} cx={fx(i)} cy={y(v)} r={2.8} fill={p.color} />)}
            {numbers &&
              p.a.map(
                (v, i) =>
                  v != null &&
                  !(p.skip && p.skip(v)) && (
                    <text key={`t${i}`} x={fx(i)} y={y(v) - 6} className="ac-num">
                      {fmt(v, p.digits)}
                    </text>
                  ),
              )}
            {extra?.(p, y)}
          </g>
        );
      })}
      <g transform={`translate(0, ${H - 28})`}>{xLabels}</g>
      {onPick &&
        Array.from({ length: n }, (_, i) => (
          // 日の列そのものを押す（列の全体が押せる範囲、44px 以上の高さ）
          <rect key={`p${i}`} x={fx(i) - colW / 2} width={colW} y={0} height={H} className="ac-hit" onClick={() => onPick(i)} />
        ))}
    </svg>
  );
}

export function AirCompareDays({
  store,
  station,
  target,
  partner,
  today,
  onPickDay,
}: {
  store: WeatherStore | null;
  station: string;
  target: string;
  partner: (d: string) => string | null;
  today: string;
  onPickDay?: (d: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(target, i - 3));
  const partners = days.map(partner);
  const air = useAirDays(station, [...days, ...partners]);
  const pmA = days.map((d) => air.get(d)?.pmMean ?? null);
  const pmB = partners.map((d) => (d ? (air.get(d)?.pmMean ?? null) : null));
  const duA = days.map((d) => air.get(d)?.dustMax ?? null);
  const duB = partners.map((d) => (d ? (air.get(d)?.dustMax ?? null) : null));
  const vis = (d: string | null) => (d ? hourlyExtreme(store?.getHours(station, d).rows ?? null, "visibility", "min") : null);
  const viA = days.map(vis);
  const viB = partners.map(vis);
  const pmMax = Math.max(0, ...[...pmA, ...pmB].filter((v): v is number => v != null));
  const panels: PanelSpec[] = [
    { key: "pm", label: "PM2.5（1日の平均）µg/m³", color: DATA.pm25, digits: 0, top: nice(pmMax * 1.2, 20), a: pmA, b: pmB, guide: pmMax > 25 ? { v: 35, text: "環境基準 35" } : undefined },
    { key: "dust", label: "黄砂（1日の最大）µg/m³", color: DATA.dust, digits: 0, top: nice(Math.max(0, ...[...duA, ...duB].filter((v): v is number => v != null)) * 1.2, 10), a: duA, b: duB },
    { key: "vis", label: "視程（1日の最小）km", color: DATA.visibility, digits: 1, top: 20, a: viA, b: viB, skip: (v) => v >= 20 },
  ];
  const colW = (W - LEFT - RIGHT) / 7;
  const fx = (i: number) => LEFT + colW * (i + 0.5);
  const none = days.every((d) => air.get(d)?.kind === "none") && partners.every((d) => !d || air.get(d)?.kind === "none");
  return (
    <div className="ac">
      <Panels
        panels={panels}
        n={7}
        fx={fx}
        heights={[64, 44, 52]}
        hatch={days.map((d) => d > today)}
        numbers
        onPick={onPickDay ? (i) => onPickDay(days[i]) : undefined}
        aria="PM2.5・黄砂・視程の日別（対象の日と比べる日）"
        xLabels={days.map((d, i) => (
          <g key={d}>
            {d === target && <rect x={fx(i) - colW / 2 + 1} width={colW - 2} y={0} height={26} rx={RADIUS.xs} className="ac-target" />}
            <text x={fx(i)} y={11} className={`ac-xl${d === target ? " on" : ""}${dayTone(d) ? ` ${dayTone(d)}` : ""}`}>
              {Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}
            </text>
            <text x={fx(i)} y={23} className={`ac-xl wd${dayTone(d) ? ` ${dayTone(d)}` : ""}`}>
              {dayOfWeek(d)}
            </text>
          </g>
        ))}
      />
      <p className="aq-legend">
        <span className="ac-key a" />
        対象の日
        <span className="ac-key b" />
        比べる日
        <span className="ac-key hatch" />
        予測
        <span className="ac-hint">日を押すと時間帯</span>
      </p>
      {air.loading && <p className="aq-note">読み込み中…</p>}
      {air.failed && <p className="aq-note">PM2.5・黄砂を読み込めませんでした。</p>}
      {none && !air.loading && <p className="aq-note">この期間の PM2.5・黄砂（CAMS）はありません（2023年1月から、今日の5日先まで）。</p>}
      <InfoNote
        className="aq-src"
        more={
          <>
            <span className="aq-src-line">PM2.5 は1日の1時間値の平均、黄砂は1日のいちばん多い値（どちらも CAMS のモデルの値、約45km の格子）。先の日は予測です。</span>
            <span className="aq-src-line">視程は1日の1時間値のいちばん小さい値で、表の「視程最小」と同じです（気象庁。予報の時間は Open-Meteo）。</span>
            <span className="aq-src-line">環境基準の線（日平均 35 µg/m³ 以下）は、日の平均どうしで比べるために、値が 25 を超える日があるときだけ引きます。</span>
            <span className="aq-src-line">出典：CAMS・Open-Meteo.com（CC BY 4.0）、気象庁。基準：環境省。</span>
          </>
        }
      >
        <span className="aq-src-short">出典：CAMS・気象庁 ／ 基準：環境省</span>
      </InfoNote>
    </div>
  );
}

/** 時間帯：2つの日の PM2.5・黄砂の24時間（視程はその下のいつものグラフ）。 */
export function AirCompareHours({ station, target, other, today }: { station: string; target: string; other: string | null; today: string }) {
  const a = useAir(station, target);
  const b = useAir(station, other ?? target, !!other);
  const ma = useMeasured(station, target, target <= today);
  const mb = useMeasured(station, other ?? target, !!other && other <= today);
  if (a.unsupported) return null;
  const at = (r: typeof a.r, k: "pm2_5" | "dust") => Array.from({ length: 24 }, (_, h) => r?.hours.find((x) => x.h === h)?.[k] ?? null);
  const pmA = at(a.r, "pm2_5");
  const pmB = other ? at(b.r, "pm2_5") : Array(24).fill(null);
  const duA = at(a.r, "dust");
  const duB = other ? at(b.r, "dust") : Array(24).fill(null);
  const mA = ma.r?.hours.filter((m) => m.pm2_5 != null) ?? [];
  const mB = other ? (mb.r?.hours.filter((m) => m.pm2_5 != null) ?? []) : [];
  const pmMax = Math.max(0, ...[...pmA, ...pmB, ...mA.map((m) => m.pm2_5), ...mB.map((m) => m.pm2_5)].filter((v): v is number => v != null));
  const panels: PanelSpec[] = [
    { key: "pm", label: "PM2.5 µg/m³", color: DATA.pm25, digits: 0, top: nice(pmMax, 20), a: pmA, b: pmB },
    { key: "dust", label: "黄砂 µg/m³", color: DATA.dust, digits: 0, top: nice(Math.max(0, ...[...duA, ...duB].filter((v): v is number => v != null)), 10), a: duA, b: duB },
  ];
  const fx = (h: number) => LEFT + ((W - LEFT - RIGHT) * h) / 24;
  const nowH = target === today ? new Date(Date.now() + 9 * 3_600_000).getUTCHours() : null;
  if (!a.r?.hours.length && !b.r?.hours.length) return a.loading ? <p className="aq-note">PM2.5・黄砂を読み込み中…</p> : null;
  return (
    <div className="ac ac-hours">
      <Panels
        panels={panels}
        n={24}
        fx={fx}
        heights={[64, 44]}
        aria="PM2.5・黄砂の24時間（対象の日と比べる日）"
        extra={(p, y) =>
          p.key === "pm" ? (
            <>
              {mB.map((m) => (
                <rect key={`mb${m.hour}`} x={fx(m.hour - 0.5) - 2.5} y={y(m.pm2_5!) - 2.5} width={5} height={5} className="ac-meas-b" />
              ))}
              {mA.map((m) => (
                <rect key={`ma${m.hour}`} x={fx(m.hour - 0.5) - 2.5} y={y(m.pm2_5!) - 2.5} width={5} height={5} className="ac-meas-a" />
              ))}
              {nowH != null && <line x1={fx(nowH)} x2={fx(nowH)} y1={0} y2={y(0)} className="aq-now" />}
            </>
          ) : null
        }
        xLabels={[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={fx(h)} y={11} className="ac-xl">
            {h}
          </text>
        ))}
      />
      <p className="aq-legend">
        <span className="ac-key a" />
        対象の日
        <span className="ac-key b" />
        比べる日（CAMS）
        <span className="ac-key meas" />
        PM2.5 の実測（介良局）
      </p>
    </div>
  );
}

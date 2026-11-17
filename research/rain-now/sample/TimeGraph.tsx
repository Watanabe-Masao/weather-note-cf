// 2段のグラフで横軸を共有する（Shared X-axis）：上は雨の強さ（5分ごと、mm/h）、下は1時間の降水量（mm）。
// 同じ時刻はいつも同じ横の位置。「今」の線・予測の網かけ・選んだ時刻は上下を通して1本。時刻の目盛りは下に1組だけ。
// 表示の幅は 6・12・24時間で切り替え、上下に同時にかかる。粒度（5分・1時間）はそのまま：1時間の棒はその1時間の幅。
// データの無い所（5分ごとは3時間前〜1時間先だけ、1時間ごとの予測は15時間先まで）は空けて、「なし」と書く。
import { useRef, type PointerEvent as RPE } from "react";
import { ForecastHatch } from "../../../src/ui/kit";
import { colorOf, FRAMES, hourly, isAmount, minuteLabel, NOWCAST, pointSeries } from "./data";

const W = 330;
const PAD_L = 26;
const PAD_R = 8;
export const SPANS = { "6": { from: -180, to: 180, tick: 60 }, "12": { from: -240, to: 480, tick: 120 }, "24": { from: -360, to: 1080, tick: 180 } } as const;
export type Span = keyof typeof SPANS;

export function TimeGraph({ m, span, onPick }: { m: number; span: Span; onPick: (m: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const { from, to, tick } = SPANS[span];
  const x = (t: number) => PAD_L + ((t - from) / (to - from)) * (W - PAD_L - PAD_R);
  const R1 = { top: 16, base: 92 };
  const R2 = { top: 116, base: 182 };
  const H = 214;
  const max1 = Math.ceil(Math.max(20, ...pointSeries.map((p) => p.v)) / 10) * 10;
  const max2 = Math.ceil((Math.max(4, ...hourly.map((p) => p.mm)) * 1.2) / 2) * 2;
  const y1 = (v: number) => R1.base - (v / max1) * (R1.base - R1.top);
  const y2 = (v: number) => R2.base - (v / max2) * (R2.base - R2.top);
  const inView = (t0: number, t1: number) => t1 > from && t0 < to;
  const cx = (t: number) => Math.max(PAD_L, Math.min(W - PAD_R, x(t)));
  const pick = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = from + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (to - from);
    // 地図のこまに寄せる：1時間先までは5分ごと、その先は1時間ごと（その1時間の終わり）
    const snapped = t > 60 ? Math.min(FRAMES.at(-1)!, Math.ceil(t / 60) * 60) : Math.max(FRAMES[0], Math.round(t / 5) * 5);
    onPick(snapped);
  };
  const selH = Math.ceil(m / 60);
  const ticks: number[] = [];
  for (let t = Math.ceil(from / tick) * tick; t <= to; t += tick) ticks.push(t);
  const fiveFrom = NOWCAST[0];
  const fiveTo = NOWCAST.at(-1)! + 5;
  const hourTo = 15 * 60;
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="rn-graph"
      role="img"
      aria-label="高知の雨：強さ（5分ごと）と1時間の降水量。横の時刻は上下で共通"
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), pick(e))}
      onPointerMove={(e) => e.buttons && pick(e)}
    >
      <defs>
        <ForecastHatch id="rn-fc" />
      </defs>
      {/* 予測（今から先）の網かけ：上下を通して */}
      {[R1, R2].map((r, k) => (
        <rect key={k} x={x(0)} y={r.top} width={W - PAD_R - x(0)} height={r.base - r.top} fill="url(#rn-fc)" />
      ))}
      {/* 目盛りの線（時刻）：上下を通して */}
      {ticks.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={R1.top} y2={R2.base} className="rn-grid" />
      ))}
      {/* 段の名前と縦の目盛り */}
      <text x={PAD_L} y={R1.top - 5} className="rn-row">雨の強さ mm/h（5分ごと）</text>
      <text x={PAD_L} y={R2.top - 5} className="rn-row">1時間の降水量 mm</text>
      {[0, max1].map((v) => (
        <text key={`a${v}`} x={PAD_L - 4} y={y1(v) + 4} textAnchor="end" className="rn-tick">{v}</text>
      ))}
      {[0, max2].map((v) => (
        <text key={`b${v}`} x={PAD_L - 4} y={y2(v) + 4} textAnchor="end" className="rn-tick">{v}</text>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={R1.base} y2={R1.base} className="rn-axis" />
      <line x1={PAD_L} x2={W - PAD_R} y1={R2.base} y2={R2.base} className="rn-axis" />
      {/* 上：5分ごとの強さ */}
      {pointSeries.map((p) =>
        p.v > 0 && inView(p.m, p.m + 5) ? (
          <rect key={p.m} x={cx(p.m) + 0.3} y={y1(p.v)} width={Math.max(0.6, cx(p.m + 5) - cx(p.m) - 0.6)} height={R1.base - y1(p.v)} style={{ fill: colorOf(p.v) ?? "transparent" }} />
        ) : null,
      )}
      {/* 上：5分ごとのデータが無い所 */}
      {from < fiveFrom && (
        <text x={(cx(from) + cx(fiveFrom)) / 2} y={(R1.top + R1.base) / 2 + 4} textAnchor="middle" className="rn-none">なし</text>
      )}
      {to > fiveTo && (
        <text x={(cx(fiveTo) + cx(to)) / 2} y={(R1.top + R1.base) / 2 + 4} textAnchor="middle" className="rn-none">なし</text>
      )}
      {/* 下：1時間の降水量。棒はその1時間の幅 */}
      {hourly.map((p) => {
        const t0 = (p.h - 1) * 60;
        const t1 = p.h * 60;
        if (!inView(t0, t1) || p.mm <= 0) return null;
        return (
          <g key={p.h}>
            <rect x={cx(t0) + 0.5} y={y2(p.mm)} width={cx(t1) - cx(t0) - 1} height={R2.base - y2(p.mm)} className="rn-amt" />
            {cx(t1) - cx(t0) > 12 && (
              <text x={(cx(t0) + cx(t1)) / 2} y={y2(p.mm) - 3} textAnchor="middle" className="rn-val">{p.mm}</text>
            )}
          </g>
        );
      })}
      {to > hourTo && (
        <text x={(cx(hourTo) + cx(to)) / 2} y={(R2.top + R2.base) / 2 + 4} textAnchor="middle" className="rn-none">なし</text>
      )}
      {/* 選んだ時刻：上はそのこま、下はその時刻を含む1時間 */}
      {!isAmount(m) && inView(m, m + 5) && <rect x={cx(m)} y={R1.top} width={Math.max(2, cx(m + 5) - cx(m))} height={R1.base - R1.top} className="rn-sel" />}
      {inView((selH - 1) * 60, selH * 60) && <rect x={cx((selH - 1) * 60)} y={R2.top} width={cx(selH * 60) - cx((selH - 1) * 60)} height={R2.base - R2.top} className="rn-sel" />}
      {/* 今：上下を通して1本 */}
      <line x1={x(0)} x2={x(0)} y1={R1.top - 2} y2={R2.base + 2} className="rn-now" />
      {/* 時刻の目盛り：下に1組だけ */}
      {ticks.filter((t) => t > from && t < to).map((t) => (
        <text key={t} x={x(t)} y={R2.base + 15} textAnchor="middle" className={`rn-tick${t === 0 ? " now" : ""}`}>
          {t === 0 ? "今" : minuteLabel(t)}
        </text>
      ))}
      <text x={(PAD_L + x(0)) / 2} y={H - 2} textAnchor="middle" className="rn-tick">これまで</text>
      <text x={(x(0) + W - PAD_R) / 2} y={H - 2} textAnchor="middle" className="rn-tick">これから</text>
    </svg>
  );
}

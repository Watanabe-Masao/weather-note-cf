// グラフ：高知の地点の雨。上は5分ごとの強さ（mm/h、3時間前〜1時間先）、下は1時間ごとの量（mm、6時間前〜15時間先）。
// 強さと量は単位が違うので、別のグラフに分ける（要件 R4）。予測は斜線と点線の枠（色だけに頼らない）。
// 上のグラフを押す・なぞると、そのこまの地図になる。
import { useRef, type PointerEvent as RPE } from "react";
import { colorOf, FRAMES, hourly, minuteLabel, pointSeries } from "./data";

const W = 330;
const PAD_L = 28;
const PAD_R = 6;

export function StrengthGraph({ m, onPick }: { m: number; onPick: (m: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const H = 120;
  const top = 8;
  const base = 92;
  const max = Math.max(20, ...pointSeries.map((p) => p.v)) * 1.1;
  const step = (W - PAD_L - PAD_R) / FRAMES.length;
  const x = (i: number) => PAD_L + i * step;
  const y = (v: number) => base - (v / max) * (base - top);
  const iNow = FRAMES.indexOf(0);
  const pick = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(FRAMES.length - 1, Math.floor((px - PAD_L) / step)));
    onPick(FRAMES[i]);
  };
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="rn-graph"
      role="img"
      aria-label="高知の雨の強さ（5分ごと）"
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), pick(e))}
      onPointerMove={(e) => e.buttons && pick(e)}
    >
      <defs>
        <pattern id="rn-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="4" className="rn-hatch-line" />
        </pattern>
      </defs>
      {/* 予測の範囲 */}
      <rect x={x(iNow + 1)} y={top - 4} width={W - PAD_R - x(iNow + 1)} height={base - top + 4} className="rn-ahead" rx={3} />
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="rn-grid" />
          <text x={PAD_L - 4} y={y(v) + 4} textAnchor="end" className="rn-tick">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {pointSeries.map((p, i) => {
        const col = colorOf(p.v);
        return p.v > 0 ? (
          <g key={p.m}>
            <rect x={x(i) + 0.5} y={y(p.v)} width={step - 1} height={base - y(p.v)} style={{ fill: col ?? "transparent" }} />
            {p.m > 0 && <rect x={x(i) + 0.5} y={y(p.v)} width={step - 1} height={base - y(p.v)} fill="url(#rn-hatch)" />}
          </g>
        ) : null;
      })}
      {/* 選んだこま */}
      <rect x={x(FRAMES.indexOf(m))} y={top - 4} width={step} height={base - top + 4} className="rn-sel" />
      {/* 今 */}
      <line x1={x(iNow) + step} x2={x(iNow) + step} y1={top - 6} y2={base + 2} className="rn-now" />
      {[-180, -120, -60, 0, 60].map((t) => (
        <text key={t} x={x(FRAMES.indexOf(t)) + step / 2} y={base + 14} textAnchor={t === 60 ? "end" : t === -180 ? "start" : "middle"} className={`rn-tick${t === 0 ? " now" : ""}`}>
          {t === 0 ? "今" : minuteLabel(t)}
        </text>
      ))}
      <text x={(x(iNow + 1) + W - PAD_R) / 2} y={H - 4} textAnchor="middle" className="rn-tick">
        予測（1時間先まで）
      </text>
    </svg>
  );
}

export function AmountGraph() {
  const H = 116;
  const top = 8;
  const base = 88;
  const max = Math.max(5, ...hourly.map((p) => p.mm)) * 1.25;
  const step = (W - PAD_L - PAD_R) / hourly.length;
  const x = (i: number) => PAD_L + i * step;
  const y = (v: number) => base - (v / max) * (base - top);
  const iNow = hourly.findIndex((p) => p.h === 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="rn-graph" role="img" aria-label="高知の1時間ごとの雨の量">
      <rect x={x(iNow + 1)} y={top - 4} width={W - PAD_R - x(iNow + 1)} height={base - top + 4} className="rn-ahead" rx={3} />
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="rn-grid" />
          <text x={PAD_L - 4} y={y(v) + 4} textAnchor="end" className="rn-tick">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {hourly.map((p, i) =>
        p.mm > 0 ? (
          <g key={p.h}>
            <rect x={x(i) + 1} y={y(p.mm)} width={step - 2} height={base - y(p.mm)} className={p.forecast ? "rn-amt ahead" : "rn-amt"} />
            {p.forecast && <rect x={x(i) + 1} y={y(p.mm)} width={step - 2} height={base - y(p.mm)} fill="url(#rn-hatch)" />}
            <text x={x(i) + step / 2} y={y(p.mm) - 3} textAnchor="middle" className="rn-val">
              {p.mm}
            </text>
          </g>
        ) : null,
      )}
      <line x1={x(iNow + 1)} x2={x(iNow + 1)} y1={top - 6} y2={base + 2} className="rn-now" />
      {hourly
        .filter((p) => p.h % 3 === 0)
        .map((p) => (
          <text key={p.h} x={Math.min(x(hourly.indexOf(p)) + step, W - PAD_R)} y={base + 14} textAnchor={p.h === 15 ? "end" : "middle"} className={`rn-tick${p.h === 0 ? " now" : ""}`}>
            {p.h === 0 ? "今" : minuteLabel(p.h * 60)}
          </text>
        ))}
      <text x={(PAD_L + x(iNow + 1)) / 2} y={H - 2} textAnchor="middle" className="rn-tick">
        実績
      </text>
      <text x={(x(iNow + 1) + W - PAD_R) / 2} y={H - 2} textAnchor="middle" className="rn-tick">
        予測（15時間先まで）
      </text>
    </svg>
  );
}

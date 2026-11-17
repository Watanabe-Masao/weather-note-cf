// グラフ：地点の雨。上は5分ごとの強さ（mm/h、3時間前〜1時間先）、下は1時間の降水量（mm、6時間前〜15時間先）。
// 強さと量は単位が違うので別のグラフ（要件 R4）。予測はアプリのグラフと同じ「予報の網かけ」を後ろに敷くだけ
// （棒そのものは塗りのまま。斜線の棒・点線の枠は使わない）。境目（今）の線は両方で同じ。
// 地図と同じ時刻を両方に出す：上はそのこま、下はその時刻を含む1時間。どちらを押しても地図がその時刻になる。
import { useRef, type PointerEvent as RPE } from "react";
import { ForecastHatch } from "../../../src/ui/kit";
import { colorOf, FRAMES, hourly, minuteLabel, pointSeries } from "./data";

const W = 330;
const PAD_L = 24;
const PAD_R = 6;

/** 分 m を含む1時間（終わりの時刻で呼ぶ：(h−1)時〜h時）。 */
export const hourOfMinute = (m: number) => Math.ceil(m / 60);

function Ticks({ x, y, values }: { x: number; y: (v: number) => number; values: number[] }) {
  return (
    <>
      {values.map((v) => (
        <g key={v}>
          <line x1={x} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="rn-grid" />
          <text x={x - 4} y={y(v) + 4} textAnchor="end" className="rn-tick">
            {Math.round(v)}
          </text>
        </g>
      ))}
    </>
  );
}

export function StrengthGraph({ m, onPick }: { m: number; onPick: (m: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const H = 120;
  const top = 8;
  const base = 92;
  const max = Math.ceil(Math.max(20, ...pointSeries.map((p) => p.v)) / 10) * 10;
  const step = (W - PAD_L - PAD_R) / FRAMES.length;
  const x = (i: number) => PAD_L + i * step;
  const y = (v: number) => base - (v / max) * (base - top);
  const nowX = x(FRAMES.indexOf(0)) + step;
  const pick = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    onPick(FRAMES[Math.max(0, Math.min(FRAMES.length - 1, Math.floor((px - PAD_L) / step)))]);
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
        <ForecastHatch id="rn-fc1" />
      </defs>
      <rect x={nowX} y={top} width={W - PAD_R - nowX} height={base - top} fill="url(#rn-fc1)" />
      <Ticks x={PAD_L} y={y} values={[0, max / 2, max]} />
      {pointSeries.map((p, i) =>
        p.v > 0 ? <rect key={p.m} x={x(i) + 0.5} y={y(p.v)} width={step - 1} height={base - y(p.v)} style={{ fill: colorOf(p.v) ?? "transparent" }} /> : null,
      )}
      <rect x={x(FRAMES.indexOf(m))} y={top} width={step} height={base - top} className="rn-sel" />
      <line x1={nowX} x2={nowX} y1={top - 6} y2={base + 2} className="rn-now" />
      <text x={nowX} y={base + 14} textAnchor="middle" className="rn-tick now">
        今
      </text>
      {[-180, -120, -60].map((t) => (
        <text key={t} x={x(FRAMES.indexOf(t))} y={base + 14} textAnchor={t === -180 ? "start" : "middle"} className="rn-tick">
          {minuteLabel(t)}
        </text>
      ))}
      <text x={W - PAD_R} y={base + 14} textAnchor="end" className="rn-tick">
        {minuteLabel(60)}
      </text>
      <text x={(PAD_L + nowX) / 2} y={H - 4} textAnchor="middle" className="rn-tick">
        これまで（実況）
      </text>
      <text x={(nowX + W - PAD_R) / 2} y={H - 4} textAnchor="middle" className="rn-tick">
        これから1時間
      </text>
    </svg>
  );
}

export function AmountGraph({ m, onPick }: { m: number; onPick: (m: number) => void }) {
  const H = 116;
  const top = 10;
  const base = 88;
  const max = Math.ceil((Math.max(4, ...hourly.map((p) => p.mm)) * 1.2) / 2) * 2;
  const step = (W - PAD_L - PAD_R) / hourly.length;
  const x = (i: number) => PAD_L + i * step;
  const y = (v: number) => base - (v / max) * (base - top);
  const iNow = hourly.findIndex((p) => p.h === 0);
  const nowX = x(iNow + 1);
  const selH = hourOfMinute(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="rn-graph" role="img" aria-label="高知の1時間の降水量">
      <defs>
        <ForecastHatch id="rn-fc2" />
      </defs>
      <rect x={nowX} y={top} width={W - PAD_R - nowX} height={base - top} fill="url(#rn-fc2)" />
      <Ticks x={PAD_L} y={y} values={[0, max / 2, max]} />
      {/* 地図の時刻を含む1時間 */}
      {hourly.some((p) => p.h === selH) && <rect x={x(hourly.findIndex((p) => p.h === selH))} y={top} width={step} height={base - top} className="rn-sel" />}
      {hourly.map((p, i) => (
        <g key={p.h}>
          {p.mm > 0 && (
            <>
              <rect x={x(i) + 1} y={y(p.mm)} width={step - 2} height={base - y(p.mm)} className="rn-amt" />
              <text x={x(i) + step / 2} y={y(p.mm) - 3} textAnchor="middle" className="rn-val">
                {p.mm}
              </text>
            </>
          )}
          {/* 地図のある範囲（3時間前〜1時間先）の1時間は、押すとその1時間の中ごろの地図に */}
          {p.h >= -2 && p.h <= 1 && <rect x={x(i)} y={top} width={step} height={base - top + 16} className="rn-hit" onClick={() => onPick(p.h * 60 - 30)} />}
        </g>
      ))}
      <line x1={nowX} x2={nowX} y1={top - 6} y2={base + 2} className="rn-now" />
      <text x={nowX} y={base + 14} textAnchor="middle" className="rn-tick now">
        今
      </text>
      {hourly
        .filter((p) => p.h % 3 === 0 && p.h !== 0)
        .map((p) => (
          <text key={p.h} x={Math.min(x(hourly.indexOf(p)) + step, W - PAD_R)} y={base + 14} textAnchor={p.h === 15 ? "end" : "middle"} className="rn-tick">
            {minuteLabel(p.h * 60)}
          </text>
        ))}
      <text x={(PAD_L + nowX) / 2} y={H - 2} textAnchor="middle" className="rn-tick">
        これまで（アメダス）
      </text>
      <text x={(nowX + W - PAD_R) / 2} y={H - 2} textAnchor="middle" className="rn-tick">
        これから15時間
      </text>
    </svg>
  );
}

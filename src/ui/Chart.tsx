// Comparison chart for the seven days around the target day.
// Target: solid where observed, dotted where forecast. Comparison: dashed and lighter.
// Missing values break the line (never interpolated).

import { useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { dayTone } from "../../shared/holidays";
import type { ChartMetric } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { formatValue } from "../metrics";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  /** Comparison day for each target day (null when it has none). */
  partner: (date: string) => string | null;
  metric: ChartMetric;
  /** Drawing height: the graph grows with the sheet. */
  height?: number;
}

const COLORS = { hot: "#f08b7d", cold: "#6fb3f2", rain: "#6fb3f2", plain: "#9fd3c7" } as const;
const PAD = { left: 34, right: 10, top: 14, bottom: 30 };

interface Point {
  x: number;
  v: number | null;
  forecast: boolean;
}

export function Chart({ store, station, target, partner, metric, height = 190 }: Props) {
  const H = height;
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => addDays(target, n));
  const step = (w - PAD.left - PAD.right) / days.length;
  const xOf = (i: number) => PAD.left + step * (i + 0.5);

  const read = (date: string | null, s: ChartMetric["series"][number]): { v: number | null; forecast: boolean } => {
    if (!date) return { v: null, forecast: false };
    const day = store?.getDay(station, date);
    const hours = metric.needsHours ? (store?.getHours(station, date).rows ?? null) : null;
    return { v: s.value(day?.row, hours), forecast: day?.row?.type === "forecast" };
  };

  const series = metric.series.flatMap((s) => [
    { s, compare: false, points: days.map((d, i): Point => ({ x: xOf(i), ...read(d, s) })) },
    { s, compare: true, points: days.map((d, i): Point => ({ x: xOf(i), ...read(partner(d), s) })) },
  ]);
  const values = series.flatMap((x) => x.points.map((p) => p.v)).filter((v): v is number => v != null);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (metric.zero) lo = 0;
  const nothing = metric.emptyNote && !values.some((v) => v > 0);
  const pad = Math.max((hi - lo) * 0.12, metric.unit === "℃" ? 1 : 0.5);
  if (lo !== 0) lo -= pad;
  hi = metric.max ?? hi + pad;
  const yOf = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / (hi - lo);
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);

  return (
    <div ref={ref} className="chart">
      {nothing && <p className="chart-note">{metric.emptyNote}</p>}
      {metric.forecastOnly && <p className="chart-note">予報の日だけの値です（過去の日にはありません）</p>}
      <svg width={w} height={H} role="img" aria-label={`${metric.label}の比較グラフ`}>
        {/* centre day */}
        <rect x={xOf(3) - step / 2} y={PAD.top - 6} width={step} height={H - PAD.top - PAD.bottom + 6} className="chart-center" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
            <text x={PAD.left - 6} y={yOf(t) + 4} className="chart-tick" textAnchor="end">
              {formatValue(t, metric.unit)}
            </text>
          </g>
        ))}

        {metric.chart === "bar"
          ? series.map(({ s, compare, points }) =>
              points.map((p, i) =>
                p.v == null ? null : (
                  <rect
                    key={`${s.key}-${compare}-${i}`}
                    x={p.x + (compare ? 1 : -step * 0.32)}
                    y={yOf(p.v)}
                    width={step * 0.3}
                    height={Math.max(0, yOf(0) - yOf(p.v))}
                    fill={compare ? "none" : COLORS[s.tone]}
                    stroke={COLORS[s.tone]}
                    strokeDasharray={!compare && p.forecast ? "3 2" : undefined}
                    opacity={compare ? 0.7 : 1}
                  />
                ),
              ),
            )
          : series.map(({ s, compare, points }) =>
              points.slice(1).map((p, i) => {
                const a = points[i];
                if (a.v == null || p.v == null) return null;
                return (
                  <line
                    key={`${s.key}-${compare}-${i}`}
                    x1={a.x}
                    y1={yOf(a.v)}
                    x2={p.x}
                    y2={yOf(p.v)}
                    stroke={COLORS[s.tone]}
                    strokeWidth={compare ? 1.5 : 2.2}
                    strokeDasharray={compare ? "6 4" : p.forecast ? "2 4" : undefined}
                    strokeLinecap="round"
                    opacity={compare ? 0.65 : 1}
                  />
                );
              }),
            )}
        {metric.chart === "line" &&
          series.map(({ s, compare, points }) =>
            points.map((p, i) =>
              p.v == null ? null : (
                <circle
                  key={`${s.key}-${compare}-dot-${i}`}
                  cx={p.x}
                  cy={yOf(p.v)}
                  r={compare ? 2.5 : 3.2}
                  fill={compare ? "var(--bg)" : COLORS[s.tone]}
                  stroke={COLORS[s.tone]}
                  opacity={compare ? 0.75 : 1}
                />
              ),
            ),
          )}

        {days.map((d, i) => (
          <text key={d} x={xOf(i)} y={H - 10} textAnchor="middle" className={`chart-x tone-${dayTone(d)}`}>
            {+d.slice(5, 7)}/{+d.slice(8)}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="lg-solid" />
          実績
        </span>
        <span>
          <i className="lg-dotted" />
          予報
        </span>
        <span>
          <i className="lg-dashed" />
          比較日
        </span>
        {metric.series.length > 1 &&
          metric.series.map((s) => (
            <span key={s.key} style={{ color: COLORS[s.tone] }}>
              ● {s.label}
            </span>
          ))}
      </div>
    </div>
  );
}

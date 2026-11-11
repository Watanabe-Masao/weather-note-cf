// Band trend graph (spec chapter 5): how each part of the day moved over the seven days.
// One line per chosen 時間区分 (朝・日中・昼・夕方・夜) in 日なた/日かげ温度; the comparison side dashed.
// Line style says which day only (target solid, comparison dashed); forecast days are hatched behind.
// Missing values leave a gap (never interpolated).

import { useContext, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { type Band, BANDS, type FeelSettings, hourlyBands } from "../../shared/feel";
import { dayTone } from "../../shared/holidays";
import type { WeatherStore } from "../data/store";
import { BAND_LINES } from "../design/tokens";
import { Chip, ForecastHatch } from "./kit";
import { FeelContext, LEVEL_COLORS } from "./FeelBar";

export const BAND_COLORS = BAND_LINES;
export const MAX_COMPARED_BANDS = 3;
const OFFSETS = [-3, -2, -1, 0, 1, 2, 3];

export interface TrendPoint {
  value: number | null;
  forecast: boolean;
}

/** The value of band `index` on each day; null where the day or the band has no data. */
export function trendSeries(days: (Band[] | null)[], index: number): TrendPoint[] {
  return days.map((bands) => {
    const b = bands?.[index];
    return { value: b?.feel ?? null, forecast: !!b && b.source !== "actual" };
  });
}

function bandsOf(store: WeatherStore | null, station: string, date: string | null, s: FeelSettings): Band[] | null {
  if (!date) return null;
  const hours = store?.getHours(station, date);
  return hours?.state === "ready" && hours.rows.length ? hourlyBands(hours.rows, s) : null;
}

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  partner: (date: string) => string | null;
}

export function BandTrend({ store, station, target, partner }: Props) {
  const settings = useContext(FeelContext);
  const [chosen, setChosen] = useState<number[]>([0, 2, 4]); // 朝・昼・夜
  const [withCompare, setWithCompare] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const dates = OFFSETS.map((n) => addDays(target, n));
  const mine = dates.map((d) => bandsOf(store, station, d, settings));
  const theirs = dates.map((d) => bandsOf(store, station, partner(d), settings));
  const compareOn = withCompare && chosen.length <= MAX_COMPARED_BANDS;

  const lines = chosen.flatMap((i) => [
    { band: i, compare: false, points: trendSeries(mine, i) },
    ...(compareOn ? [{ band: i, compare: true, points: trendSeries(theirs, i) }] : []),
  ]);
  const values = lines.flatMap((l) => l.points.map((p) => p.value)).filter((v): v is number => v != null);

  const H = 200;
  const PAD = { left: 30, right: 8, top: 10, bottom: 28 };
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 30;
  const pad = Math.max((hi - lo) * 0.1, 1);
  lo -= pad;
  hi += pad;
  const step = (w - PAD.left - PAD.right) / dates.length;
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const y = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / (hi - lo);

  // Level colour bands behind the lines, so a line's height reads as 寒い…暑い at a glance.
  const edges = [-Infinity, ...settings.thresholds, Infinity];
  const levelBands = edges.slice(0, -1).map((from, i) => {
    const top = Math.min(hi, edges[i + 1]);
    const bottom = Math.max(lo, from);
    return top > bottom ? { i, y1: y(top), y2: y(bottom) } : null;
  });

  const toggle = (i: number) =>
    setChosen((c) => (c.includes(i) ? (c.length > 1 ? c.filter((x) => x !== i) : c) : [...c, i].sort()));

  return (
    <div className="band-trend" ref={ref}>
      <div className="chip-row">
        {BANDS.map((b, i) => (
          <Chip key={b.id} size="sm" on={chosen.includes(i)} tone={BAND_COLORS[i]} onClick={() => toggle(i)}>
            {b.label}
          </Chip>
        ))}
        <span className="chip-row-end">
          <Chip size="sm" on={compareOn} onClick={() => setWithCompare(!withCompare)}>
            比較日を重ねる
          </Chip>
        </span>
      </div>
      {withCompare && chosen.length > MAX_COMPARED_BANDS && (
        <p className="hint">比較日を重ねられるのは、時間区分を{MAX_COMPARED_BANDS}つまで選んだときです。</p>
      )}
      <svg width={w} height={H} role="img" aria-label="時間区分ごとの推移">
        {levelBands.map(
          (b) => b && <rect key={b.i} x={PAD.left} width={w - PAD.left - PAD.right} y={b.y1} height={b.y2 - b.y1} fill={LEVEL_COLORS[b.i]} opacity={0.1} />,
        )}
        <defs>
          <ForecastHatch id="fc-trend" />
        </defs>
        {dates.map((d, i) => {
          const fc = (k: number) => mine[k]?.some((b) => b && b.source !== "actual") ?? false;
          if (!fc(i)) return null;
          return (
            <g key={`fc-${d}`}>
              <rect x={x(i) - step / 2} y={PAD.top} width={step} height={H - PAD.top - PAD.bottom} fill="url(#fc-trend)" className="chart-forecast" />
              {(i === 0 || !fc(i - 1)) && (
                <text x={x(i) - step / 2 + 4} y={PAD.top + 10} className="chart-forecast-label">
                  予報
                </text>
              )}
            </g>
          );
        })}
        <rect x={x(3) - step / 2} y={PAD.top} width={step} height={H - PAD.top - PAD.bottom} className="chart-center" />
        {[lo + pad, (lo + hi) / 2, hi - pad].map((t) => (
          <text key={t} x={PAD.left - 5} y={y(t) + 4} textAnchor="end" className="chart-tick">
            {t.toFixed(0)}
          </text>
        ))}
        {lines.map(({ band, compare, points }) =>
          points.slice(1).map((p, i) => {
            const a = points[i];
            if (a.value == null || p.value == null) return null;
            return (
              <line
                key={`${band}-${compare}-${i}`}
                x1={x(i)}
                y1={y(a.value)}
                x2={x(i + 1)}
                y2={y(p.value)}
                stroke={BAND_COLORS[band]}
                strokeWidth={compare ? 1.5 : 2.4}
                strokeDasharray={compare ? "6 4" : undefined}
                strokeLinecap="round"
                opacity={compare ? 0.6 : 1}
              />
            );
          }),
        )}
        {lines.map(({ band, compare, points }) =>
          points.map((p, i) =>
            p.value == null ? null : (
              <circle
                key={`${band}-${compare}-dot-${i}`}
                cx={x(i)}
                cy={y(p.value)}
                r={compare ? 2.3 : 3}
                fill={compare ? "var(--surface-base)" : BAND_COLORS[band]}
                stroke={BAND_COLORS[band]}
                opacity={compare ? 0.7 : 1}
              />
            ),
          ),
        )}
        {dates.map((d, i) => (
          <text key={d} x={x(i)} y={H - 9} textAnchor="middle" className={`chart-x tone-${dayTone(d)}`}>
            {+d.slice(5, 7)}/{+d.slice(8)}
          </text>
        ))}
      </svg>
      <p className="trend-note">
        縦軸は{settings.sun ? "日なた温度" : "日かげ温度"}（℃）。実線＝対象日、破線＝比較日、網かけ＝予報の日。背景の色は肌感の段階。
      </p>
    </div>
  );
}

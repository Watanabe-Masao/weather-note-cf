// Band trend graph (spec chapter 5): how each part of the day moved over the seven days.
// One line per chosen 時間区分 (朝・日中・昼・夕方・夜) in 肌感（日なた/日かげ）: a neutral line family told
// apart by marker shape (colour is kept for the feel levels behind them); the comparison day dashed.
// Line style says which day only (target solid, comparison dashed); forecast days are hatched behind.
// Missing values leave a gap (never interpolated).

import { useContext, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { type Band, BANDS, type FeelSettings, hourlyBands } from "../../shared/feel";
import { dayTone } from "../../shared/holidays";
import type { WeatherStore } from "../data/store";
import { feelOn } from "../feelSeason";
import { BAND_LINES, BAND_MARKS, lineLook } from "../design/tokens";
import { niceTicks, signedDiff, tickLabel, monthDay, dateLabel } from "../design/format";
import { Chip, ForecastHatch, GraphReadout, GuideLines, Mark, MarkIcon } from "./kit";
import { FeelContext, levelRanges } from "./FeelBar";

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
  return hours?.state === "ready" && hours.rows.length ? hourlyBands(hours.rows, feelOn(store, station, date, s), station) : null;
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
  /** The touched day (index), while the finger is on the graph. */
  const [touch, setTouch] = useState<number | null>(null);
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
  const PAD = { left: 30, right: 8, top: 26, bottom: 28 };
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 30;
  const pad = Math.max((hi - lo) * 0.08, 0.5);
  const nice = niceTicks(lo - pad, hi + pad, 5);
  lo = nice.lo;
  hi = nice.hi;
  const step = (w - PAD.left - PAD.right) / dates.length;
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const y = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / (hi - lo);

  // Level colour bands behind the lines, so a line's height reads as 寒い…暑い at a glance.
  // The target day's boundaries (they move little over the span shown; #111).
  const levelBands = levelRanges(feelOn(store, station, target, settings).thresholds, settings.scale).map(({ from, to, color }, i) => {
    const top = Math.min(hi, to);
    const bottom = Math.max(lo, from);
    return top > bottom ? { i, color, y1: y(top), y2: y(bottom) } : null;
  });

  const toggle = (i: number) =>
    setChosen((c) => (c.includes(i) ? (c.length > 1 ? c.filter((x) => x !== i) : c) : [...c, i].sort()));

  // The finger picks a day (no sideways panning here, so a touch scrubs at once).
  const svgRef = useRef<SVGSVGElement>(null);
  const pickAt = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.floor((clientX - r.left - PAD.left) / step);
    setTouch(Math.max(0, Math.min(dates.length - 1, i)));
  };
  const shownDay = touch ?? 3;
  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(0));
  const forecastDay = (k: number) => mine[k]?.some((b) => b && b.source !== "actual") ?? false;
  const otherDate = partner(dates[shownDay]);

  return (
    <div className="band-trend" ref={ref}>
      <div className="chip-row">
        {BANDS.map((b, i) => (
          <Chip key={b.id} size="sm" on={chosen.includes(i)} tone="var(--ink-primary)" onClick={() => toggle(i)}>
            <MarkIcon shape={BAND_MARKS[i]} color={BAND_COLORS[i]} />
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
      <GraphReadout
        live={touch != null}
        unit=""
        title={
          <>
            {dateLabel(dates[shownDay])}
            {otherDate && <small> 比較 {monthDay(otherDate)}</small>}
          </>
        }
        rows={chosen.map((i) => {
          const a = mine[shownDay]?.[i]?.feel ?? null;
          const b = theirs[shownDay]?.[i]?.feel ?? null;
          return { key: BANDS[i].id, label: BANDS[i].label, mark: BAND_MARKS[i], color: BAND_COLORS[i], a: fmt(a), b: fmt(b), diff: signedDiff(a, b, 0) };
        })}
      />
      <svg
        ref={svgRef}
        width={w}
        height={H}
        role="img"
        aria-label="時間区分ごとの推移"
        className="scrub"
        onPointerDown={(e) => pickAt(e.clientX)}
        onPointerMove={(e) => (e.pointerType === "mouse" || e.buttons) && pickAt(e.clientX)}
        onPointerUp={(e) => e.pointerType !== "mouse" && setTouch(null)}
        onPointerLeave={() => setTouch(null)}
        onPointerCancel={() => setTouch(null)}
      >
        <defs>
          <ForecastHatch id="fc-trend" />
        </defs>
        {levelBands.map(
          (b) => b && <rect key={b.i} x={PAD.left} width={w - PAD.left - PAD.right} y={b.y1} height={b.y2 - b.y1} fill={b.color} opacity={0.12} />,
        )}
        {dates.map((d, i) =>
          !forecastDay(i) ? null : (
            <g key={`fc-${d}`}>
              <rect x={x(i) - step / 2} y={PAD.top} width={step} height={H - PAD.top - PAD.bottom} fill="url(#fc-trend)" className="chart-forecast" />
              {(i === 0 || !forecastDay(i - 1)) && (
                <text x={x(i) - step / 2 + 4} y={PAD.top + 10} className="chart-forecast-label">
                  予報
                </text>
              )}
            </g>
          ),
        )}
        {nice.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.left - 5} y={y(t) + 4} textAnchor="end" className="chart-tick">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        <text x={2} y={PAD.top - 12} className="chart-unit">
          肌感
        </text>
        {/* The selected day: a frame, as in the tables (the background is for 予報 only). */}
        <rect x={x(3) - step / 2 + 1} y={PAD.top} width={step - 2} height={H - PAD.top - PAD.bottom} rx={8} className="chart-center" />
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
                {...lineLook(compare ? "compare" : "target", BAND_COLORS[band])}
                strokeLinecap={compare ? "butt" : "round"}
              />
            );
          }),
        )}
        {touch != null && (
          <GuideLines
            x={x(touch)}
            top={PAD.top}
            bottom={H - PAD.bottom}
            left={PAD.left}
            points={chosen.flatMap((i) => (mine[touch]?.[i]?.feel != null ? [{ y: y(mine[touch]![i].feel!), color: BAND_COLORS[i], label: mine[touch]![i].feel!.toFixed(0) }] : []))}
          />
        )}
        {lines.map(({ band, compare, points }) =>
          points.map((p, i) =>
            p.value == null ? null : (
              <g key={`${band}-${compare}-dot-${i}`} opacity={compare ? 0.7 : 1}>
                <Mark shape={BAND_MARKS[band]} x={x(i)} y={y(p.value)} r={(compare ? 2.6 : 3.4) * (i === touch ? 1.35 : 1)} color={BAND_COLORS[band]} hollow={compare} />
              </g>
            ),
          ),
        )}
        {dates.map((d, i) => (
          <text key={d} x={x(i)} y={H - 9} textAnchor="middle" className={`chart-x tone-${dayTone(d)}`}>
            {+d.slice(5, 7)}/{+d.slice(8)}
          </text>
        ))}
      </svg>
      {/* Legend right under the graph, in the graph's own marks. */}
      <p className="line-legend">
        <span>
          <i className="ls-solid" />
          対象日
        </span>
        <span>
          <i className="ls-dashed" />
          比較日
        </span>
        <span>
          <i className="ls-forecast" />
          予報
        </span>
        <span>背景の色＝肌感の段階</span>
      </p>
    </div>
  );
}

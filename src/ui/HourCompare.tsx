// The 24 hours of one day next to its partner day, for one hourly item.
// Shared by the day detail and the sheet's 時間帯 tab, so both look and behave the same.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { jstHour } from "../../shared/dates";
import { BANDS, LEVELS } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { cachedSun, hourOfDay, loadSun, sunAvailable, type SunTimes } from "../data/sun";
import {
  axisRange,
  type DetailMetricId,
  detailMetric,
  formatDetail,
  type HourPoint,
  hourSeries,
  initialHour,
  signedDiff,
} from "../dayDetail";
import { type DataColor, DATA } from "../design/tokens";
import { dateLabel, needsYear, niceTicks, tickLabel } from "../design/format";
import { FeelContext, LEVEL_COLORS } from "./FeelBar";

/** The colour of an hourly item: the same for both days (they differ by solid / dashed). */
export const HOUR_TONE: Record<DetailMetricId, DataColor> = {
  temp: "temp",
  feel: "feel",
  rain: "rain",
  snow: "snow",
  probability: "rain",
  humidity: "humidity",
  wind: "wind",
  radiation: "sun",
  sun: "sun",
  pressure: "pressure",
};

export const shortDate = (d: string) => dateLabel(d, { year: true, weekday: false });

/** Sunrise and sunset: from the forecast row when it has them, otherwise asked once. */
export function useSun(station: string, date: string | null, today: string, row: WeatherRow | null | undefined): SunTimes | null {
  const fromRow = row && typeof row.sunrise === "string" ? { sunrise: row.sunrise as string, sunset: (row.sunset as string) ?? null } : null;
  const [sun, setSun] = useState<SunTimes | null>(() => (date ? (cachedSun(station, date) ?? null) : null));
  useEffect(() => {
    if (!date || fromRow || !sunAvailable(date, today)) return setSun(null);
    setSun(cachedSun(station, date) ?? null);
    let live = true;
    void loadSun(station, date).then((s) => live && setSun(s));
    return () => {
      live = false;
    };
  }, [station, date, today, !!fromRow]); // eslint-disable-line react-hooks/exhaustive-deps
  return fromRow ?? sun;
}

interface Props {
  store: WeatherStore | null;
  station: string;
  date: string;
  other: string | null;
  metricId: DetailMetricId;
  today: string;
  /** Drawing height of the graph. */
  height?: number;
}

export function HourCompare({ store, station, date, other, metricId, today, height = 210 }: Props) {
  const settings = useContext(FeelContext);
  const metric = detailMetric(metricId);
  const hours = store?.getHours(station, date);
  const otherHours = other ? store?.getHours(station, other) : null;
  const sun = useSun(station, date, today, store?.getDay(station, date).row);

  const main = useMemo(() => hourSeries(hours?.rows ?? [], metricId, settings), [hours, metricId, settings]);
  const second = useMemo(() => hourSeries(otherHours?.rows ?? [], metricId, settings), [otherHours, metricId, settings]);
  const air = useMemo(() => (metricId === "feel" ? hourSeries(hours?.rows ?? [], "temp", settings) : null), [hours, metricId, settings]);
  const sunMain = useMemo(() => hourSeries(hours?.rows ?? [], "sun", settings), [hours, settings]);
  const sunOther = useMemo(() => hourSeries(otherHours?.rows ?? [], "sun", settings), [otherHours, settings]);
  const chance = useMemo(() => hourSeries(hours?.rows ?? [], "probability", settings), [hours, settings]);
  const isToday = date === today;
  const nowHour = jstHour();
  const [hour, setHour] = useState<number | null>(null);
  const shownHour = hour ?? initialHour(main, isToday, nowHour);
  useEffect(() => setHour(null), [date]);

  const at = (points: HourPoint[]) => points[shownHour - 1]?.v ?? null;
  // Same month and day a year apart would read "11/10" twice: the comparison day keeps its year.
  const mainLabel = dateLabel(date, { weekday: false });
  const otherLabel = other ? dateLabel(other, { year: needsYear(other, date), weekday: false }) : "";
  const unit = (v: number | null) => (metric.unit !== "h" && v != null ? metric.unit : "");
  const tone = HOUR_TONE[metricId];
  const color = DATA[tone];

  return (
    <div className="hour-compare">
      <HourStatus state={hours?.state} error={hours?.error} onRetry={() => store?.retryDay(station, date)} />
      {/* The hour's values above the graph, where the eye starts: the target day, the comparison day muted, the difference. */}
      <div className="readout-card">
      <p className="readout">
        <b className="ro-hour">{shownHour}時</b>
        <span className="ro-a">
          <small>{mainLabel}</small>
          <span className={`tone-${tone}`}>
            {formatDetail(at(main), metric)}
            <small className="unit">{unit(at(main))}</small>
          </span>
        </span>
        {other && (
          <span className="ro-b">
            <small>{otherLabel}</small>
            <span className={`tone-${tone}`}>
              {formatDetail(at(second), metric)}
              <small className="unit">{unit(at(second))}</small>
            </span>
          </span>
        )}
        {other && metric.unit !== "h" && <span className="ro-diff">{signedDiff(at(main), at(second), metric.unit) || "—"}</span>}
      </p>
      {metricId === "radiation" && (
        <p className="readout sub">
          <span className="ro-hour">日照</span>
          <span className="ro-a tone-sun">{formatDetail(sunMain[shownHour - 1]?.v ?? null, detailMetric("sun"))}</span>
          {other && <span className="ro-b tone-sun">{formatDetail(sunOther[shownHour - 1]?.v ?? null, detailMetric("sun"))}</span>}
        </p>
      )}
      {metricId === "rain" && chance.some((p) => p.v != null) && (
        <p className="readout sub">
          <span className="ro-hour">降水確率</span>
          <span className="ro-a tone-rain">{at(chance) == null ? "—" : `${Math.round(at(chance)!)}%`}</span>
          <span className="ro-note">予報の時間だけ</span>
        </p>
      )}
      </div>

      <HourChart
        metricId={metricId}
        main={main}
        second={other ? second : null}
        air={air}
        thresholds={settings.thresholds}
        sun={sun}
        nowHour={isToday ? nowHour : null}
        hour={shownHour}
        onHour={setHour}
        height={height}
        color={color}
      />

      {metricId === "feel" && (
        <p className="level-legend">
          {LEVELS.map((label, i) => (
            <span key={label}>
              <i style={{ background: LEVEL_COLORS[i] }} />
              {label}
            </span>
          ))}
        </p>
      )}
      <p className="line-legend">
        <span>
          <i className="ls-solid" style={{ borderColor: color }} />
          対象 {mainLabel}
        </span>
        {other && (
          <span>
            <i className="ls-dashed" style={{ borderColor: color }} />
            比較 {otherLabel}
          </span>
        )}
        <span>
          <i className="ls-dotted" style={{ borderColor: color }} />
          予報
        </span>
        {metricId === "feel" && (
          <span>
            <i className="ls-solid" style={{ borderColor: DATA.mean }} />
            気温
          </span>
        )}
      </p>
    </div>
  );
}

function HourStatus({ state, error, onRetry }: { state?: string; error?: string; onRetry: () => void }) {
  if (state === "ready") return null;
  if (state === "error")
    return (
      <p className="day-status">
        時間ごとのデータを取得できませんでした。{error ? `（${error}）` : ""}
        <button className="retry" onClick={onRetry}>
          再試行
        </button>
      </p>
    );
  if (state === "outside") return <p className="day-status">この日の時間ごとのデータはありません。</p>;
  return <p className="day-status">時間ごとのデータを取得中…</p>;
}

const PAD = { left: 34, right: 10, top: 18, bottom: 26 };

function HourChart({
  metricId,
  main,
  second,
  air,
  thresholds,
  sun,
  nowHour,
  hour,
  onHour,
  height,
  color,
}: {
  metricId: DetailMetricId;
  main: HourPoint[];
  second: HourPoint[] | null;
  air: HourPoint[] | null;
  thresholds: number[];
  sun: SunTimes | null;
  nowHour: number | null;
  hour: number;
  onHour: (h: number) => void;
  height: number;
  /** The item's data colour (both days). */
  color: string;
}) {
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

  const metric = detailMetric(metricId);
  const plotW = w - PAD.left - PAD.right;
  const step = plotW / 24;
  // Hour n is the value at n o'clock: x runs from 0 to 24 o'clock.
  const xOf = (h: number) => PAD.left + (h / 24) * plotW;
  const values = [main, second ?? [], air ?? []].flatMap((s) => s.map((p) => p.v)).filter((v): v is number => v != null);
  // Round ticks (10 / 15 / 20): the padded data range widened to whole steps.
  const range = axisRange(values, metric);
  const { lo, hi, ticks } = niceTicks(range.lo, range.hi, 3);
  const yOf = (v: number) => PAD.top + ((hi - Math.min(hi, Math.max(lo, v))) * (H - PAD.top - PAD.bottom)) / (hi - lo);
  const rise = hourOfDay(sun?.sunrise ?? null);
  const set = hourOfDay(sun?.sunset ?? null);

  const pickAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const x = ((clientX - box.left - PAD.left) / plotW) * 24;
    // A bar covers the hour before its time (19–20 o'clock is the 20時 bar).
    const h = metric.chart === "bar" ? Math.ceil(x) : Math.round(x);
    onHour(Math.min(24, Math.max(1, h)));
  };
  const scrub = useRef(false);

  const line = (points: HourPoint[], color: string, dashed: boolean, width: number, opacity = 1) =>
    points.slice(1).map((p, i) => {
      const a = points[i];
      if (a.v == null || p.v == null) return null;
      return (
        <line
          key={`${color}-${i}`}
          x1={xOf(a.hour)}
          y1={yOf(a.v)}
          x2={xOf(p.hour)}
          y2={yOf(p.v)}
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dashed ? "6 4" : p.forecast ? "2 4" : undefined}
          strokeLinecap="round"
          opacity={opacity}
        />
      );
    });

  const bars = (points: HourPoint[], color: string, other: boolean) =>
    points.map((p) =>
      p.v == null || p.v <= 0 ? null : (
        <rect
          key={`${color}-${p.hour}`}
          x={xOf(p.hour) - step + (other ? step * 0.5 : step * 0.08)}
          y={yOf(p.v)}
          width={step * 0.42}
          height={Math.max(0, yOf(0) - yOf(p.v))}
          fill={other ? "none" : color}
          stroke={color}
          strokeDasharray={!other && p.forecast ? "2 2" : undefined}
          opacity={other ? 0.8 : 1}
        />
      ),
    );

  return (
    <div
      ref={ref}
      className="chart day-chart"
      onPointerDown={(e) => {
        scrub.current = true;
        pickAt(e.clientX);
      }}
      onPointerMove={(e) => scrub.current && pickAt(e.clientX)}
      onPointerUp={() => (scrub.current = false)}
      onPointerLeave={() => (scrub.current = false)}
    >
      <svg width={w} height={H} role="img" aria-label={`${metric.label}の時間ごとのグラフ`}>
        {/* Feel levels behind the lines. */}
        {metricId === "feel" &&
          [lo, ...thresholds, hi].slice(0, -1).map((from, i, edges) => {
            const to = i + 1 < edges.length ? edges[i + 1] : hi;
            if (to <= lo || from >= hi) return null;
            const top = yOf(Math.min(hi, to));
            const bottom = yOf(Math.max(lo, from));
            return <rect key={i} x={PAD.left} width={plotW} y={top} height={Math.max(0, bottom - top)} fill={LEVEL_COLORS[i]} opacity={0.14} />;
          })}
        {/* Night before sunrise and after sunset. */}
        {rise != null && <rect x={xOf(0)} width={xOf(rise) - xOf(0)} y={PAD.top} height={H - PAD.top - PAD.bottom} className="day-night" />}
        {set != null && <rect x={xOf(set)} width={xOf(24) - xOf(set)} y={PAD.top} height={H - PAD.top - PAD.bottom} className="day-night" />}
        {/* The five feel bands (3-hour windows), named along the top. */}
        {BANDS.map((b) => (
          <g key={b.id}>
            <line x1={xOf(b.hours[0] - 0.5)} x2={xOf(b.hours[0] - 0.5)} y1={PAD.top} y2={H - PAD.bottom} className="day-band-edge" />
            <text x={xOf(b.hours[1])} y={PAD.top - 6} textAnchor="middle" className="day-band-label">
              {b.label}
            </text>
          </g>
        ))}
        <line x1={xOf(20.5)} x2={xOf(20.5)} y1={PAD.top} y2={H - PAD.bottom} className="day-band-edge" />

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
            <text x={PAD.left - 6} y={yOf(t) + 4} className="chart-tick" textAnchor="end">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {/* The unit once, above the axis. */}
        <text x={PAD.left - 6} y={PAD.top - 6} className="chart-unit" textAnchor="end">
          {metric.unit === "h" ? "時間" : metric.unit}
        </text>

        {nowHour != null && (
          <g>
            <line x1={xOf(nowHour)} x2={xOf(nowHour)} y1={PAD.top} y2={H - PAD.bottom} className="day-now" />
            <text x={xOf(nowHour) + 3} y={H - PAD.bottom - 4} className="day-now-label">
              今
            </text>
          </g>
        )}
        {metric.chart === "bar" ? (
          <rect x={xOf(hour - 1)} width={step} y={PAD.top} height={H - PAD.top - PAD.bottom} className="day-cursor-bar" />
        ) : (
          <line x1={xOf(hour)} x2={xOf(hour)} y1={PAD.top} y2={H - PAD.bottom} className="day-cursor" />
        )}

        {metric.chart === "bar" ? (
          <>
            {second && bars(second, color, true)}
            {bars(main, color, false)}
          </>
        ) : (
          <>
            {air && line(air, DATA.mean, false, 1.4, 0.8)}
            {second && line(second, color, true, 1.6, 0.7)}
            {line(main, color, false, 2.4)}
            {[main, ...(second ? [second] : [])].map((s, k) => {
              const p = s[hour - 1];
              return p?.v == null ? null : (
                <circle key={k} cx={xOf(p.hour)} cy={yOf(p.v)} r={3.6} fill={k ? "var(--surface-base)" : color} stroke={color} opacity={k ? 0.8 : 1} />
              );
            })}
          </>
        )}

        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <text key={h} x={xOf(h)} y={H - 8} textAnchor="middle" className="chart-x">
            {h}
          </text>
        ))}
      </svg>
    </div>
  );
}


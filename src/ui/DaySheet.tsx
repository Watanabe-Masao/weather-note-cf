// Day detail sheet: opened by tapping a column. A summary of the day and its partner day,
// then the 24 hours of both as a graph, switchable between 実測 and 肌感.

import { type PointerEvent, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, jstHour } from "../../shared/dates";
import { BANDS, LEVELS } from "../../shared/feel";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { cachedSun, clock, hourOfDay, loadSun, sunAvailable, type SunTimes } from "../data/sun";
import {
  axisRange,
  type DetailMetricId,
  detailMetric,
  formatDetail,
  type HourPoint,
  hourSeries,
  initialHour,
  offeredMetrics,
  signedDiff,
} from "../dayDetail";
import { FeelContext, LEVEL_COLORS } from "./FeelBar";
import { WeatherIcon } from "./WeatherIcon";

export interface DayPick {
  date: string;
  /** The day it is compared with (the other side of the table), when there is one. */
  other: string | null;
}

interface Props {
  store: WeatherStore | null;
  station: string;
  pick: DayPick;
  initialMetric: DetailMetricId;
  today: string;
  onClose: () => void;
}

const COLORS = { main: "#f08b7d", other: "#6fb3f2", air: "#9aa7b8" } as const;

function relative(date: string, today: string) {
  if (date === today) return "今日";
  if (date === addDays(today, -1)) return "昨日";
  if (date === addDays(today, 1)) return "明日";
  return null;
}

const shortDate = (d: string) => `${d.slice(0, 4)}/${+d.slice(5, 7)}/${+d.slice(8)}`;

function kindOf(store: WeatherStore | null, station: string, date: string) {
  const day = store?.getDay(station, date);
  if (day?.state !== "ready" || !day.row) return null;
  if (day.row.type === "forecast") return "予報";
  return day.kind === "variable" ? "暫定" : "実績";
}

/** Sunrise and sunset: from the forecast row when it has them, otherwise asked once. */
function useSun(station: string, date: string | null, today: string, row: WeatherRow | null | undefined): SunTimes | null {
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

export function DaySheet({ store, station, pick, initialMetric, today, onClose }: Props) {
  const settings = useContext(FeelContext);
  const { date, other } = pick;
  const [metricId, setMetricId] = useState<DetailMetricId>(initialMetric);
  const metric = detailMetric(metricId);
  const lastMeasured = useRef<DetailMetricId>(initialMetric === "feel" ? "temp" : initialMetric);
  if (metricId !== "feel") lastMeasured.current = metricId;

  // Hourly data for both days, first in line while the sheet is open.
  useEffect(() => {
    if (!store) return;
    store.wantHours(station, [date, ...(other ? [other] : [])], 0, "day");
    return () => store.wantHours(station, [], 0, "day");
  }, [store, station, date, other]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const day = store?.getDay(station, date);
  const otherDay = other ? store?.getDay(station, other) : null;
  const hours = store?.getHours(station, date);
  const otherHours = other ? store?.getHours(station, other) : null;
  const row = day?.row;
  const otherRow = otherDay?.row;
  const sun = useSun(station, date, today, row);

  const main = useMemo(() => hourSeries(hours?.rows ?? [], metricId, settings), [hours, metricId, settings]);
  const second = useMemo(() => hourSeries(otherHours?.rows ?? [], metricId, settings), [otherHours, metricId, settings]);
  const air = useMemo(() => (metricId === "feel" ? hourSeries(hours?.rows ?? [], "temp", settings) : null), [hours, metricId, settings]);
  const sunMain = useMemo(() => hourSeries(hours?.rows ?? [], "sun", settings), [hours, settings]);
  const sunOther = useMemo(() => hourSeries(otherHours?.rows ?? [], "sun", settings), [otherHours, settings]);
  const isToday = date === today;
  const nowHour = jstHour();
  const [hour, setHour] = useState<number | null>(null);
  const shownHour = hour ?? initialHour(main, isToday, nowHour);
  useEffect(() => setHour(null), [date]);

  const rel = relative(date, today);
  const kind = kindOf(store, station, date);
  const feelName = settings.sun ? "日なた温度" : "日かげ温度";

  // Drag the handle down to close.
  const drag = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const handleDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = e.clientY;
  };
  const handleMove = (e: PointerEvent<HTMLDivElement>) => drag.current != null && setPull(Math.max(0, e.clientY - drag.current));
  const handleUp = () => {
    const moved = pull;
    drag.current = null;
    setPull(0);
    if (moved > 80 || moved < 6) onClose();
  };

  // Opened on snow or rain chance for days that have none: show temperature instead.
  const offered = offeredMetrics(hours?.rows ?? [], otherHours?.rows ?? [], settings);
  const loaded = hours?.state === "ready" && (!other || otherHours?.state === "ready");
  useEffect(() => {
    if (loaded && metricId !== "feel" && !offered.some((m) => m.id === metricId)) setMetricId("temp");
  }, [loaded, metricId, offered]);

  const at = (points: HourPoint[]) => points[shownHour - 1]?.v ?? null;

  return (
    <div className="day-sheet-backdrop" onClick={onClose}>
      <section
        className="day-sheet"
        role="dialog"
        aria-label={`${shortDate(date)}の詳細`}
        style={pull ? { transform: `translateY(${pull}px)`, transition: "none" } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp}>
          <span className="grabber" />
        </div>

        <header className="day-head">
          <h2 className={`tone-${dayTone(date)}`}>
            {rel && <span className="day-rel">{rel}</span>}
            {shortDate(date)}（{weekdayOf(date)}）
          </h2>
          <button className="chip icon" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>

        <div className="day-summary">
          <div className="day-weather">
            <span className="day-icon">{day?.state === "ready" ? <WeatherIcon text={row?.dayWeather as string | null} /> : <span className="skeleton icon" />}</span>
            <span className="day-text">{(row?.dayWeather as string) || (day?.state === "ready" ? "天気の記録なし" : "")}</span>
            {kind && <span className={`day-kind kind-${kind}`}>{kind}</span>}
          </div>
          <dl className="day-tiles" style={{ gridTemplateColumns: `repeat(${row?.type === "forecast" && typeof row.probability === "number" ? 5 : 4}, 1fr)` }}>
            <Tile label="最高" unit="℃" tone="hot" v={row?.max} o={otherRow?.max} hasOther={!!other} />
            <Tile label="最低" unit="℃" tone="cold" v={row?.min} o={otherRow?.min} hasOther={!!other} />
            <Tile label="降水" unit="mm" tone="rain" v={row?.rain} o={otherRow?.rain} hasOther={!!other} />
            <Tile label="湿度" unit="%" v={row?.humidity} o={otherRow?.humidity} hasOther={!!other} digits={0} />
            {/* Rain chance exists only for forecasts, so it has nothing to compare with. */}
            {row?.type === "forecast" && typeof row.probability === "number" && (
              <Tile label="降水確率" unit="%" tone="rain" v={row.probability} o={null} hasOther={false} digits={0} />
            )}
          </dl>
          <p className="day-sun">
            <span>
              日の出 {clock(sun?.sunrise ?? null)}　日の入り {clock(sun?.sunset ?? null)}
            </span>
            {other && (
              <span className="day-vs">
                差は <b className={`tone-${dayTone(other)}`}>{shortDate(other).slice(5)}（{weekdayOf(other)}）</b> と比べて
              </span>
            )}
          </p>
        </div>

        <div className="day-switch" role="tablist">
          <button
            role="tab"
            aria-selected={metricId !== "feel"}
            className={metricId !== "feel" ? "on" : ""}
            onClick={() => setMetricId(lastMeasured.current)}
          >
            実測
          </button>
          <button role="tab" aria-selected={metricId === "feel"} className={metricId === "feel" ? "on" : ""} onClick={() => setMetricId("feel")}>
            肌感
          </button>
        </div>
        {metricId !== "feel" ? (
          <div className="day-metrics">
            {offered.map((m) => (
              <button key={m.id} className={m.id === metricId ? "chip on" : "chip"} onClick={() => setMetricId(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="day-feel-note">
            {feelName}（気温・湿度・風{settings.sun ? "・日射" : ""}から）。背景は肌感の5段階
          </p>
        )}

        <HourStatus state={hours?.state} error={hours?.error} onRetry={() => store?.retryDay(station, date)} />
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
        />

        <p className="day-readout">
          <b>{shownHour}時</b>
          <span style={{ color: COLORS.main }}>
            {shortDate(date).slice(5)} {formatDetail(at(main), metric)}
            {metric.unit !== "h" && at(main) != null ? metric.unit : ""}
          </span>
          {other && (
            <span style={{ color: COLORS.other }}>
              {shortDate(other).slice(5)} {formatDetail(at(second), metric)}
              {metric.unit !== "h" && at(second) != null ? metric.unit : ""}
            </span>
          )}
          {other && metric.unit !== "h" && <span className="diff">{signedDiff(at(main), at(second), metric.unit === "%" ? 0 : 1)}</span>}
        </p>
        {metricId === "radiation" && (
          <p className="day-readout sub">
            <span>日照</span>
            <span style={{ color: COLORS.main }}>{formatDetail(sunMain[shownHour - 1]?.v ?? null, detailMetric("sun"))}</span>
            {other && <span style={{ color: COLORS.other }}>{formatDetail(sunOther[shownHour - 1]?.v ?? null, detailMetric("sun"))}</span>}
          </p>
        )}
        {metricId === "feel" && (
          <p className="feel-legend day-legend">
            {LEVELS.map((label, i) => (
              <span key={label}>
                <i style={{ background: LEVEL_COLORS[i] }} />
                {label}
              </span>
            ))}
          </p>
        )}
        <p className="day-legend-lines">
          <span>
            <i className="lg-solid" style={{ borderColor: COLORS.main }} />
            {shortDate(date).slice(5)}
          </span>
          {other && (
            <span>
              <i className="lg-dashed" style={{ borderColor: COLORS.other }} />
              {other && shortDate(other).slice(5)}
            </span>
          )}
          <span>
            <i className="lg-dotted" style={{ borderColor: COLORS.main }} />
            予報
          </span>
          {metricId === "feel" && (
            <span>
              <i className="lg-solid" style={{ borderColor: COLORS.air }} />
              気温
            </span>
          )}
        </p>
      </section>
    </div>
  );
}

function Tile({
  label,
  unit,
  tone,
  v,
  o,
  hasOther,
  digits = 1,
}: {
  label: string;
  unit: string;
  tone?: string;
  v: unknown;
  o: unknown;
  hasOther: boolean;
  digits?: number;
}) {
  const value = typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
  return (
    <div className="day-tile">
      <dt>{label}</dt>
      <dd className={tone ? `tone-${tone}` : undefined}>
        {value}
        <small>{unit}</small>
      </dd>
      {hasOther && <dd className="diff">{signedDiff(v, o, digits)}</dd>}
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

const H = 210;
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
}) {
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
  const { lo, hi } = axisRange(values, metric);
  const yOf = (v: number) => PAD.top + ((hi - Math.min(hi, Math.max(lo, v))) * (H - PAD.top - PAD.bottom)) / (hi - lo);
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
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
              {formatDetail(t, metric)}
            </text>
          </g>
        ))}

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
            {second && bars(second, COLORS.other, true)}
            {bars(main, COLORS.main, false)}
          </>
        ) : (
          <>
            {air && line(air, COLORS.air, false, 1.4, 0.8)}
            {second && line(second, COLORS.other, true, 1.6, 0.85)}
            {line(main, COLORS.main, false, 2.4)}
            {[main, ...(second ? [second] : [])].map((s, k) => {
              const p = s[hour - 1];
              return p?.v == null ? null : (
                <circle key={k} cx={xOf(p.hour)} cy={yOf(p.v)} r={3.6} fill={k ? "var(--bg)" : COLORS.main} stroke={k ? COLORS.other : COLORS.main} />
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

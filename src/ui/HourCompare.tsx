// The 24 hours of one day next to its partner day, for one hourly item.
// Shared by the day detail and the sheet's 時間帯 tab, so both look and behave the same.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { jstHour } from "../../shared/dates";
import { altitudeCurve, type DayEdges, dayEdges, dayParts, type PartWindow } from "../../shared/dayParts";
import { BRIGHTNESS_LEVELS, brightnessLevel, brightnessRatio, hourLight, stepOutFeel, usualText } from "../../shared/brightness";
import { usualLightOf } from "../light";
import { stationLatLon } from "../../shared/sunTimes";
import { hoursWeather } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { ForecastHatch, GraphReadout, GuideLines } from "./kit";
import { WeatherIcon } from "./WeatherIcon";
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
import { type DataColor, DATA, LIGHT_LEVELS } from "../design/tokens";
import { dateLabel, needsYear, niceTicks, tickLabel } from "../design/format";
import { FeelContext, legendOf, levelRanges } from "./FeelBar";

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
  // The parts of the day and the sun's height, by the sun at this station (shared/dayParts.ts).
  const day = useMemo(() => ({ parts: dayParts(date, station), edges: dayEdges(date, station), curve: altitudeCurve(date, station, 10) }), [date, station]);

  const main = useMemo(() => hourSeries(hours?.rows ?? [], metricId, settings), [hours, metricId, settings]);
  const second = useMemo(() => hourSeries(otherHours?.rows ?? [], metricId, settings), [otherHours, metricId, settings]);
  const air = useMemo(() => (metricId === "feel" ? hourSeries(hours?.rows ?? [], "temp", settings) : null), [hours, metricId, settings]);
  const sunMain = useMemo(() => hourSeries(hours?.rows ?? [], "sun", settings), [hours, settings]);
  const sunOther = useMemo(() => hourSeries(otherHours?.rows ?? [], "sun", settings), [otherHours, settings]);
  const chance = useMemo(() => hourSeries(hours?.rows ?? [], "probability", settings), [hours, settings]);
  // 明るさ for each hour 1–24 (null where the hour is missing), both days, at the station.
  const lightOf = (rows: WeatherRow[] | undefined) => {
    const byHour = new Map((rows ?? []).map((r) => [r.n, r]));
    return Array.from({ length: 24 }, (_, i) => {
      const r = byHour.get(i + 1);
      return r ? hourLight(r, station).index : null;
    });
  };
  const lightMain = useMemo(() => lightOf(hours?.rows), [hours, station]); // eslint-disable-line react-hooks/exhaustive-deps
  const lightOther = useMemo(() => lightOf(otherHours?.rows), [otherHours, station]); // eslint-disable-line react-hooks/exhaustive-deps
  // The weather under each time tick (0, 3, … 24 o'clock): the hour either side of it.
  const bandWx = useMemo(() => {
    // JMA hour n covers n−1 to n o'clock: hours h and h + 1 are the hour either side of h o'clock.
    const around = (h: number) => [h, h + 1].filter((n) => n >= 1 && n <= 24);
    return {
      main: WX_TICKS.map((h) => hoursWeather(hours?.rows ?? [], around(h), undefined, 1)),
      other: other ? WX_TICKS.map((h) => hoursWeather(otherHours?.rows ?? [], around(h), undefined, 1)) : null,
    };
  }, [hours, otherHours, other]);
  const isToday = date === today;
  const nowHour = jstHour();
  const [hour, setHour] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const shownHour = hour ?? initialHour(main, isToday, nowHour);
  useEffect(() => setHour(null), [date]);

  const at = (points: HourPoint[]) => points[shownHour - 1]?.v ?? null;
  // Same month and day a year apart would read "11/10" twice: the comparison day keeps its year.
  const mainLabel = dateLabel(date, { weekday: false });
  const otherLabel = other ? dateLabel(other, { year: needsYear(other, date), weekday: false }) : "";
  const tone = HOUR_TONE[metricId];
  const color = DATA[tone];

  return (
    <div className="hour-compare">
      {/* The hour's values above the graph, in the card every graph uses. */}
      <GraphReadout
        live={scrubbing}
        unit={metric.unit === "h" ? "" : metric.unit}
        title={
          <>
            {shownHour}時<small> {mainLabel}{other ? ` / ${otherLabel}` : ""}</small>
          </>
        }
        rows={[
          {
            key: "main",
            label: metric.label,
            color,
            a: formatDetail(at(main), metric),
            b: other ? formatDetail(at(second), metric) : "—",
            diff: other && metric.unit !== "h" ? signedDiff(at(main), at(second), metric.unit) : "",
          },
          // The weather of the shown hour (#: 時間帯の天気), both days. Faint = estimated.
          {
            key: "wx",
            label: "天気",
            a: <HourWeather w={hoursWeather(hours?.rows ?? [], [shownHour], stationLatLon(station)?.lat, 1)} />,
            b: other ? <HourWeather w={hoursWeather(otherHours?.rows ?? [], [shownHour], stationLatLon(station)?.lat, 1)} /> : "—",
          },
          ...(metricId === "radiation"
            ? [
                {
                  key: "sun",
                  label: "日照",
                  color: DATA.sun,
                  unit: "",
                  a: formatDetail(sunMain[shownHour - 1]?.v ?? null, detailMetric("sun")),
                  b: other ? formatDetail(sunOther[shownHour - 1]?.v ?? null, detailMetric("sun")) : "—",
                },
                // 明るさ (shared/brightness.ts): the felt level of the hour, and how many times brighter.
                {
                  key: "light",
                  label: "明るさ",
                  unit: "",
                  a: lightMain[shownHour - 1] == null ? "—" : brightnessLevel(lightMain[shownHour - 1]!).label,
                  b: other ? (lightOther[shownHour - 1] == null ? "—" : brightnessLevel(lightOther[shownHour - 1]!).label) : "—",
                  diff: other ? brightnessRatio(lightMain[shownHour - 1], lightOther[shownHour - 1]) : "",
                },
                // The first impression on stepping out of a lit room (about 500 lx; shared/brightness.ts).
                {
                  key: "stepOut",
                  label: "外に出たとき",
                  unit: "",
                  a: stepOutFeel(lightMain[shownHour - 1]) ?? "—",
                  b: other ? (stepOutFeel(lightOther[shownHour - 1]) ?? "—") : "—",
                },
              ]
            : []),
          ...(metricId === "rain" && chance.some((p) => p.v != null)
            ? [{ key: "chance", label: "降水確率", color: DATA.rain, unit: "%", a: at(chance) == null ? "—" : String(Math.round(at(chance)!)) }]
            : []),
        ]}
      />

      <div className="hour-chart-wrap">
      <HourChart
        metricId={metricId}
        main={main}
        second={other ? second : null}
        air={air}
        ranges={levelRanges(settings.thresholds, settings.scale)}
        sun={sun}
        day={day}
        nowHour={isToday ? nowHour : null}
        hour={shownHour}
        onHour={setHour}
        onScrub={setScrubbing}
        height={height}
        color={color}
        bandWx={bandWx}
      />
      <HourStatus state={hours?.state} error={hours?.error} onRetry={() => store?.retryDay(station, date)} />
      </div>

      {metricId === "radiation" && (
        <LightStrip main={lightMain} other={other ? lightOther : null} shownHour={shownHour} usual={{ main: usualLightOf(store, station, date), other: other ? usualLightOf(store, station, other) : null }} />
      )}

      {metricId === "feel" && (
        <p className="level-legend">
          {legendOf(settings.scale).map(({ label, color }) => (
            <span key={label}>
              <i style={{ background: color }} />
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
          <i className="ls-forecast" />
          予報
        </span>
        {metricId === "feel" && (
          <span>
            <i className="ls-solid" style={{ borderColor: DATA.mean }} />
            気温
          </span>
        )}
        <span>時刻の下の天気：その前後1時間。大きい方が対象{other ? "・小さい方が比較" : ""}（薄いのは日照と降水からの推定）</span>
      </p>
    </div>
  );
}

/**
 * The target day's hours while they are not there (rule: 状態の見せ方): over the graph area, which
 * keeps its size so nothing jumps — loading shimmers, a failure says so with 再試行 in the same place.
 */
function HourStatus({ state, error, onRetry }: { state?: string; error?: string; onRetry: () => void }) {
  if (state === "ready") return null;
  if (state === "error")
    return (
      <div className="state-overlay error" role="alert">
        <b>時間ごとのデータを取得できませんでした</b>
        {error && <small>{error}</small>}
        <button className="state-retry" onClick={onRetry}>
          再試行
        </button>
      </div>
    );
  if (state === "outside")
    return (
      <div className="state-overlay">
        <small>この日の時間ごとのデータはありません</small>
      </div>
    );
  return (
    <div className="state-overlay loading" aria-live="polite">
      <span className="state-spinner" aria-hidden />
      <small>時間ごとのデータを取得中…</small>
    </div>
  );
}

const PAD = { left: 34, right: 10, top: 18, bottom: 26 };

type BandWx = { text: string | null; estimated: boolean };

/** The hours of the x axis's labels, under which the weather is shown. */
const WX_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** One hour's weather in the readout card: icon and words; faint when estimated. */
function HourWeather({ w }: { w: BandWx }) {
  if (!w.text) return <>—</>;
  return (
    // Icon only: the value columns are narrow (the words are in the title and the label).
    <span className={`ro-wx${w.estimated ? " weather-estimated" : ""}`} title={w.estimated ? `${w.text}（日照と降水からの推定）` : w.text} aria-label={w.estimated ? `${w.text}（推定）` : w.text}>
      <WeatherIcon text={w.text} size={20} />
    </span>
  );
}

/** One band's weather: the day's icon, and the partner day's smaller beside it. Estimates are faint. */
function BandWeatherIcons({ main, other }: { main: BandWx; other: BandWx | null }) {
  const icon = (w: BandWx, size: number, cls: string) =>
    w.text ? (
      <span className={`${cls}${w.estimated ? " weather-estimated" : ""}`} title={w.estimated ? `${w.text}（推定：日照と降水から）` : w.text}>
        <WeatherIcon text={w.text} size={size} />
      </span>
    ) : (
      <span className={`${cls} none`}>—</span>
    );
  return (
    <>
      {icon(main, 18, "band-wx-main")}
      {other ? icon(other, 13, "band-wx-other") : null}
    </>
  );
}

/**
 * 明るさ under the 日差し graph: one cell per hour, darker to lighter by the felt level (B of the
 * mocks, 2026-11-12). The cells sit under the graph's hours (same side margins as the plot).
 */
function LightStrip({ main, other, shownHour, usual }: { main: (number | null)[]; other: (number | null)[] | null; shownHour: number; usual: { main: number | null; other: number | null } }) {
  const row = (label: string, values: (number | null)[]) => (
    <div className="light-row">
      <span className="light-row-label">{label}</span>
      <div className="light-cells" role="img" aria-label={`${label}の明るさ（1時間ごと）`}>
        {values.map((v, i) => (
          <i key={i} className={i + 1 === shownHour ? "on" : undefined} style={{ background: v == null ? "transparent" : LIGHT_LEVELS[Math.min(5, Math.floor(v))] }} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="light-strip">
      <span className="light-title">
        明るさ
        {usual.main != null || usual.other != null ? (
          <small>
            {" "}この日の昼は {usualText(usual.main)}{other ? `・比較の日は ${usualText(usual.other)}` : ""}（前の7日と比べて）
          </small>
        ) : null}
      </span>
      {row("対象", main)}
      {other && row("比較", other)}
      <p className="light-note">「外に出たとき」は、室内（約500lx）に慣れた目で外に出た直後の感じ方です。目はその後、明るさには数分、暗さには10〜30分で慣れます。</p>
      <p className="light-legend">
        {BRIGHTNESS_LEVELS.map((l, i) => (
          <span key={l.id}>
            <i style={{ background: LIGHT_LEVELS[i] }} />
            {l.label}
          </span>
        ))}
      </p>
    </div>
  );
}

function HourChart({
  metricId,
  main,
  second,
  air,
  ranges,
  sun,
  day,
  nowHour,
  hour,
  onHour,
  onScrub,
  height,
  color,
  bandWx,
}: {
  bandWx?: { main: BandWx[]; other: BandWx[] | null };
  metricId: DetailMetricId;
  main: HourPoint[];
  second: HourPoint[] | null;
  air: HourPoint[] | null;
  /** Coloured 肌感 ranges behind the feel graph (the chosen scale). */
  ranges: { from: number; to: number; color: string }[];
  sun: SunTimes | null;
  /** The five parts (by the sun's altitude), the day's edges, and the altitude through the day. */
  day: { parts: PartWindow[]; edges: DayEdges; curve: { min: number; deg: number }[] };
  nowHour: number | null;
  hour: number;
  onHour: (h: number) => void;
  /** True while the finger is on the graph (the card above reads live). */
  onScrub?: (on: boolean) => void;
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
  const { lo, hi, ticks } = niceTicks(range.lo, range.hi, 5);
  const yOf = (v: number) => PAD.top + ((hi - Math.min(hi, Math.max(lo, v))) * (H - PAD.top - PAD.bottom)) / (hi - lo);
  // Sunrise and sunset from the sun API when known (the stored ones), else calculated.
  const rise = hourOfDay(sun?.sunrise ?? null) ?? day.edges.rise / 60;
  const set = hourOfDay(sun?.sunset ?? null) ?? day.edges.set / 60;
  const dawn = day.edges.dawn / 60;
  const dusk = day.edges.dusk / 60;
  const plotTop = PAD.top;
  const plotBottom = H - PAD.bottom;
  // The sun's height as a faint hill along the bottom: 90° would fill a third of the graph.
  const sunY = (deg: number) => plotBottom - (Math.max(0, deg) / 90) * (plotBottom - plotTop) * 0.33;
  const above = day.curve.filter((p, i, a) => p.deg > 0 || (a[i - 1]?.deg ?? -1) > 0 || (a[i + 1]?.deg ?? -1) > 0);
  const sunPath = above.length ? `M${xOf(above[0].min / 60)},${plotBottom} ` + above.map((p) => `L${xOf(p.min / 60)},${sunY(p.deg)}`).join(" ") + ` L${xOf(above.at(-1)!.min / 60)},${plotBottom} Z` : null;
  const clip = (m: number) => Math.min(24, Math.max(0, m / 60));

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
          strokeDasharray={dashed ? "6 4" : undefined}
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
        onScrub?.(true);
        pickAt(e.clientX);
      }}
      onPointerMove={(e) => scrub.current && pickAt(e.clientX)}
      onPointerUp={() => {
        scrub.current = false;
        onScrub?.(false);
      }}
      onPointerLeave={() => {
        scrub.current = false;
        onScrub?.(false);
      }}
      onPointerCancel={() => {
        scrub.current = false;
        onScrub?.(false);
      }}
    >
      <svg width={w} height={H} role="img" aria-label={`${metric.label}の時間ごとのグラフ`}>
        {/* Feel levels behind the lines. */}
        {metricId === "feel" &&
          ranges.map(({ from, to, color }, i) => {
            if (to <= lo || from >= hi) return null;
            const top = yOf(Math.min(hi, to));
            const bottom = yOf(Math.max(lo, from));
            return <rect key={i} x={PAD.left} width={plotW} y={top} height={Math.max(0, bottom - top)} fill={color} opacity={0.14} />;
          })}
        <defs>
          <ForecastHatch id="fc-hours" />
        </defs>
        {/* Forecast hours (of either day): hatched, 予報 over the first of them. */}
        {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => {
          const fc = (k: number) => !!main[k - 1]?.forecast || !!second?.[k - 1]?.forecast;
          if (!fc(h)) return null;
          return (
            <g key={`fc-${h}`}>
              <rect x={xOf(h - 1)} width={xOf(h) - xOf(h - 1)} y={PAD.top} height={H - PAD.top - PAD.bottom} fill="url(#fc-hours)" className="chart-forecast" />
              {(h === 1 || !fc(h - 1)) && (
                <text x={xOf(h - 1) + 4} y={PAD.top + 12} className="chart-forecast-label">
                  予報
                </text>
              )}
            </g>
          );
        })}
        {/* Night (the sun more than 6° below the horizon) dark; twilight (sunrise and sunset to 6° below) lighter. */}
        <rect x={xOf(0)} width={xOf(dawn) - xOf(0)} y={plotTop} height={plotBottom - plotTop} className="day-night" />
        <rect x={xOf(dusk)} width={xOf(24) - xOf(dusk)} y={plotTop} height={plotBottom - plotTop} className="day-night" />
        <rect x={xOf(dawn)} width={Math.max(0, xOf(rise) - xOf(dawn))} y={plotTop} height={plotBottom - plotTop} className="day-twilight" />
        <rect x={xOf(set)} width={Math.max(0, xOf(dusk) - xOf(set))} y={plotTop} height={plotBottom - plotTop} className="day-twilight" />
        {/* The sun's height through the day, and its highest point. */}
        {sunPath && <path d={sunPath} className="day-sun" />}
        {/* The five parts of the day (by the sun's height), named along the top. */}
        {day.parts.map((p) => {
          const from = clip(p.from);
          const to = clip(p.to);
          if (to - from < 0.2) return null;
          return (
            <g key={p.id}>
              <line x1={xOf(from)} x2={xOf(from)} y1={plotTop} y2={plotBottom} className="day-band-edge" />
              <text x={xOf((from + to) / 2)} y={plotTop - 6} textAnchor="middle" className="day-band-label">
                {p.label}
              </text>
            </g>
          );
        })}
        {day.parts.at(-1)!.to < 1440 && <line x1={xOf(day.parts.at(-1)!.to / 60)} x2={xOf(day.parts.at(-1)!.to / 60)} y1={plotTop} y2={plotBottom} className="day-band-edge" />}

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
          <GuideLines
            x={xOf(hour)}
            top={PAD.top}
            bottom={H - PAD.bottom}
            left={PAD.left}
            points={main[hour - 1]?.v != null ? [{ y: yOf(main[hour - 1].v!), color, label: formatDetail(main[hour - 1].v, metric) }] : []}
          />
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

        {/* The sun's highest point, in front of bars and lines (it was hidden behind 日差し's bars). */}
        <text x={xOf(day.edges.noon / 60)} y={sunY(day.edges.noonAltitude) - 4} textAnchor="middle" className="day-sun-label">
          南中 {Math.round(day.edges.noonAltitude)}°
        </text>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <text key={h} x={xOf(h)} y={H - 8} textAnchor="middle" className="chart-x">
            {h}
          </text>
        ))}
      </svg>
      {bandWx && (
        <div className="band-wx" aria-label="時刻ごとの天気（その前後1時間。大きい方が対象日、小さい方が比較日。薄いものは日照と降水からの推定）">
          {WX_TICKS.map((h, i) => (
            <span key={h} className="band-wx-cell" style={{ left: xOf(h) }}>
              <BandWeatherIcons main={bandWx.main[i]} other={bandWx.other?.[i] ?? null} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


// Comparison chart for the seven days around the target day.
// Line style says which day, nothing else: target solid (bars filled), comparison dashed (bars
// outlined) and lighter. Forecast days are a hatched background with 予報 at the top.
// Missing values break the line (never interpolated).

import { usualLightOf } from "../light";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { dayTone } from "../../shared/holidays";
import { type ChartMetric, graphSeries } from "../chartMetrics";
import { barLook, barPath, DATA, lineLook, SHAPE } from "../design/tokens";
import { Button, Chip, ForecastHatch, GraphReadout, GuideLines, BarSample, InfoNote, LineSample, RangeSample, Segmented } from "./kit";
import type { WeatherStore } from "../data/store";
import { dateLabel, digitsOf, monthDay, niceTicks, shortDay, signedDiff, tickLabel } from "../design/format";
import { FeelContext } from "./FeelBar";
import { BetaContext } from "../beta/settings";
import { baselineOf, useBaselineHistory } from "../beta/useBaseline";
import { useDrumPan } from "./useDrumPan";
import { PartsWeather } from "./PartsWeather";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  /** Comparison day for each target day (null when it has none). */
  partner: (date: string) => string | null;
  metric: ChartMetric;
  /** Drawing height: the graph grows with the sheet. */
  height?: number;
  /** Tap on a day (its column, bars, points or dates): open that day's hours. */
  onPickDay?: (date: string) => void;
  /** Swipe sideways: the graph follows the finger and moves the selected day by whole days. */
  onShiftDays?: (days: number) => void;
  /** Switch 日なた ↔ 日かげ (the shared setting). The 肌感 chip cycles 日なた → 日かげ → オフ. */
  onToggleSun?: () => void;
}

/** Data colours from the design tokens. */
const COLORS = DATA;
const HIDDEN_KEY = "weather-note:chart-hidden";
const LOOK_KEY = "weather-note:chart-look";
// Bottom: two rows of dates (the target days, then their comparison days).
const PAD = { left: 34, right: 10, top: 14, bottom: 44 };
/** The band under the plot with one row of dates (the comparison days are the same dates). */
const DATE_ROW_ONE = 26;
/** Height of one row of small numbers under the plot (spread, rain chance, snow). */
const UNDER_ROW = 13;

interface Point {
  x: number;
  v: number | null;
  forecast: boolean;
}

/** Which lines of an item are turned off, remembered per item on this device (a convenience only). */
function useHidden(metric: ChartMetric) {
  const read = (): Record<string, string[]> => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "{}");
    } catch {
      return {};
    }
  };
  const [all, setAll] = useState(read);
  const hidden = new Set(all[metric.id] ?? metric.hiddenByDefault ?? []);
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(all));
    } catch {
      // Not remembering the choice is harmless.
    }
  }, [all]);
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (!next.delete(key)) next.add(key);
    setAll({ ...all, [metric.id]: [...next] });
  };
  const reset = () => {
    const { [metric.id]: _, ...rest } = all;
    setAll(rest);
  };
  return { shown: (key: string) => !hidden.has(key), toggle, reset };
}

/**
 * 気温 drawn as lines (線) or as each day's 最高〜最低 bar (幅), remembered on this device (a
 * convenience only, like the lines turned off).
 */
type Look = "line" | "range";
function useLook(): [Look, (l: Look) => void] {
  const [look, setLook] = useState<Look>(() => {
    try {
      return localStorage.getItem(LOOK_KEY) === "range" ? "range" : "line";
    } catch {
      return "line";
    }
  });
  const set = (l: Look) => {
    setLook(l);
    try {
      localStorage.setItem(LOOK_KEY, l);
    } catch {
      // Not remembering the choice is harmless.
    }
  };
  return [look, set];
}

/** The plot is never smaller than this (a short sheet scrolls instead), nor the graph taller than MAX_SVG. */
const MIN_PLOT = 150;
const MAX_SVG = 640;

/** Days drawn beyond each edge, so a swipe reveals real data instead of blank space. */
const BUFFER = 4;
/** Hold this long (ms) without moving to scrub instead of panning. */
const LONG_PRESS = 280;

export function Chart({ store, station, target, partner, metric, height = 190, onPickDay, onShiftDays, onToggleSun }: Props) {
  const feel = useContext(FeelContext);
  const beta = useContext(BetaContext);
  const { shown, toggle, reset } = useHidden(metric);
  const [look, setLook] = useLook();
  // 幅: temperature only (its 最高・最低 are one day's range; other pairs are not drawn this way).
  const range = metric.id === "temp" && look === "range";
  const spreadOn = !!metric.spread && shown("spread");
  // In 幅 the bar is the 最高〜最低 itself: those two are drawn by it, whatever their chips said.
  const ranged = (key: string) => range && (key === "max" || key === "min");
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  // The graph fills what the sheet has left, so the whole face fits without scrolling: the sheet's
  // body less everything else in it (the card, the switches, the legend, the chips, the notes) —
  // measured, not guessed. Null until measured (then `height` from the sheet's size is used).
  const [fit, setFit] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const body = el.closest<HTMLElement>(".sheet-body");
    const measure = () => {
      setW(el.clientWidth);
      const svg = el.querySelector<SVGSVGElement>(":scope > svg");
      if (!body || !svg) return;
      // The content's foot, margins and all, from the body's top (scrolled or not).
      const top = body.getBoundingClientRect().top - body.scrollTop;
      const foot = Math.max(...[...body.children].map((c) => c.getBoundingClientRect().bottom));
      const content = Math.ceil(foot - top + parseFloat(getComputedStyle(body).paddingBottom));
      const others = content - svg.getBoundingClientRect().height;
      setFit(Math.floor(body.clientHeight - others));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (body) ro.observe(body);
    measure();
    return () => ro.disconnect();
  }, []);

  // Seven visible days plus a buffer on each side; index BUFFER is the first visible day.
  const days = Array.from({ length: 7 + 2 * BUFFER }, (_, i) => addDays(target, i - 3 - BUFFER));
  // β: the days before each drawn day, for the 最近の基準 line (only while that line is on).
  const wantsBaseline = beta.enabled && metric.series.some((s) => s.history === "baseline") && shown("baseline");
  useBaselineHistory(store, station, wantsBaseline ? [...days, ...days.map(partner)] : [], "chart-baseline");
  // The left margin holds the labels of the rows under the plot (寒暖差, 明るい, いつも比) whole:
  // never narrower than the axis needs, wider when a label is longer (いつも比 was cut to つも比).
  const underWords = [...(metric.id === "temp" ? ["寒暖差"] : []), ...(metric.under ?? []).map((r) => r.label)];
  const frame = { ...PAD, left: Math.max(PAD.left, 12 + 11 * Math.max(0, ...underWords.map((l) => l.length))) };
  const step = (w - frame.left - PAD.right) / 7;
  const xOf = (i: number) => frame.left + step * (i - BUFFER + 0.5);
  // Long press (or mouse hover) scrubs: a guide follows the finger and the card above reads that day.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const scrubbedAt = useRef(0);
  const pan = useDrumPan(ref, step, onShiftDays, () => scrubbing.current);
  const dayAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - frame.left) / step) + BUFFER;
    return Math.max(BUFFER, Math.min(BUFFER + 6, i));
  };
  useEffect(() => {
    const el = ref.current!;
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    const stop = () => {
      window.clearTimeout(timer);
      start = null;
      if (scrubbing.current) {
        scrubbing.current = false;
        scrubbedAt.current = performance.now();
        setScrub(null);
      }
    };
    const ts = (e: TouchEvent) => {
      if (e.touches.length !== 1) return stop();
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      timer = window.setTimeout(() => {
        if (!start) return;
        scrubbing.current = true;
        setScrub(dayAt(start.x));
        navigator.vibrate?.(8);
      }, LONG_PRESS);
    };
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (scrubbing.current) {
        e.preventDefault();
        setScrub(dayAt(t.clientX));
      } else if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) {
        window.clearTimeout(timer);
        start = null;
      }
    };
    const pm = (e: PointerEvent) => e.pointerType === "mouse" && !e.buttons && setScrub(dayAt(e.clientX));
    const pl = (e: PointerEvent) => e.pointerType === "mouse" && setScrub(null);
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", stop);
    el.addEventListener("touchcancel", stop);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerleave", pl);
    return () => {
      stop();
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", stop);
      el.removeEventListener("touchcancel", stop);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerleave", pl);
    };
    // dayAt reads the current layout through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const read = (date: string | null, s: ChartMetric["series"][number]): { v: number | null; forecast: boolean } => {
    if (!date) return { v: null, forecast: false };
    if (s.history === "usualLight") return { v: usualLightOf(store, station, date), forecast: store?.getDay(station, date).row?.type === "forecast" };
    if (s.history === "baseline") {
      const b = baselineOf(store, station, date, beta.alpha);
      return { v: b?.value ?? null, forecast: !!b?.forecastMixed };
    }
    const day = store?.getDay(station, date);
    const hours = store?.getHours(station, date).rows ?? null;
    return { v: s.value(day?.row, hours, feel, station), forecast: day?.row?.type === "forecast" };
  };

  // β lines (最近の基準) only for a logged-in person.
  const lines = graphSeries(metric).filter((s) => beta.enabled || s.history !== "baseline");
  const all = lines.flatMap((s) => [
    { s, compare: false, points: days.map((d, i): Point => ({ x: xOf(i), ...read(d, s) })) },
    { s, compare: true, points: days.map((d, i): Point => ({ x: xOf(i), ...read(partner(d), s) })) },
  ]);
  const series = all.filter(({ s }) => ranged(s.key) || shown(s.key));
  // What is drawn as lines (and dots): in 幅, everything but 最高・最低.
  const lineSeries = series.filter(({ s }) => !ranged(s.key));
  const pick = (key: string, compare: boolean) => all.find((x) => x.s.key === key && x.compare === compare)!;

  // Rows of small numbers under the plot: the spread (temperature), rain chance and snow (rain).
  const under: { label: string; cells: string[]; muted?: boolean }[] = [];
  const cell = (date: string | null, key: string) => {
    const s = metric.series.find((x) => x.key === key)!;
    return read(date, s).v;
  };
  if (spreadOn) {
    const gap = (compare: boolean, i: number) => {
      const a = pick("max", compare).points[i].v;
      const b = pick("min", compare).points[i].v;
      // From the values as shown (one decimal each), so 最高 − 最低 on screen adds up.
      return a == null || b == null ? "—" : (+a.toFixed(1) - +b.toFixed(1)).toFixed(1);
    };
    under.push({ label: "寒暖差", cells: days.map((_, i) => gap(false, i)) }, { label: "", cells: days.map((_, i) => gap(true, i)), muted: true });
  }
  for (const row of metric.under ?? []) {
    const own = days.map((d) => cell(d, row.key));
    const other = row.compare ? days.map((d) => cell(partner(d), row.key)) : [];
    if (row.onlyWhenAny && ![...own, ...other].some((v) => v != null && v > 0)) continue;
    const text = (v: number | null) => (v == null ? "" : row.format(v));
    under.push({ label: row.label, cells: own.map(text) });
    if (row.compare) under.push({ label: "", cells: other.map(text), muted: true });
  }
  // One row of dates when every comparison day is the same date (前年同日): the second row would
  // repeat the first; which year it is, the card says. Otherwise both rows (前週, 前年同曜日, custom).
  const oneDateRow = days.slice(BUFFER - 1, BUFFER + 8).every((d) => {
    const p = partner(d);
    return !p || p.slice(5) === d.slice(5);
  });
  const dateBand = oneDateRow ? DATE_ROW_ONE : PAD.bottom;
  const bottom = dateBand + (under.length ? under.length * UNDER_ROW + 4 : 0);
  // The rows of numbers add to the height, so the plot keeps its size however many there are — unless
  // the sheet's room is measured (`fit`): then the whole graph takes that room, never less than MIN_PLOT.
  const H = fit != null ? Math.max(MIN_PLOT + (bottom - dateBand), Math.min(MAX_SVG, fit)) : height + (bottom - dateBand);

  // The axis fits the seven days shown and one beside each (what a swipe of a day reveals): the days
  // drawn further out for a long swipe would stretch it (a cold day four days off once took the
  // axis to 0 and left a third of the graph empty).
  const values = series
    .flatMap((x) => x.points.filter((_, i) => i >= BUFFER - 1 && i <= BUFFER + 7).map((p) => p.v))
    .filter((v): v is number => v != null);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (metric.zero) lo = 0;
  const nothing = metric.emptyNote && !values.some((v) => v > 0);
  // Room for the value labels above the highest point and below the lowest (SHAPE.valueLabel),
  // as a share of the plot's height, so a label is never cut by the frame.
  const labelled = metric.chart === "line" && series.some(({ s }) => s.valueLabel);
  const plotH = H - PAD.top - bottom;
  const room = labelled ? ((hi - lo) * (SHAPE.valueLabel.below + 2)) / Math.max(1, plotH - 2 * (SHAPE.valueLabel.below + 2)) : 0;
  // A little room beyond the values (the labels' room when there are labels); the round ticks widen
  // it further. 12% here as well used to tip the axis a whole step lower (0 to 30 for 7 to 26 ℃).
  const pad = Math.max((hi - lo) * 0.04, metric.unit === "℃" ? 0.5 : 0.25, room);
  if (lo !== 0) lo -= pad;
  hi = metric.max ?? hi + pad;
  // Round ticks, widened to whole steps (a fixed top such as 100% stays).
  const nice = niceTicks(lo, hi, 5);
  if (metric.max == null) hi = nice.hi;
  lo = metric.zero ? Math.max(0, nice.lo) : nice.lo;
  const ticks = nice.ticks.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
  const yOf = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - bottom)) / (hi - lo);
  const shownIndex = scrub ?? BUFFER + 3;
  const shownDay = days[shownIndex];
  const shownPartner = partner(shownDay);

  return (
    <div ref={ref} className="chart">
      {nothing && <p className="chart-note">{metric.emptyNote}</p>}
      {!series.length && (
        <p className="chart-note">
          表示する線がありません。
          <Button kind="quiet" size="sm" onClick={reset}>
            元に戻す
          </Button>
        </p>
      )}
      {metric.forecastOnly && <p className="chart-note">予報の日だけの値です（過去の日にはありません）</p>}
      <GraphReadout
        live={scrub != null}
        unit={metric.unit}
        title={dateLabel(shownDay)}
        // With one row of dates the comparison's year is said here ('25/11/10), not under the graph.
        dates={{ b: shownPartner ? (oneDateRow ? shortDay(shownPartner, shownDay) : monthDay(shownPartner)) : undefined }}
        rows={series
          .filter((x) => !x.compare && !x.s.thin)
          .map(({ s, points }) => {
            const a = points[shownIndex].v;
            const b = pick(s.key, true).points[shownIndex].v;
            const d = digitsOf(s.unit ?? metric.unit);
            return {
              key: s.key,
              label: s.key === "feel" ? (feel.sun ? "肌感（日なた）" : "肌感（日かげ）") : s.label,
              color: COLORS[s.tone],
              // 肌感 is an index, not a temperature (D18): no ℃ on its row.
              ...(s.key === "feel" ? { unit: "" } : {}),
              a: a == null ? "—" : a.toFixed(d),
              b: b == null ? "—" : b.toFixed(d),
              diff: signedDiff(a, b, d),
            };
          })}
        footer={<PartsWeather store={store} station={station} date={shownDay} partner={shownPartner} />}
      />
      {metric.id === "temp" && (
        <div className="chart-look">
          <Segmented
            label="気温の見せ方"
            value={look}
            options={[
              { id: "line", label: "線" },
              { id: "range", label: "幅" },
            ]}
            onChange={setLook}
          />
        </div>
      )}
      <svg width={w} height={H} role="img" aria-label={`${metric.title ?? metric.label}の日別グラフ${range ? "（最高〜最低の幅）" : ""}`}>
        {/* centre day */}
        <defs>
          <ForecastHatch id={`fc-${metric.id}`} />
          <clipPath id={`plot-${metric.id}`}>
            <rect x={frame.left - 4} y={0} width={w - frame.left - PAD.right + 8} height={H} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={frame.left} x2={w - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
            <text x={frame.left - 6} y={yOf(t) + 4} className="chart-tick" textAnchor="end">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {/* The unit once, above the axis. */}
        <text x={2} y={PAD.top - 6} className="chart-unit">
          {metric.unit === "h" ? "時間" : metric.unit}
        </text>

        <g clipPath={`url(#plot-${metric.id})`}>
        <g style={pan.style}>
        {/* Forecast days: hatched behind everything, 予報 over the first of them. */}
        {days.map((d, i) => {
          if (store?.getDay(station, d).row?.type !== "forecast") return null;
          const first = i === 0 || store?.getDay(station, days[i - 1]).row?.type !== "forecast";
          return (
            <g key={`fc-${d}`}>
              <rect x={xOf(i) - step / 2} y={PAD.top} width={step} height={H - PAD.top - bottom} fill={`url(#fc-${metric.id})`} className="chart-forecast" />
              {first && (
                <text x={xOf(i) - step / 2 + 4} y={PAD.top + 10} className="chart-forecast-label">
                  予報
                </text>
              )}
            </g>
          );
        })}
        {spreadOn && !range && <Spread top={pick("max", false).points} low={pick("min", false).points} yOf={yOf} />}
        {range && (
          <RangeBars
            step={step}
            yOf={yOf}
            target={{ max: pick("max", false).points, min: pick("min", false).points, mean: shown("temp") ? pick("temp", false).points : null }}
            compare={{ max: pick("max", true).points, min: pick("min", true).points }}
          />
        )}

        {metric.chart === "bar"
          ? series.map(({ s, compare, points }) =>
              points.map((p, i) =>
                p.v == null ? null : (
                  <path
                    key={`${s.key}-${compare}-${i}`}
                    d={barPath(p.x + (compare ? 1 : -step * 0.32), yOf(p.v), step * 0.3, Math.max(0, yOf(0) - yOf(p.v)))}
                    {...barLook(compare ? "compare" : "target", COLORS[s.tone])}
                  />
                ),
              ),
            )
          : lineSeries.map(({ s, compare, points }) => {
              // The rule (tokens.ts): which day by form, a second series (平均) thinner. One path per
              // unbroken run (a missing day breaks it), so the joins are round and a dash runs on.
              const look = lineLook(compare ? "compare" : "target", COLORS[s.tone], { weight: s.thin ? "minor" : "main" });
              return runsOf(points).map((run, k) => (
                <path
                  key={`${s.key}-${compare}-${k}`}
                  d={run.map((p, i) => `${i ? "L" : "M"}${p.x},${yOf(p.v!)}`).join("")}
                  fill="none"
                  stroke={look.stroke}
                  strokeWidth={look.strokeWidth}
                  strokeDasharray={look.strokeDasharray}
                  strokeLinecap={compare ? "butt" : "round"}
                  strokeLinejoin="round"
                  opacity={look.opacity}
                />
              ));
            })}
        {metric.chart === "line" &&
          lineSeries.filter(({ s }) => !s.thin).map(({ s, compare, points }) =>
            points.map((p, i) =>
              p.v == null ? null : (
                <circle
                  key={`${s.key}-${compare}-dot-${i}`}
                  cx={p.x}
                  cy={yOf(p.v)}
                  r={compare ? 2.5 : 3.2}
                  fill={compare ? "var(--surface-base)" : COLORS[s.tone]}
                  stroke={COLORS[s.tone]}
                  opacity={compare ? 0.75 : 1}
                />
              ),
            ),
          )}
        {metric.chart === "line" && (
          <ValueLabels
            yOf={yOf}
            top={PAD.top}
            bottom={H - bottom}
            items={series
              .filter(({ s, compare }) => !compare && s.valueLabel)
              .map(({ s, points }) => ({
                key: s.key,
                side: s.valueLabel!,
                color: COLORS[s.tone],
                digits: digitsOf(s.unit ?? metric.unit),
                points,
                // In 幅 the 最低 label sits under the bar's round foot (a bar is never shorter than wide).
                // In 幅 the labels stand over the target's bar (left of the day's centre), and the 最低
                // label sits under the bar's round foot (a bar is never shorter than it is wide).
                ...(ranged(s.key) ? { dx: -rangeWidth(step) * SHAPE.range.offset } : {}),
                ...(ranged(s.key) && s.key === "min" ? { floor: pick("max", false).points.map((p) => (p.v == null ? null : yOf(p.v) + rangeWidth(step))) } : {}),
              }))}
          />
        )}

        {under.map((row, k) => (
          <g key={`under-${k}`}>
            {row.cells.map((c, i) => (
              <text key={i} x={xOf(i)} y={H - bottom + 14 + k * UNDER_ROW} textAnchor="middle" className={row.muted ? "chart-spread other" : "chart-spread"}>
                {c}
              </text>
            ))}
          </g>
        ))}

        {days.map((d, i) => (
          <g key={d}>
            <text x={xOf(i)} y={oneDateRow ? H - 9 : H - 24} textAnchor="middle" className={`chart-x tone-${dayTone(d)}`}>
              {+d.slice(5, 7)}/{+d.slice(8)}
            </text>
            {!oneDateRow && (() => {
              // The comparison day each column is compared with (it differs from the target date
              // with 前年同曜日, 前週 or a custom pair).
              const p = partner(d);
              return p ? (
                <text x={xOf(i)} y={H - 9} textAnchor="middle" className={`chart-x partner tone-${dayTone(p)}`}>
                  {+p.slice(5, 7)}/{+p.slice(8)}
                </text>
              ) : null;
            })()}
          </g>
        ))}
        {/* Tap targets: each day's whole column, on top of everything drawn. */}
        {onPickDay &&
          days.map((d, i) => (
            <rect
              key={`hit-${d}`}
              className="chart-hit"
              x={xOf(i) - step / 2}
              y={0}
              width={step}
              height={H}
              onClick={() => !pan.justDragged() && performance.now() - scrubbedAt.current > 350 && onPickDay(d)}
              role="button"
              aria-label={`${+d.slice(5, 7)}月${+d.slice(8)}日の時間帯を見る`}
            />
          ))}
        </g>
        {/* The selected day: a frame fixed in the middle (like the tables' drum) — the days slide
            through it while panning; the background is kept for 予報. */}
        <rect x={xOf(3 + BUFFER) - step / 2 + 1} y={PAD.top - 4} width={step - 2} height={H - PAD.top - bottom + 4} rx={8} className="chart-center" />
        </g>
        {scrub != null && (
          <GuideLines
            x={xOf(scrub)}
            top={PAD.top}
            bottom={H - bottom}
            left={frame.left}
            points={series
              .filter((x) => !x.compare && !x.s.thin)
              .flatMap(({ s, points }) => {
                const v = points[scrub].v;
                return v == null ? [] : [{ y: yOf(v), color: COLORS[s.tone], label: v.toFixed(digitsOf(s.unit ?? metric.unit)) }];
              })}
          />
        )}

        {/* Fixed labels at the left edge (they do not move with the days). */}
        {under.map((row, k) =>
          row.label ? (
            <text key={`ul-${k}`} x={frame.left - 6} y={H - bottom + 14 + k * UNDER_ROW} textAnchor="end" className="chart-spread label">
              {row.label}
            </text>
          ) : null,
        )}
        {!oneDateRow && (
          <>
            <text x={frame.left - 6} y={H - 24} textAnchor="end" className="chart-x-side">
              対象
            </text>
            <text x={frame.left - 6} y={H - 9} textAnchor="end" className="chart-x-side">
              比較
            </text>
          </>
        )}
      </svg>
      {/* Legend in the graph's own marks, on one line: which day (lines, fills or round bars), 予報.
          Everything that explains rather than names (信頼度, what a bar or a number is) is behind ⓘ. */}
      <InfoNote className="chart-key" more={<ChartNotes metric={metric} range={range} spread={spreadOn} feel={shown("feel") && lines.some((s) => s.key === "feel")} mean={shown("temp")} />}>
        <span className="line-legend">
          <span>
            {metric.chart === "bar" ? <BarSample day="target" /> : range ? <RangeSample day="target" /> : <LineSample day="target" />}
            対象日
          </span>
          <span>
            {metric.chart === "bar" ? <BarSample day="compare" /> : range ? <RangeSample day="compare" /> : <LineSample day="compare" />}
            比較日
          </span>
          <span>
            <i className="ls-forecast" />
            予報
          </span>
        </span>
      </InfoNote>
      {(lines.length > 1 || metric.spread) && (
        <div className="chip-row chip-row-scroll" role="group" aria-label="表示する線">
          {/* Line switches: the chip shows the line's colour; off is dimmed. */}
          {lines.filter((s) => !ranged(s.key)).map((s) => (
            <Chip
              key={s.key}
              size="sm"
              on={shown(s.key)}
              tone={COLORS[s.tone]}
              onClick={() => {
                // 肌感: 肌感（日なた） → 肌感（日かげ） → オフ → 肌感（日なた） …
                if (s.key !== "feel" || !onToggleSun) return toggle(s.key);
                if (!shown("feel")) {
                  if (!feel.sun) onToggleSun();
                  toggle("feel");
                } else if (feel.sun) onToggleSun();
                else toggle("feel");
              }}
              label={s.key === "feel" && onToggleSun ? `肌感の線：${!shown("feel") ? "オフ" : feel.sun ? "肌感（日なた）" : "肌感（日かげ）"}（タップで切り替え）` : undefined}
            >
              <i className="dot" style={{ background: COLORS[s.tone] }} />
              {s.key === "feel" ? (feel.sun ? "肌感（日なた）" : "肌感（日かげ）") : s.label}
            </Chip>
          ))}
          {metric.spread && (
            <Chip size="sm" on={spreadOn} tone={COLORS.hot} onClick={() => toggle("spread")}>
              <i className="dot band" />
              {metric.spread}
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}

/** What the graph's marks mean, behind the legend's ⓘ: 信頼度 and the item's own notes. */
function ChartNotes({ metric, range, spread, feel, mean }: { metric: ChartMetric; range: boolean; spread: boolean; feel: boolean; mean: boolean }) {
  const notes = [
    range && `棒は最高（上）から最低（下）まで${mean ? "、白い印は平均" : ""}。`,
    spread && "寒暖差は最高−最低。",
    feel && "肌感は日中・昼・夕方の平均。",
    metric.under?.some((r) => r.key === "probability") && "降水確率は予報の日だけ、雪は降った日だけ。",
    metric.under?.some((r) => r.key === "gust") && "線は平均風速、数字は最大瞬間風速。",
    metric.under?.some((r) => r.key === "sun") && "棒は日射量、数字は日照時間。",
    "予報の日の A・B・C は信頼度（予報の計算のそろい具合）。A がいちばん確か、C は変わりやすい。",
  ].filter(Boolean);
  return (
    <>
      {notes.map((n) => (
        <span key={n as string} className="chart-key-note">
          {n}
        </span>
      ))}
    </>
  );
}

/** The band between the first two series of the target days (max and min): its height is the spread. */
function Spread({ top, low, yOf }: { top: Point[]; low: Point[]; yOf: (v: number) => number }) {
  const runs: Point[][][] = [];
  let run: Point[][] = [];
  top.forEach((p, i) => {
    const q = low[i];
    if (p.v == null || q.v == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push([p, q]);
  });
  if (run.length) runs.push(run);
  return (
    <>
      {runs
        .filter((r) => r.length > 1)
        .map((r, k) => (
          <polygon
            key={k}
            className="chart-spread-band"
            points={[...r.map(([p]) => `${p.x},${yOf(p.v!)}`), ...[...r].reverse().map(([, q]) => `${q.x},${yOf(q.v!)}`)].join(" ")}
          />
        ))}
    </>
  );
}

/** Unbroken runs of a line's points (a missing day breaks the line; it is never bridged). */
function runsOf(points: Point[]): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p.v == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) runs.push(run);
  // A lone day has no line, only its dot.
  return runs.filter((r) => r.length > 1);
}

/** Width of a 幅 bar: a share of a day, at most SHAPE.range.maxWidth. */
const rangeWidth = (step: number) => Math.min(SHAPE.range.maxWidth, step * SHAPE.range.share);

/**
 * The target day's values by its points (design-system.md 4.1): the high side above, the low side
 * below, a line alone above at a peak and below in a dip. A label that would leave the plot goes to
 * the other side. The halo is the face's colour, so a line through a label never cuts its digits.
 */
function ValueLabels({
  items,
  yOf,
  top,
  bottom,
}: {
  items: { key: string; side: "above" | "below" | "auto"; color: string; digits: number; points: Point[]; dx?: number; floor?: (number | null)[] }[];
  yOf: (v: number) => number;
  top: number;
  bottom: number;
}) {
  const { above, below } = SHAPE.valueLabel;
  return (
    <g className="chart-values" aria-hidden>
      {items.flatMap(({ key, side, color, digits, points, dx = 0, floor }) =>
        points.map((p, i) => {
          if (p.v == null) return null;
          const y = yOf(p.v);
          let up = side === "above";
          if (side === "auto") {
            const near = [points[i - 1]?.v, points[i + 1]?.v].filter((v): v is number => v != null);
            up = !near.length || p.v >= near.reduce((a, b) => a + b, 0) / near.length;
          }
          const foot = floor?.[i] != null ? Math.max(y, floor[i]!) : y;
          let base = up ? y - above : foot + below;
          if (up && base - (below - above) < top) base = foot + below;
          else if (!up && base > bottom - 1) base = y - above;
          return (
            <text key={`${key}-${i}`} x={p.x + dx} y={base} textAnchor="middle" className="chart-value" fill={color}>
              {p.v.toFixed(digits)}
            </text>
          );
        }),
      )}
    </g>
  );
}

/**
 * 幅: each day's 最高〜最低 as one rounded bar — the target filled from the 最高 colour down to the
 * 最低 colour, the comparison day outlined beside it — with the target's 平均 as a short white mark.
 * Which day by fill / outline, what by colour (tokens.ts); the round ends lie inside the bar.
 */
function RangeBars({
  step,
  yOf,
  target,
  compare,
}: {
  step: number;
  yOf: (v: number) => number;
  target: { max: Point[]; min: Point[]; mean: Point[] | null };
  compare: { max: Point[]; min: Point[] };
}) {
  const bw = rangeWidth(step);
  const R = SHAPE.range;
  const capsule = (x: number, hi: number, lo: number) => {
    const y = yOf(hi);
    return { x: x - bw / 2, y, width: bw, height: Math.max(bw, yOf(lo) - y), rx: bw / 2 };
  };
  const meanLook = lineLook("target", COLORS.mean, { kind: "reference" });
  return (
    <g className="range-bars">
      <defs>
        <linearGradient id="range-target" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.hot} />
          <stop offset="1" stopColor={COLORS.cold} />
        </linearGradient>
      </defs>
      {target.max.map((p, i) => {
        const tMax = p.v;
        const tMin = target.min[i].v;
        const cMax = compare.max[i].v;
        const cMin = compare.min[i].v;
        // The target left of the day's centre, the comparison right (as the amount bars).
        const xT = p.x - bw * SHAPE.range.offset;
        const xC = p.x + bw * SHAPE.range.offset;
        const mean = target.mean?.[i].v ?? null;
        const c = barLook("compare", COLORS.hot);
        return (
          <g key={i}>
            {cMax != null && cMin != null && <rect {...capsule(xC, cMax, cMin)} fill="none" stroke="url(#range-target)" strokeWidth={R.compareStroke} opacity={c.opacity} />}
            {tMax != null && tMin != null && <rect {...capsule(xT, tMax, tMin)} fill="url(#range-target)" />}
            {mean != null && tMax != null && tMin != null && (
              <line
                x1={xT - bw / 2 - R.meanOverhang}
                x2={xT + bw / 2 + R.meanOverhang}
                y1={yOf(mean)}
                y2={yOf(mean)}
                stroke={meanLook.stroke}
                strokeWidth={R.meanWidth}
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}



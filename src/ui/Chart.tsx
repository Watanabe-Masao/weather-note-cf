// Comparison chart for the seven days around the target day.
// Line style says which day, nothing else: target solid (bars filled), comparison dashed (bars
// outlined) and lighter. Forecast days are a hatched background with 予報 at the top.
// Missing values break the line (never interpolated).

import { usualLightOf } from "../light";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { dayTone } from "../../shared/holidays";
import { type ChartMetric, graphSeries } from "../chartMetrics";
import { DATA } from "../design/tokens";
import { Chip, ForecastHatch, GraphReadout, GuideLines } from "./kit";
import type { WeatherStore } from "../data/store";
import { dateLabel, digitsOf, monthDay, niceTicks, signedDiff, tickLabel } from "../design/format";
import { FeelContext } from "./FeelBar";
import { BetaContext } from "../beta/settings";
import { baselineOf, useBaselineHistory } from "../beta/useBaseline";
import { useDrumPan } from "./useDrumPan";

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
// Bottom: two rows of dates (the target days, then their comparison days).
const PAD = { left: 34, right: 10, top: 14, bottom: 44 };
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

/** Days drawn beyond each edge, so a swipe reveals real data instead of blank space. */
const BUFFER = 4;
/** Hold this long (ms) without moving to scrub instead of panning. */
const LONG_PRESS = 280;

export function Chart({ store, station, target, partner, metric, height = 190, onPickDay, onShiftDays, onToggleSun }: Props) {
  const feel = useContext(FeelContext);
  const beta = useContext(BetaContext);
  const { shown, toggle, reset } = useHidden(metric);
  const spreadOn = !!metric.spread && shown("spread");
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Seven visible days plus a buffer on each side; index BUFFER is the first visible day.
  const days = Array.from({ length: 7 + 2 * BUFFER }, (_, i) => addDays(target, i - 3 - BUFFER));
  // β: the days before each drawn day, for the 最近の基準 line (only while that line is on).
  const wantsBaseline = beta.enabled && metric.series.some((s) => s.history === "baseline") && shown("baseline");
  useBaselineHistory(store, station, wantsBaseline ? [...days, ...days.map(partner)] : [], "chart-baseline");
  const step = (w - PAD.left - PAD.right) / 7;
  const xOf = (i: number) => PAD.left + step * (i - BUFFER + 0.5);
  // Long press (or mouse hover) scrubs: a guide follows the finger and the card above reads that day.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const scrubbedAt = useRef(0);
  const pan = useDrumPan(ref, step, onShiftDays, () => scrubbing.current);
  const dayAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - PAD.left) / step) + BUFFER;
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
  const series = all.filter(({ s }) => shown(s.key));
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
      return a == null || b == null ? "—" : (a - b).toFixed(1);
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
  const bottom = PAD.bottom + (under.length ? under.length * UNDER_ROW + 4 : 0);
  // The rows of numbers add to the height, so the plot keeps its size however many there are.
  const H = height + (bottom - PAD.bottom);

  const values = series.flatMap((x) => x.points.map((p) => p.v)).filter((v): v is number => v != null);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (metric.zero) lo = 0;
  const nothing = metric.emptyNote && !values.some((v) => v > 0);
  const pad = Math.max((hi - lo) * 0.12, metric.unit === "℃" ? 1 : 0.5);
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
          <button className="link" onClick={reset}>
            元に戻す
          </button>
        </p>
      )}
      {metric.forecastOnly && <p className="chart-note">予報の日だけの値です（過去の日にはありません）</p>}
      <GraphReadout
        live={scrub != null}
        unit={metric.unit}
        title={
          <>
            {dateLabel(shownDay)}
            {shownPartner && <small> 比較 {monthDay(shownPartner)}</small>}
          </>
        }
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
      />
      <svg width={w} height={H} role="img" aria-label={`${metric.title ?? metric.label}の日別グラフ`}>
        {/* centre day */}
        <defs>
          <ForecastHatch id={`fc-${metric.id}`} />
          <clipPath id={`plot-${metric.id}`}>
            <rect x={PAD.left - 4} y={0} width={w - PAD.left - PAD.right + 8} height={H} />
          </clipPath>
        </defs>
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
        {spreadOn && <Spread top={pick("max", false).points} low={pick("min", false).points} yOf={yOf} />}

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
                    strokeWidth={s.thin ? (compare ? 1 : 1.4) : compare ? 1.5 : 2.2}
                    strokeDasharray={compare ? "6 4" : undefined}
                    strokeLinecap="round"
                    opacity={compare ? 0.65 : 1}
                  />
                );
              }),
            )}
        {metric.chart === "line" &&
          series.filter(({ s }) => !s.thin).map(({ s, compare, points }) =>
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
            <text x={xOf(i)} y={H - 24} textAnchor="middle" className={`chart-x tone-${dayTone(d)}`}>
              {+d.slice(5, 7)}/{+d.slice(8)}
            </text>
            {(() => {
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
            left={PAD.left}
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
            <text key={`ul-${k}`} x={PAD.left - 6} y={H - bottom + 14 + k * UNDER_ROW} textAnchor="end" className="chart-spread label">
              {row.label}
            </text>
          ) : null,
        )}
        <text x={PAD.left - 6} y={H - 24} textAnchor="end" className="chart-x-side">
          対象
        </text>
        <text x={PAD.left - 6} y={H - 9} textAnchor="end" className="chart-x-side">
          比較
        </text>
      </svg>
      {/* Legend in the graph's own marks: lines for line graphs, fills and outlines for bars. */}
      {metric.chart === "bar" ? (
        <p className="line-legend">
          <span>
            <i className="ls-fill" />
            対象日
          </span>
          <span>
            <i className="ls-outline" />
            比較日
          </span>
          <span>
            <i className="ls-forecast" />
            予報
          </span>
          <span title="予報の計算のそろい具合。A がいちばん確か、C は変わりやすい">
            <b className="conf">A</b>
            <b className="conf">B</b>
            <b className="conf conf-C">C</b>
            信頼度
          </span>
        </p>
      ) : (
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
          <span title="予報の計算のそろい具合。A がいちばん確か、C は変わりやすい">
            <b className="conf">A</b>
            <b className="conf">B</b>
            <b className="conf conf-C">C</b>
            信頼度
          </span>
        </p>
      )}
      {(lines.length > 1 || metric.spread) && (
        <div className="chip-row" role="group" aria-label="表示する線">
          {/* Line switches: the chip shows the line's colour; off is dimmed. */}
          {lines.map((s) => (
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
      {/* One note per item; the row order is always 上＝対象日・下＝比較日. */}
      {spreadOn && <p className="chart-note">寒暖差は最高−最低（上が対象日、下が比較日）。肌感は日中・昼・夕方の平均。</p>}
      {metric.under?.some((r) => r.key === "probability") && <p className="chart-note">降水確率は予報の日だけ。雪は降った日だけ表示（上が対象日、下が比較日）。</p>}
      {metric.under?.some((r) => r.key === "gust") && <p className="chart-note">線は平均風速、数字は最大瞬間風速（上が対象日、下が比較日）。</p>}
      {metric.under?.some((r) => r.key === "sun") && <p className="chart-note">棒は日射量（暖める力）、数字は日照時間（上が対象日、下が比較日）。</p>}
      {!spreadOn && shown("feel") && lines.some((s) => s.key === "feel") && <p className="chart-note">肌感は日中・昼・夕方の平均</p>}
    </div>
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

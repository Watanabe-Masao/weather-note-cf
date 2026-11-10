// Comparison chart for the seven days around the target day.
// Target: solid where observed, dotted where forecast. Comparison: dashed and lighter.
// Missing values break the line (never interpolated).

import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { dayTone } from "../../shared/holidays";
import { type ChartMetric, graphSeries } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { formatValue } from "../metrics";
import { FeelContext } from "./FeelBar";

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

const COLORS = { hot: "#f08b7d", cold: "#6fb3f2", rain: "#6fb3f2", plain: "#9fd3c7", feel: "#c9a3f5" } as const;
const HIDDEN_KEY = "weather-note:chart-hidden";
const PAD = { left: 34, right: 10, top: 14, bottom: 30 };
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

export function Chart({ store, station, target, partner, metric, height = 190 }: Props) {
  const H = height;
  const feel = useContext(FeelContext);
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

  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => addDays(target, n));
  const step = (w - PAD.left - PAD.right) / days.length;
  const xOf = (i: number) => PAD.left + step * (i + 0.5);

  const read = (date: string | null, s: ChartMetric["series"][number]): { v: number | null; forecast: boolean } => {
    if (!date) return { v: null, forecast: false };
    const day = store?.getDay(station, date);
    const hours = store?.getHours(station, date).rows ?? null;
    return { v: s.value(day?.row, hours, feel), forecast: day?.row?.type === "forecast" };
  };

  const lines = graphSeries(metric);
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
    under.push({ label: "差", cells: days.map((_, i) => gap(false, i)) }, { label: "", cells: days.map((_, i) => gap(true, i)), muted: true });
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

  const values = series.flatMap((x) => x.points.map((p) => p.v)).filter((v): v is number => v != null);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (metric.zero) lo = 0;
  const nothing = metric.emptyNote && !values.some((v) => v > 0);
  const pad = Math.max((hi - lo) * 0.12, metric.unit === "℃" ? 1 : 0.5);
  if (lo !== 0) lo -= pad;
  hi = metric.max ?? hi + pad;
  const yOf = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - bottom)) / (hi - lo);
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);

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
      <svg width={w} height={H} role="img" aria-label={`${metric.label}の比較グラフ`}>
        {/* centre day */}
        <rect x={xOf(3) - step / 2} y={PAD.top - 6} width={step} height={H - PAD.top - bottom + 6} className="chart-center" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
            <text x={PAD.left - 6} y={yOf(t) + 4} className="chart-tick" textAnchor="end">
              {formatValue(t, metric.unit)}
            </text>
          </g>
        ))}

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
                    strokeWidth={s.thin ? (compare ? 1 : 1.4) : compare ? 1.5 : 2.2}
                    strokeDasharray={compare ? "6 4" : p.forecast ? "2 4" : undefined}
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
                  fill={compare ? "var(--bg)" : COLORS[s.tone]}
                  stroke={COLORS[s.tone]}
                  opacity={compare ? 0.75 : 1}
                />
              ),
            ),
          )}

        {under.map((row, k) => (
          <g key={`under-${k}`}>
            {row.label && (
              <text x={PAD.left - 6} y={H - bottom + 14 + k * UNDER_ROW} textAnchor="end" className="chart-spread label">
                {row.label}
              </text>
            )}
            {row.cells.map((c, i) => (
              <text key={i} x={xOf(i)} y={H - bottom + 14 + k * UNDER_ROW} textAnchor="middle" className={row.muted ? "chart-spread other" : "chart-spread"}>
                {c}
              </text>
            ))}
          </g>
        ))}

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
      </div>
      {(lines.length > 1 || metric.spread) && (
        <div className="chart-toggles" role="group" aria-label="表示する線">
          {lines.map((s) => (
            <button
              key={s.key}
              className={shown(s.key) ? "on" : ""}
              aria-pressed={shown(s.key)}
              style={{ color: COLORS[s.tone] }}
              onClick={() => toggle(s.key)}
            >
              <i style={{ background: COLORS[s.tone] }} />
              {s.key === "feel" ? (feel.sun ? "肌感（日なた）" : "肌感（日かげ）") : s.label}
            </button>
          ))}
          {metric.spread && (
            <button className={spreadOn ? "on" : ""} aria-pressed={spreadOn} onClick={() => toggle("spread")}>
              <i className="band" />差（{metric.spread}）
            </button>
          )}
        </div>
      )}
      {spreadOn && <p className="chart-note">差の数字は 上：対象日／下：比較日。肌感は日中・昼・夕方の平均</p>}
      {metric.under?.some((r) => r.key === "probability") && <p className="chart-note">確率は予報の日だけ。雪は降った日だけ印（上：対象日／下：比較日）</p>}
      {metric.under?.some((r) => r.key === "gust") && <p className="chart-note">線は平均風速、数字は最大瞬間風速（上：対象日／下：比較日）</p>}
      {metric.under?.some((r) => r.key === "sun") && <p className="chart-note">棒は日射量（暖める力）、数字は日照時間（上：対象日／下：比較日）</p>}
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

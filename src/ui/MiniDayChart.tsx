// A small graph of a day's hours for その日の要約 (#176): the temperature of the day (solid) and of its
// comparison day (dashed), and the rain of the day as bars at the foot — the same rules as every graph
// (tokens.ts lineLook / barLook / barPath), only smaller and without touch. The 0–24 hours run left
// to right, as in the time-band graph.

import { useLayoutEffect, useRef, useState } from "react";
import type { WeatherRow } from "../../shared/types";
import { barLook, barPath, DATA, lineLook } from "../design/tokens";
import { niceTicks, num, tickLabel } from "../design/format";

const H = 110;
const PAD = { left: 26, right: 6, top: 8, bottom: 22 };
/** The rain bars' share of the plot's height at RAIN_TOP mm (heavier rain reaches the top of that strip). */
const RAIN_STRIP = 0.32;
const RAIN_TOP = 5;
const HOURS = [0, 6, 12, 18, 24];

type Point = { n: number; v: number | null };
const series = (rows: WeatherRow[] | null, key: string): Point[] =>
  Array.from({ length: 24 }, (_, i) => ({ n: i + 1, v: num(rows?.find((r) => r.n === i + 1)?.[key]) }));

/** One path per unbroken run (a missing hour breaks the line). */
function runs(points: Point[]): Point[][] {
  const out: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p.v == null) {
      if (run.length > 1) out.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length > 1) out.push(run);
  return out;
}

export function MiniDayChart({ rows, otherRows, label }: { rows: WeatherRow[] | null; otherRows: WeatherRow[] | null; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const temp = series(rows, "temp");
  const tempB = series(otherRows, "temp");
  const rain = series(rows, "rain");
  const rainB = series(otherRows, "rain");
  const values = [...temp, ...tempB].map((p) => p.v).filter((v): v is number => v != null);
  if (!values.length) return <div ref={ref} className="mini-day" />;
  const nice = niceTicks(Math.min(...values), Math.max(...values), 3);
  const plotW = w - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  // Hour n is the value at n o'clock (JMA): its point at n on the 0–24 axis.
  const xOf = (h: number) => PAD.left + (h / 24) * plotW;
  const yOf = (v: number) => PAD.top + ((nice.hi - v) / (nice.hi - nice.lo)) * plotH;
  const foot = PAD.top + plotH;
  const rainH = (mm: number) => Math.min(1, mm / RAIN_TOP) * plotH * RAIN_STRIP;
  const step = plotW / 24;
  const line = (points: Point[], day: "target" | "compare") => {
    const look = lineLook(day, DATA.temp);
    return runs(points).map((r) => (
      <path
        key={`${day}-${r[0].n}`}
        d={r.map((p, i) => `${i ? "L" : "M"}${xOf(p.n)},${yOf(p.v!)}`).join("")}
        fill="none"
        stroke={look.stroke}
        strokeWidth={look.strokeWidth}
        strokeDasharray={look.strokeDasharray}
        strokeLinecap={look.strokeDasharray ? "butt" : "round"}
        strokeLinejoin="round"
        opacity={look.opacity}
      />
    ));
  };
  return (
    <div ref={ref} className="mini-day">
      <svg width={w} height={H} role="img" aria-label={label}>
        {nice.ticks
          .filter((t) => t >= nice.lo && t <= nice.hi)
          .map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
              <text x={PAD.left - 4} y={yOf(t) + 4} className="chart-tick" textAnchor="end">
                {tickLabel(t)}
              </text>
            </g>
          ))}
        {/* The hour n covers n−1 to n: its bars stand over that hour, the day's filled on the left,
            the comparison day's outlined on the right (as every bar graph). */}
        {[
          { points: rain, day: "target" as const, dx: 0.08 },
          { points: rainB, day: "compare" as const, dx: 0.5 },
        ].map(({ points, day, dx }) =>
          points.map((p) =>
            p.v != null && p.v > 0 ? <path key={`rain-${day}-${p.n}`} d={barPath(xOf(p.n - 1) + step * dx, foot - rainH(p.v), step * 0.42, rainH(p.v))} {...barLook(day, DATA.rain)} /> : null,
          ),
        )}
        {line(tempB, "compare")}
        {line(temp, "target")}
        {HOURS.map((h) => (
          <text key={h} x={xOf(h)} y={H - 3} className="chart-tick" textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}>
            {h}
          </text>
        ))}
      </svg>
    </div>
  );
}

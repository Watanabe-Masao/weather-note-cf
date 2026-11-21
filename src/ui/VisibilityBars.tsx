// 視程の比べ（2026-11-21 渡辺さん「比較は横の棒グラフも」）：見通しの距離を、0〜20 km の物差しに横の棒で。
// 選んだ日と比べる日を、最小（いちばん見通しの悪かった時間）と平均で並べる。20 km は視程計の上限（それより遠くも 20）。

import type { WeatherStore } from "../data/store";
import { hourlyExtreme, hourlyMean } from "../chartMetrics";
import { shortDate } from "./HourCompare";

const TOP = 20;

export function VisibilityBars({ store, station, date, other }: { store: WeatherStore | null; station: string; date: string; other: string | null }) {
  const hours = (d: string | null) => (d ? (store?.getHours(station, d).rows ?? null) : null);
  const rows = [
    { key: "min", label: "最小", a: hourlyExtreme(hours(date), "visibility", "min"), b: hourlyExtreme(hours(other), "visibility", "min") },
    { key: "mean", label: "平均", a: hourlyMean(hours(date), "visibility"), b: hourlyMean(hours(other), "visibility") },
  ];
  const bar = (v: number | null, side: "a" | "b") => (
    <span className={`vb-track vb-${side}`}>
      {v != null && <span className="vb-fill" style={{ width: `${Math.max(2, (Math.min(TOP, v) / TOP) * 100)}%` }} />}
      <span className="vb-num">{v == null ? "—" : `${v.toFixed(1)}${v >= TOP ? "+" : ""}`}</span>
    </span>
  );
  return (
    <div className="vb" role="group" aria-label="視程の比べ（km）">
      <p className="vb-legend">
        <span className="vb-key vb-a">{shortDate(date)}</span>
        {other && <span className="vb-key vb-b">{shortDate(other)}</span>}
        <span className="vb-scale">0〜20 km（20 は「20 km 以上」）</span>
      </p>
      {rows.map((r) => (
        <div className="vb-row" key={r.key}>
          <span className="vb-label">{r.label}</span>
          <span className="vb-bars">
            {bar(r.a, "a")}
            {other && bar(r.b, "b")}
          </span>
        </div>
      ))}
    </div>
  );
}

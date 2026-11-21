// 視程の比べ（2026-11-21・22 渡辺さん「前年との比較で、最小と最大が横棒のグラフで見たらわかりやすい」）：
// 0〜20 km の物差しに、その日の最小から最大までを横の棒で。選んだ日と比べる日（前年同日など）を上下に並べ、
// 平均は棒の上の印。20 km は視程計の上限（それより遠くも 20）。

import type { WeatherStore } from "../data/store";
import { hourlyExtreme, hourlyMean } from "../chartMetrics";
import { shortDate } from "./HourCompare";

const TOP = 20;
const pct = (v: number) => `${(Math.min(TOP, Math.max(0, v)) / TOP) * 100}%`;
const km = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}${v >= TOP ? "+" : ""}`);

export function VisibilityBars({ store, station, date, other }: { store: WeatherStore | null; station: string; date: string; other: string | null }) {
  const day = (d: string) => {
    const h = store?.getHours(station, d).rows ?? null;
    return { d, min: hourlyExtreme(h, "visibility", "min"), max: hourlyExtreme(h, "visibility", "max"), mean: hourlyMean(h, "visibility") };
  };
  const rows = [{ ...day(date), side: "a" as const }, ...(other ? [{ ...day(other), side: "b" as const }] : [])];
  return (
    <div className="vb" role="group" aria-label="視程の比べ（最小から最大、km）">
      <p className="vb-legend">
        <span>最小〜最大（km）</span>
        <span className="vb-mean-key">平均</span>
        <span className="vb-scale">20 は「20 km 以上」</span>
      </p>
      {rows.map((r) => (
        <div className={`vb-row vb-${r.side}`} key={r.side} aria-label={`${shortDate(r.d)} 最小 ${km(r.min)}、最大 ${km(r.max)}、平均 ${km(r.mean)}`}>
          <span className="vb-label">{shortDate(r.d)}</span>
          <span className="vb-track">
            {r.min != null && r.max != null && <span className="vb-fill" style={{ left: pct(r.min), right: `calc(100% - ${pct(r.max)})` }} />}
            {r.mean != null && <span className="vb-mean" style={{ left: pct(r.mean) }} />}
          </span>
          <span className="vb-num">
            {km(r.min)}〜{km(r.max)}
          </span>
        </div>
      ))}
      <p className="vb-axis" aria-hidden>
        <span>0</span>
        <span>5</span>
        <span>10</span>
        <span>15</span>
        <span>20</span>
      </p>
    </div>
  );
}

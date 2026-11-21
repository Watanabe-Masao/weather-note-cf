// 視程の比べ（2026-11-21・22 渡辺さん「前年との比較で、最小と最大が横棒のグラフで見たらわかりやすい」）：
// 0〜20 km の物差しに、その日の最小から最大までを横の棒で。選んだ日と比べる日（前年同日など）を上下に並べ、
// 中央値（その日のふつうの見通し）は棒の上の印。20 km は視程計の上限（それより遠くも 20）。

import type { WeatherStore } from "../data/store";
import { hourlyExtreme, hourlyMedian } from "../chartMetrics";
import { shortDate } from "./HourCompare";

const TOP = 20;
/**
 * 見え方の目安（2026-11-22 渡辺さん「良好とかよく見えるとか」）。区切りは気象庁の予報用語：霧は視程 1 km 未満、
 * もや・煙霧は 10 km 未満。20 km は視程計の上限（それ以上はまとめて 20）。
 */
export const VIS_GUIDE = [
  { from: 0, to: 1, name: "霧" },
  { from: 1, to: 10, name: "かすむ" },
  { from: 10, to: 20, name: "よく見える" },
] as const;
export const visGuideOf = (v: number | null) => (v == null ? null : v >= TOP ? "良好" : (VIS_GUIDE.find((g) => v < g.to)?.name ?? "良好"));
const pct = (v: number) => `${(Math.min(TOP, Math.max(0, v)) / TOP) * 100}%`;
const km = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}${v >= TOP ? "+" : ""}`);

export function VisibilityBars({ store, station, date, other }: { store: WeatherStore | null; station: string; date: string; other: string | null }) {
  const day = (d: string) => {
    const h = store?.getHours(station, d).rows ?? null;
    return { d, min: hourlyExtreme(h, "visibility", "min"), max: hourlyExtreme(h, "visibility", "max"), mean: hourlyMedian(h, "visibility") };
  };
  const rows = [{ ...day(date), side: "a" as const }, ...(other ? [{ ...day(other), side: "b" as const }] : [])];
  return (
    <div className="vb" role="group" aria-label="視程の比べ（最小から最大、km）">
      <p className="vb-legend">
        <span>最小〜最大（km）</span>
        <span className="vb-mean-key">中央値</span>
        <span className="vb-scale">20 は「20 km 以上」</span>
      </p>
      {rows.map((r) => (
        <div className={`vb-row vb-${r.side}`} key={r.side} aria-label={`${shortDate(r.d)} 最小 ${km(r.min)}、最大 ${km(r.max)}、中央値 ${km(r.mean)}`}>
          <span className="vb-label">{shortDate(r.d)}</span>
          <span className="vb-track">
            {/* 目安の区切り（1 km・10 km）の細い線 */}
            <span className="vb-tick" style={{ left: pct(1) }} />
            <span className="vb-tick" style={{ left: pct(10) }} />
            {r.min != null && r.max != null && <span className="vb-fill" style={{ left: pct(r.min), right: `calc(100% - ${pct(r.max)})` }} />}
            {r.mean != null && <span className="vb-mean" style={{ left: pct(r.mean) }} />}
          </span>
          <span className="vb-num">
            {km(r.min)}〜{km(r.max)}
            <small className="vb-word">{visGuideOf(r.min) && visGuideOf(r.min) !== visGuideOf(r.max) ? `${visGuideOf(r.min)}〜${visGuideOf(r.max)}` : (visGuideOf(r.max) ?? "")}</small>
          </span>
        </div>
      ))}
      <p className="vb-guide" aria-hidden>
        {/* 霧（1 km 未満）は物差しの 5% と狭いので、帯の名前は出さない（右の言葉と区切りの線で分かる） */}
        {VIS_GUIDE.filter((g) => g.to - g.from >= 5).map((g) => (
          <span key={g.name} style={{ left: pct(g.from), width: `calc(${pct(g.to)} - ${pct(g.from)})` }}>
            {g.name}
          </span>
        ))}
        <span className="vb-guide-top">良好</span>
      </p>
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

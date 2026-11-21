// 風向の比べ（2026-11-22）：選んだ日と比べる日（前年同日など）の16方位の風配図。花びらの長さはその方位から
// 吹いた時間の数（2日で同じ物差し）。下に、最頻の方位・向きのまとまり（平均合成ベクトル長 R）・静穏の時間。
// 円周平均の向きは、R が十分なとき（0.4 以上）だけ細い針で。

import { SECTORS, sectorOf, steadiness, windSummary } from "../../shared/windDirection";
import type { WeatherStore } from "../data/store";
import { shortDate } from "./HourCompare";

const R0 = 6;
const R1 = 44;

export function WindRose({ store, station, date, other }: { store: WeatherStore | null; station: string; date: string; other: string | null }) {
  const sum = (d: string) => windSummary(store?.getHours(station, d).rows ?? []);
  const days = [{ d: date, s: sum(date), side: "a" as const }, ...(other ? [{ d: other, s: sum(other), side: "b" as const }] : [])];
  const top = Math.max(1, ...days.flatMap((x) => x.s.counts));
  return (
    <div className="wr" role="group" aria-label="風向の比べ（16方位）">
      {days.map(({ d, s, side }) => (
        <figure className={`wr-day wr-${side}`} key={side} aria-label={`${shortDate(d)} 最も多い風向 ${s.mode == null ? "定まらない" : SECTORS[s.mode]}、静穏 ${s.calm}時間`}>
          <svg viewBox="-50 -50 100 100" className="wr-rose" aria-hidden>
            <circle r={R1} className="wr-ring" />
            <circle r={R1 / 2} className="wr-ring" />
            {s.counts.map((c, i) => {
              if (!c) return null;
              const a = ((i * 22.5 - 90) * Math.PI) / 180;
              const half = (9 * Math.PI) / 180;
              const len = R0 + (R1 - R0) * (c / top);
              const p = (ang: number, r: number) => `${(Math.cos(ang) * r).toFixed(2)},${(Math.sin(ang) * r).toFixed(2)}`;
              return <path key={i} className={i === s.mode ? "wr-petal wr-top" : "wr-petal"} d={`M${p(a - half, R0)} L${p(a - half, len)} A${len},${len} 0 0 1 ${p(a + half, len)} L${p(a + half, R0)} Z`} />;
            })}
            {s.mean != null && (s.r ?? 0) >= 0.4 && <line className="wr-mean" x1={0} y1={0} x2={Math.sin((s.mean * Math.PI) / 180) * R1} y2={-Math.cos((s.mean * Math.PI) / 180) * R1} />}
            <text y={2} className="wr-calm">{s.calm ? `静${s.calm}` : ""}</text>
            <text y={-R1 - 1} className="wr-n">北</text>
          </svg>
          <figcaption>
            <b>{shortDate(d)}</b>
            <span>
              主な風向 <strong>{s.mode == null ? (s.n ? "定まらない" : "—") : SECTORS[s.mode]}</strong>
            </span>
            <span>
              まとまり {s.r == null ? "—" : `${s.r.toFixed(2)}（${steadiness(s.r)}）`}
            </span>
            <span>
              {s.mean != null && (s.r ?? 0) >= 0.4 ? `平均の向き ${SECTORS[sectorOf(s.mean)]}（${s.mean}°）・` : ""}静穏 {s.calm}時間
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

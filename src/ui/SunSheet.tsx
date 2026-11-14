// 太陽 (#151): opened from the sun strip under the hour graph. The sun's height through the day
// against the horizon and the three twilights, and the times they begin and end.

import { clockOf, dayEdges, altitudeCurve, twilights, TWILIGHTS } from "../../shared/dayParts";
import { hourOfDay, type SunTimes } from "../data/sun";
import { dateLabel } from "../design/format";
import { ModalSheet } from "./ModalSheet";

const W = 340;
const H = 230;
const PAD = { left: 30, right: 8, top: 10, bottom: 20 };

export function SunSheet({ date, station, sun, hour, onClose }: { date: string; station: string; sun: SunTimes | null; hour: number | null; onClose: () => void }) {
  const e = dayEdges(date, station);
  const t = twilights(date, station);
  const curve = altitudeCurve(date, station, 10);
  // Sunrise and sunset from the sun API when known (as on the graph), else calculated.
  const rise = (hourOfDay(sun?.sunrise ?? null) ?? e.rise / 60) * 60;
  const set = (hourOfDay(sun?.sunset ?? null) ?? e.set / 60) * 60;
  const high = Math.max(30, Math.ceil((e.noonAltitude + 8) / 10) * 10);
  const x = (min: number) => PAD.left + (min / 1440) * (W - PAD.left - PAD.right);
  // Above the horizon the axis is even (half the height); below it, it eases off smoothly
  // (1 − e^(−depth/25°)) so the three twilights near the horizon get room and the deep night less.
  const ph = H - PAD.top - PAD.bottom;
  const below = (depth: number) => (1 - Math.exp(-depth / 25)) / (1 - Math.exp(-90 / 25));
  const y = (deg: number) => {
    const d = Math.min(high, deg);
    const f = d >= 0 ? (1 - d / high) * 0.5 : 0.5 + below(-d) * 0.5;
    return PAD.top + f * ph;
  };
  const path = curve.map((p, i) => `${i ? "L" : "M"}${x(p.min).toFixed(1)},${y(p.deg).toFixed(1)}`).join(" ");
  const dayPath = curve.filter((p) => p.deg >= 0).map((p, i) => `${i ? "L" : "M"}${x(p.min).toFixed(1)},${y(p.deg).toFixed(1)}`).join(" ");
  // Bands across the day, darkest at night: 天文 → 航海 → 市民 → 昼 and back.
  const edges = [0, t.astronomical.start, t.nautical.start, t.civil.start, rise, set, t.civil.end, t.nautical.end, t.astronomical.end, 1440].map((m) => m ?? 0);
  const kinds = ["night", "astronomical", "nautical", "civil", "day", "civil", "nautical", "astronomical", "night"];
  const at = hour != null ? hour * 60 : null;
  const altAt = at != null ? curve.reduce((a, p) => (Math.abs(p.min - at) < Math.abs(a.min - at) ? p : a)).deg : null;
  const length = set - rise;
  const rows: { label: string; time: number | null; strong?: boolean; note?: string }[] = [
    { label: "天文薄明 始まり", time: t.astronomical.start },
    { label: "航海薄明 始まり", time: t.nautical.start },
    { label: "市民薄明 始まり", time: t.civil.start },
    { label: "日の出", time: rise, strong: true },
    { label: "南中", time: e.noon, strong: true, note: `高さ ${Math.round(e.noonAltitude)}°` },
    { label: "日の入り", time: set, strong: true },
    { label: "市民薄明 終わり", time: t.civil.end },
    { label: "航海薄明 終わり", time: t.nautical.end },
    { label: "天文薄明 終わり", time: t.astronomical.end },
  ];

  return (
    <ModalSheet title={`太陽　${dateLabel(date)}`} onClose={onClose} className="sun-sheet">
      <svg className="sun-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="一日の太陽の高さと薄明">
        {kinds.map((k, i) => (
          <rect key={i} x={x(edges[i])} width={Math.max(0, x(edges[i + 1]) - x(edges[i]))} y={PAD.top} height={H - PAD.top - PAD.bottom} className={`sun-band ${k}`} />
        ))}
        {[0, ...TWILIGHTS.map((tw) => tw.deg)].map((d) => (
          <g key={d}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(d)} y2={y(d)} className={d === 0 ? "sun-horizon" : "sun-depth"} />
            <text x={PAD.left - 4} y={y(d) + 3.5} textAnchor="end" className="sun-tick">
              {d === 0 ? "0°" : `${d}°`}
            </text>
          </g>
        ))}
        <text x={PAD.left - 4} y={y(high) + 8} textAnchor="end" className="sun-tick">
          {high}°
        </text>
        <path d={path} className="sun-curve" />
        {dayPath && <path d={dayPath} className="sun-curve day" />}
        {at != null && altAt != null && (
          <g>
            <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} className="sun-cursor" />
            <circle cx={x(at)} cy={y(altAt)} r={4.5} className={altAt >= 0 ? "sun-dot day" : "sun-dot"} />
          </g>
        )}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h * 60)} y={H - 5} textAnchor={h === 24 ? "end" : "middle"} className="sun-tick">
            {h}時
          </text>
        ))}
      </svg>
      {at != null && altAt != null && (
        <p className="sun-now">
          {hour}時の太陽：{altAt >= 0 ? `地平線の上 ${Math.round(altAt)}°` : `地平線の下 ${Math.round(-altAt)}°`}
          <small>地平線の下は、薄明が見やすいように広げて描いています</small>
        </p>
      )}

      <dl className="sun-times">
        {rows.map((r) => (
          <div key={r.label} className={r.strong ? "strong" : undefined}>
            <dt>{r.label}</dt>
            <dd>
              {r.note && <small>{r.note}</small>}
              {r.time == null ? "—" : clockOf(r.time)}
            </dd>
          </div>
        ))}
        <div className="total">
          <dt>昼の長さ（日の出〜日の入り）</dt>
          <dd>
            {Math.floor(length / 60)}時間{String(Math.round(length % 60)).padStart(2, "0")}分
          </dd>
        </div>
      </dl>

      <ul className="sun-notes">
        {TWILIGHTS.map((tw) => (
          <li key={tw.id}>
            <i className={`sun-swatch ${tw.id}`} />
            <b>{tw.label}</b>（太陽が地平線の下 {-tw.deg - 6}〜{-tw.deg}°）：{tw.note}
          </li>
        ))}
      </ul>
    </ModalSheet>
  );
}

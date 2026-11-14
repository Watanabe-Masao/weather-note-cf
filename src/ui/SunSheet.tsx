// 太陽 (#151): opened from the sun strip under the hour graph. The sun's height through the day
// against the horizon and the three twilights, and the times they begin and end.

import { clockOf, dayEdges, altitudeCurve, twilights, TWILIGHTS } from "../../shared/dayParts";
import { hourOfDay, type SunTimes } from "../data/sun";
import { dateLabel } from "../design/format";
import { skyAt } from "../../shared/sky";
import { ModalSheet } from "./ModalSheet";
import { useRef, useState, type PointerEvent } from "react";

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
  // The moment read out, in 10-minute steps: starts at the graph's hour, moved by swiping the
  // chart or the slider under it.
  const [at, setAt] = useState(() => (hour != null ? hour * 60 : Math.round(e.noon / 10) * 10));
  const altAt = curve.reduce((a, p) => (Math.abs(p.min - at) < Math.abs(a.min - at) ? p : a)).deg;
  const phase = altAt >= 0 ? "昼" : altAt >= -6 ? "市民薄明" : altAt >= -12 ? "航海薄明" : altAt >= -18 ? "天文薄明" : "夜";
  const skyNow = skyAt(altAt, 1, 0, at > 720);
  const svg = useRef<SVGSVGElement>(null);
  const scrubbing = useRef(false);
  const pick = (ev: PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const sx = ((ev.clientX - box.left) / box.width) * W;
    const m = ((sx - PAD.left) / (W - PAD.left - PAD.right)) * 1440;
    setAt(Math.min(1430, Math.max(0, Math.round(m / 10) * 10)));
  };
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
      <svg
        ref={svg}
        className="sun-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="一日の太陽の高さと薄明。左右になぞると10分ごとに読めます"
        onPointerDown={(ev) => {
          ev.stopPropagation();
          scrubbing.current = true;
          (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
          pick(ev);
        }}
        onPointerMove={(ev) => scrubbing.current && pick(ev)}
        onPointerUp={() => (scrubbing.current = false)}
        onPointerCancel={() => (scrubbing.current = false)}
      >
        {/* The ground is the sky itself on a clear day, every 10 minutes (shared/sky.ts, as in 明るさと空):
            above the horizon the colour overhead, below it the colour low over the land. */}
        {curve.slice(0, -1).map((p) => {
          const c = skyAt(p.deg, 1, 0, p.min > 720);
          const x0 = x(p.min);
          const x1 = x(p.min + 10) + 0.4;
          return (
            <g key={p.min}>
              <rect x={x0} width={x1 - x0} y={PAD.top} height={y(0) - PAD.top} fill={c.zenith} />
              <rect x={x0} width={x1 - x0} y={y(0)} height={H - PAD.bottom - y(0)} fill={c.horizon} />
            </g>
          );
        })}
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
        {/* Where the sun crosses 0°, −6°, −12°, −18°: a dot on the curve, morning and evening. */}
        {[rise, set, t.civil.start, t.civil.end, t.nautical.start, t.nautical.end, t.astronomical.start, t.astronomical.end].map((m, i) =>
          m == null ? null : <circle key={i} cx={x(m)} cy={y(i < 2 ? 0 : TWILIGHTS[Math.floor((i - 2) / 2)].deg)} r={i < 2 ? 3.5 : 2.6} className={i < 2 ? "sun-mark rise" : "sun-mark"} />,
        )}
        <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} className="sun-cursor" />
        <circle cx={x(at)} cy={y(altAt)} r={5} className={altAt >= 0 ? "sun-dot day" : "sun-dot"} />
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h * 60)} y={H - 5} textAnchor={h === 24 ? "end" : "middle"} className="sun-tick">
            {h}時
          </text>
        ))}
      </svg>
      <input
        className="sun-slider"
        type="range"
        min={0}
        max={1430}
        step={10}
        value={at}
        aria-label="時刻（10分ごと）"
        aria-valuetext={`${clockOf(at)} ${phase}`}
        onChange={(ev) => setAt(+ev.target.value)}
        onPointerDown={(ev) => ev.stopPropagation()}
      />
      {/* The moment: its time, which part of the day, the sun's height, and the sky's colour then. */}
      <div className="sun-now">
        <i className="sun-now-sky" style={{ background: `linear-gradient(${skyNow.zenith}, ${skyNow.horizon})` }} />
        <b className="sun-now-time">{clockOf(at)}</b>
        <span className="sun-now-phase">{phase}</span>
        <span className="sun-now-alt">{altAt >= 0 ? `地平線の上 ${Math.round(altAt)}°` : `地平線の下 ${Math.round(-altAt)}°`}</span>
      </div>
      <p className="sun-note">左右になぞると10分ごとに動きます。地平線の下は、薄明が見やすいように広げて描いています。</p>

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
            {/* The sky low over the land in the middle of this twilight (a clear evening). */}
            <i className="sun-swatch" style={{ background: skyAt(tw.deg + 3, 1, 0, true).horizon }} />
            <b>{tw.label}</b>（太陽が地平線の下 {-tw.deg - 6}〜{-tw.deg}°）：{tw.note}
          </li>
        ))}
      </ul>
    </ModalSheet>
  );
}

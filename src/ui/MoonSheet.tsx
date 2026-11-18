// 月のこよみ（2026-11-19 渡辺さん「月の情報ページ」）：太陽と月のシートから開く。上に選んだ日の月（形の絵・形の名前・
// 月齢・明るい部分・距離と見かけの大きさ・月の出／南中／月の入り）、下にその月のカレンダー（日ごとの形。月齢は押した日の上の欄で）と、同じ枠で替わる満ち欠けと見かけの大きさのグラフ、
// いちばん下に次の新月・上弦・満月・下弦。日を押すとその日の月に替わる。計算は shared/moon.ts（Astronomy Engine、
// 国立天文台の暦で確かめ済み）。時刻は正午の値（月齢・形）と、その日の出入り。1画面に収める。
import { type PointerEvent, useMemo, useRef, useState } from "react";
import { daysOfMonth, monthOf } from "../../shared/dates";
import { clockOf } from "../../shared/dayParts";
import { moonDistance, moonPhase, moonQuarters, moonShapeName, moonTimes, QUARTER_NAME } from "../../shared/moon";
import { DEFAULT_LAT_LON, stationLatLon } from "../../shared/sunTimes";
import { dateLabel } from "../design/format";
import { Glyph, IconButton, Segmented } from "./kit";
import { ICON } from "../design/tokens";
import { svgTextSize, useDrawnWidth } from "./useDrawnWidth";
import { ModalSheet } from "./ModalSheet";
import { dirName, MoonGlyph } from "./moonParts";

const noonOf = (d: string) => Date.parse(`${d}T12:00:00+09:00`);
const WEEK = ["月", "火", "水", "木", "金", "土", "日"];
const jst = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

export function MoonSheet({ date, station, onClose }: { date: string; station: string; onClose: () => void }) {
  const ll = stationLatLon(station) ?? DEFAULT_LAT_LON;
  const [sel, setSel] = useState(date);
  const [month, setMonth] = useState(monthOf(date));
  const [view, setView] = useState<"cal" | "trend">("cal");
  const days = useMemo(() => daysOfMonth(month), [month]);
  const cells = useMemo(() => days.map((d) => ({ d, p: moonPhase(noonOf(d)), size: moonDistance(noonOf(d)).diameter })), [days]);
  const lead = (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7; // 月曜はじまり
  const p = moonPhase(noonOf(sel));
  const name = moonShapeName(noonOf(sel));
  const dist = moonDistance(noonOf(sel));
  const t = moonTimes(sel, ll.lat, ll.lon);
  const next = useMemo(() => moonQuarters(Date.parse(`${sel}T00:00:00+09:00`), 4), [sel]);
  // その日に新月・上弦・満月・下弦があれば、形の名前はそれ（時刻つき）。昔の呼び名は、その日に月相が無いときだけ。
  const today = next.find((q) => jst(q.at).date === sel);
  const title = today ? `${QUARTER_NAME[today.kind]}（${clockOf(jst(today.at).min)}）` : name.shape;
  const old = today ? null : name.old;
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const ev = (label: string, e: { at: number; azimuth: number } | null, note?: string) => (
    <div className="sun-key">
      <small>{label}</small>
      <b>{e ? clockOf(Math.round(e.at)) : "—"}</b>
      <small>{e ? (note ?? dirName(e.azimuth)) : "この日は無し"}</small>
    </div>
  );
  return (
    <ModalSheet title="月のこよみ" onClose={onClose} className="moon-sheet">
      <div className="moon-today">
        <MoonGlyph phase={p} size={72} />
        <div className="moon-today-text">
          <small>{dateLabel(sel)}（正午）</small>
          <b>
            {title}
            {old && <span className="moon-old">{old}</span>}
          </b>
          <span>
            月齢 {p.age.toFixed(1)}・明るい部分 {Math.round(p.illuminated * 100)}%
          </span>
          <small>
            距離 {Math.round(dist.km / 1000) / 10}万km・見かけの大きさ {dist.diameter.toFixed(2)}°
          </small>
        </div>
      </div>
      <div className="sun-keys moon">
        {ev("月の出", t.rise)}
        {ev("南中", t.transit, t.transit ? `高さ ${Math.round(t.transit.altitude)}°` : undefined)}
        {ev("月の入り", t.set)}
      </div>

      <div className="moon-cal-head">
        <IconButton size="sm" label="前の月" onClick={() => shift(-1)}>
          <Glyph name="prev" />
        </IconButton>
        <b>
          {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
        </b>
        <IconButton size="sm" label="次の月" onClick={() => shift(1)}>
          <Glyph name="next" />
        </IconButton>
      </div>
      <Segmented
        label="見かた"
        value={view}
        onChange={setView}
        options={[
          { id: "cal", label: "カレンダー" },
          { id: "trend", label: "満ち欠けと大きさ" },
        ]}
      />
      <div className="moon-body">
        <div className={view === "cal" ? "moon-pane" : "moon-pane off"} aria-hidden={view !== "cal"} inert={view !== "cal"}>
          <div className="moon-cal" role="grid" aria-label="月の形のカレンダー">
            {WEEK.map((w) => (
              <small key={w} className="moon-cal-wd">
                {w}
              </small>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`e${i}`} />
            ))}
            {cells.map(({ d, p: cp }) => (
              <button
                key={d}
                type="button"
                className={d === sel ? "moon-cal-day on" : "moon-cal-day"}
                aria-pressed={d === sel}
                aria-label={`${dateLabel(d)}、月齢 ${cp.age.toFixed(1)}、明るい部分 ${Math.round(cp.illuminated * 100)}%`}
                onClick={() => setSel(d)}
              >
                <span className="moon-cal-n">{Number(d.slice(8))}</span>
                <MoonGlyph phase={cp} size={22} />
              </button>
            ))}
          </div>
        </div>
        <div className={view === "trend" ? "moon-pane" : "moon-pane off"} aria-hidden={view !== "trend"} inert={view !== "trend"}>
          <MoonTrend cells={cells} sel={sel} onPick={setSel} />
        </div>
      </div>

      <div className="moon-next">
        {next.map((q) => {
          const j = jst(q.at);
          return (
            <span key={q.at}>
              <small>{QUARTER_NAME[q.kind]}</small>
              <b>
                {Number(j.date.slice(5, 7))}/{Number(j.date.slice(8))} {clockOf(j.min)}
              </b>
            </span>
          );
        })}
      </div>
      <p className="moon-credit">月の計算：Astronomy Engine（国立天文台の暦と照らし合わせ済み）。地点：観測所の場所。</p>
    </ModalSheet>
  );
}

/**
 * 満ち欠けと見かけの大きさの推移（2026-11-19）：その月の毎日の正午の値。明るい部分（0〜100%、右の目盛り）は面、
 * 見かけの大きさ（視直径、左の目盛り）は月の色の線。選んだ日に縦の線。なぞる・押すとその日を選ぶ（上の月が替わる）。
 * 下に 1・5・10…日の月の形と、新月・満月の日の印。見かけの大きさは近地点で大きく、遠地点で小さい（満ち欠けとは別の周期）。
 */
function MoonTrend({ cells, sel, onPick }: { cells: { d: string; p: ReturnType<typeof moonPhase>; size: number }[]; sel: string; onPick: (d: string) => void }) {
  const box = useRef<SVGSVGElement>(null);
  const W = useDrawnWidth(box, [], 340) || 340;
  const H = 236;
  const fs = svgTextSize("xs", W, W);
  const L = 40;
  const R = 34;
  const top = 12;
  const bottom = H - 66;
  const G = 18;
  const n = cells.length;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const sizes = cells.map((c) => c.size);
  const lo = Math.floor(Math.min(...sizes) * 100 - 1) / 100;
  const hi = Math.ceil(Math.max(...sizes) * 100 + 1) / 100;
  const yS = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const yI = (v: number) => bottom - v * (bottom - top);
  const area = `M${x(0)},${bottom} ` + cells.map((c, i) => `L${x(i).toFixed(1)},${yI(c.p.illuminated).toFixed(1)}`).join(" ") + ` L${x(n - 1)},${bottom} Z`;
  const line = cells.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yS(c.size).toFixed(1)}`).join(" ");
  const si = Math.max(0, cells.findIndex((c) => c.d === sel));
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
    onPick(cells[Math.max(0, Math.min(n - 1, i))].d);
  };
  const drag = useRef(false);
  // 新月・満月の日（明るい部分がいちばん小さい／大きい日）に印
  const marks = cells.flatMap((c, i) => {
    const a = cells[i - 1]?.p.illuminated ?? Infinity;
    const b = cells[i + 1]?.p.illuminated ?? Infinity;
    const a2 = cells[i - 1]?.p.illuminated ?? -Infinity;
    const b2 = cells[i + 1]?.p.illuminated ?? -Infinity;
    if (c.p.illuminated <= a && c.p.illuminated <= b && c.p.illuminated < 0.1) return [{ i, label: "新月" }];
    if (c.p.illuminated >= a2 && c.p.illuminated >= b2 && c.p.illuminated > 0.9) return [{ i, label: "満月" }];
    return [];
  });
  const days = [1, 5, 10, 15, 20, 25, 30].filter((d) => d <= n);
  return (
    <div className="moon-trend">
      <div className="moon-trend-legend" aria-hidden>
        <span>
          <i className="moon-trend-key size" style={{ background: ICON.moon }} />
          見かけの大きさ（左）
        </span>
        <span>
          <i className="moon-trend-key lit" />
          明るい部分（右）
        </span>
      </div>
      <svg
        ref={box}
        className="moon-trend-chart"
        data-no-sheet-drag
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`この月の満ち欠けと見かけの大きさ。見かけの大きさ ${Math.min(...sizes).toFixed(2)}°〜${Math.max(...sizes).toFixed(2)}°。押すとその日を選びます`}
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.current = true;
          pick(e);
        }}
        onPointerMove={(e) => drag.current && pick(e)}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
        onPointerLeave={() => (drag.current = false)}
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={yI(v)} y2={yI(v)} className="moon-trend-grid" />
            <text x={W - R + 4} y={yI(v) + 4} className="sun-tick" fontSize={fs}>
              {v * 100}%
            </text>
          </g>
        ))}
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <text key={v} x={L - 4} y={yS(v) + 4} textAnchor="end" className="sun-tick" fontSize={fs}>
            {v.toFixed(2)}°
          </text>
        ))}
        <path d={area} className="moon-trend-lit" />
        <path d={line} className="moon-trend-size" style={{ stroke: ICON.moon }} />
        <line x1={x(si)} x2={x(si)} y1={top} y2={bottom} className="sun-cursor" />
        <circle cx={x(si)} cy={yS(cells[si].size)} r={4} className="moon-trend-dot" style={{ fill: ICON.moon }} />
        {days.map((d) => (
          <g key={d}>
            <g transform={`translate(${(x(d - 1) - G / 2).toFixed(1)} ${bottom + 6})`}>
              <MoonGlyph phase={cells[d - 1].p} size={G} />
            </g>
            <text x={x(d - 1)} y={bottom + G + 20} textAnchor="middle" className="sun-tick" fontSize={fs}>
              {d}日
            </text>
          </g>
        ))}
        {marks.map((m) => (
          <text key={m.i} x={x(m.i)} y={bottom + G + 38} textAnchor="middle" className="moon-trend-mark" fontSize={fs}>
            {m.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

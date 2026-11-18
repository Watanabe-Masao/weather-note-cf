// 月のこよみ（2026-11-19 渡辺さん「月の情報ページ」）：太陽と月のシートから開く。上に選んだ日の月（形の絵・形の名前・
// 月齢・明るい部分・距離と見かけの大きさ・月の出／南中／月の入り）、下にその月のカレンダー（日ごとの形と月齢）、
// いちばん下に次の新月・上弦・満月・下弦。日を押すとその日の月に替わる。計算は shared/moon.ts（Astronomy Engine、
// 国立天文台の暦で確かめ済み）。時刻は正午の値（月齢・形）と、その日の出入り。1画面に収める。
import { useMemo, useState } from "react";
import { daysOfMonth, monthOf } from "../../shared/dates";
import { clockOf } from "../../shared/dayParts";
import { moonDistance, moonPhase, moonQuarters, moonShapeName, moonTimes, QUARTER_NAME } from "../../shared/moon";
import { DEFAULT_LAT_LON, stationLatLon } from "../../shared/sunTimes";
import { dateLabel } from "../design/format";
import { Glyph, IconButton } from "./kit";
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
  const days = useMemo(() => daysOfMonth(month), [month]);
  const cells = useMemo(() => days.map((d) => ({ d, p: moonPhase(noonOf(d)) })), [days]);
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
            <small>{cp.age.toFixed(0)}</small>
          </button>
        ))}
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

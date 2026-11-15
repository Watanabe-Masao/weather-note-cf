// The day's weather by time band (朝・日中・昼・夕方・夜), for the readout card of the daily graph: the
// shown day's picture large and its comparison day's small beside it, as the hours' band of weather
// (HourCompare) shows them. Estimates (from sunshine and rain, no weather text) are faint.

import { dayEdges, dayParts, hoursIn } from "../../shared/dayParts";
import { hoursWeather } from "../../shared/dayWeather";
import type { WeatherStore } from "../data/store";
import { WeatherIcon } from "./WeatherIcon";

type Wx = { text: string | null; estimated: boolean };

/** Each band's weather of a day, or null for every band while its hours are not there. */
function bandsOf(store: WeatherStore | null, station: string, date: string | null): { label: string; wx: Wx; night: boolean }[] | null {
  if (!date) return null;
  const hours = store?.getHours(station, date);
  if (hours?.state !== "ready" || !hours.rows.length) return null;
  const e = dayEdges(date, station);
  return dayParts(date, station).map((p) => {
    const mid = (p.from + p.to) / 2;
    return { label: p.label, wx: hoursWeather(hours.rows, hoursIn(p), station, 1), night: mid < e.rise || mid > e.set };
  });
}

function Icon({ w, size, night, cls }: { w: Wx | undefined; size: number; night: boolean; cls: string }) {
  if (!w?.text) return <span className={`${cls} none`}>—</span>;
  return (
    <span className={`${cls}${w.estimated ? " weather-estimated" : ""}`} title={w.estimated ? `${w.text}（推定：日照と降水から）` : w.text}>
      <WeatherIcon text={w.text} size={size} night={night} />
    </span>
  );
}

export function PartsWeather({ store, station, date, partner }: { store: WeatherStore | null; station: string; date: string; partner: string | null }) {
  const main = bandsOf(store, station, date);
  const other = bandsOf(store, station, partner);
  const parts = main ?? other;
  if (!parts) return null;
  const say = (b: { label: string; wx: Wx }[] | null, i: number) => b?.[i]?.wx.text ?? "なし";
  return (
    <div
      className="parts-wx"
      role="img"
      aria-label={`時間帯の天気（大きい方が対象・小さい方が比較）：${parts.map((p, i) => `${p.label} ${say(main, i)}${partner ? `／${say(other, i)}` : ""}`).join("、")}`}
    >
      <span className="parts-wx-name">天気</span>
      {parts.map((p, i) => (
        <span key={p.label} className="parts-wx-cell">
          <small>{p.label}</small>
          <span className="parts-wx-icons">
            <Icon w={main?.[i].wx} size={18} night={main?.[i].night ?? false} cls="band-wx-main" />
            {partner && <Icon w={other?.[i].wx} size={13} night={other?.[i].night ?? false} cls="band-wx-other" />}
          </span>
        </span>
      ))}
    </div>
  );
}

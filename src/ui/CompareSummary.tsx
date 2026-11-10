// The two days side by side, laid out like the table: the target day (upper table) on the left,
// the comparison day (lower table) on the right; item and difference in the middle.
//
// Compact: one line per item (value · "item diff" · value), the chosen item highlighted.
// Minimised: a single line (max/min, weather) — remembered on this device.

import { useState } from "react";
import { addDays } from "../../shared/dates";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { WeatherRow } from "../../shared/types";
import { dailyRadiation } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { clock, hourOfDay } from "../data/sun";
import { signedDiff } from "../dayDetail";
import type { MetricId } from "../metrics";
import { useSun } from "./HourCompare";
import { WeatherIcon } from "./WeatherIcon";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  other: string | null;
  today: string;
  /** The item chosen in the chips: its row is highlighted. */
  metric?: MetricId;
}

const COLLAPSED = "weather-note:summary-collapsed";
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function kindOf(store: WeatherStore | null, station: string, date: string) {
  const day = store?.getDay(station, date);
  if (day?.state !== "ready" || !day.row) return null;
  if (day.row.type === "forecast") return "予報";
  return day.kind === "variable" ? "暫定" : "実績";
}

function relative(date: string, today: string) {
  if (date === today) return "今日";
  if (date === addDays(today, -1)) return "昨日";
  if (date === addDays(today, 1)) return "明日";
  return null;
}

/** "11/10（火）", with the year when the two days are in different years. */
const label = (d: string, withYear: boolean) => `${withYear ? `${d.slice(0, 4)}/` : ""}${+d.slice(5, 7)}/${+d.slice(8)}（${weekdayOf(d)}）`;

/** Sunrise difference in minutes, "+7分" / "−3分" / "±0". */
function minutes(a: string | null, b: string | null): string {
  const x = hourOfDay(a);
  const y = hourOfDay(b);
  if (x == null || y == null) return "";
  const d = Math.round((x - y) * 60);
  return d === 0 ? "±0" : d > 0 ? `+${d}分` : `−${-d}分`;
}

interface Row {
  key: string;
  /** The chip this row belongs to. */
  metric: MetricId;
  label: string;
  unit: string;
  tone?: string;
  digits: number;
  a: number | null;
  b: number | null;
  /** A second, small value after the main one (sunshine hours next to radiation). */
  subA?: string;
  subB?: string;
}

function useCollapsed(): [boolean, (v: boolean) => void] {
  const [v, set] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED) === "1";
    } catch {
      return false;
    }
  });
  return [
    v,
    (next) => {
      set(next);
      try {
        localStorage.setItem(COLLAPSED, next ? "1" : "0");
      } catch {
        // Not remembering is harmless.
      }
    },
  ];
}

export function CompareSummary({ store, station, target, other, today, metric }: Props) {
  const [collapsed, setCollapsed] = useCollapsed();
  const rowOf = (d: string | null): WeatherRow | null => (d ? (store?.getDay(station, d).row ?? null) : null);
  const hoursOf = (d: string | null) => (d ? (store?.getHours(station, d).rows ?? null) : null);
  const a = rowOf(target);
  const b = rowOf(other);
  const sunA = useSun(station, target, today, a);
  const sunB = useSun(station, other, today, b);
  const years = !!other && other.slice(0, 4) !== target.slice(0, 4);
  const hours = (v: unknown) => (num(v) == null ? undefined : `日照${num(v)!.toFixed(1)}h`);

  const rows: Row[] = [
    { key: "max", metric: "temp", label: "最高", unit: "℃", tone: "hot", digits: 1, a: num(a?.max), b: num(b?.max) },
    { key: "min", metric: "temp", label: "最低", unit: "℃", tone: "cold", digits: 1, a: num(a?.min), b: num(b?.min) },
    { key: "rain", metric: "rain", label: "降水", unit: "mm", tone: "rain", digits: 1, a: num(a?.rain), b: num(b?.rain) },
    {
      key: "radiation",
      metric: "radiation",
      label: "日射",
      unit: "MJ",
      tone: "sun",
      digits: 1,
      a: dailyRadiation(a, hoursOf(target)),
      b: dailyRadiation(b, hoursOf(other)),
      subA: hours(a?.sun),
      subB: hours(b?.sun),
    },
    { key: "humidity", metric: "humidity", label: "湿度", unit: "%", digits: 0, a: num(a?.humidity), b: num(b?.humidity) },
    { key: "wind", metric: "wind", label: "風速", unit: "m/s", digits: 1, a: num(a?.wind), b: num(b?.wind) },
    { key: "pressure", metric: "pressure", label: "気圧", unit: "hPa", digits: 0, a: num(a?.pressure), b: num(b?.pressure) },
  ];

  const value = (v: number | null, r: Row, sub?: string) =>
    v == null ? (
      <span className="cs-none">—</span>
    ) : (
      <>
        {v.toFixed(r.digits)}
        <small>{r.unit}</small>
        {sub && <small className="cs-sub">{sub}</small>}
      </>
    );

  const head = (d: string | null, r: WeatherRow | null, side: "a" | "b") => {
    if (!d) return <span className="cs-none">該当日なし</span>;
    const rel = relative(d, today);
    const kind = kindOf(store, station, d);
    return (
      <span className={`cs-head cs-${side}`}>
        {rel && <em className="cs-rel">{rel}</em>}
        <span className={`cs-date tone-${dayTone(d)}`}>{label(d, years && d === other)}</span>
        <WeatherIcon text={(r?.dayWeather as string | null) ?? null} />
        {kind && <span className={`cs-kind kind-${kind}`}>{kind}</span>}
      </span>
    );
  };

  const toggle = (
    <button
      className="cs-toggle"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "比較を広げる" : "比較を畳む"}
    >
      {collapsed ? "▾" : "▴"}
    </button>
  );

  if (collapsed) {
    const t = (v: number | null) => (v == null ? "—" : v.toFixed(1));
    return (
      <section className="compare-summary collapsed" aria-label="対象日と比較日（畳んだ表示）">
        <span className="cs-line cs-a">
          <WeatherIcon text={(a?.dayWeather as string | null) ?? null} />
          <span className="tone-hot">{t(num(a?.max))}</span>/<span className="tone-cold">{t(num(a?.min))}</span>
        </span>
        <span className="cs-mid cs-line-mid">
          {signedDiff(a?.max, b?.max)} / {signedDiff(a?.min, b?.min)}
        </span>
        <span className="cs-line cs-b">
          <span className="tone-hot">{t(num(b?.max))}</span>/<span className="tone-cold">{t(num(b?.min))}</span>
          <WeatherIcon text={(b?.dayWeather as string | null) ?? null} />
        </span>
        {toggle}
      </section>
    );
  }

  return (
    <section className="compare-summary compact" aria-label="対象日と比較日">
      <div className="cs-heads">
        {head(target, a, "a")}
        <span className="cs-vs">比較</span>
        {head(other, b, "b")}
        {toggle}
      </div>

      {rows.map((r) => (
        <div key={r.key} className={r.metric === metric ? "cs-row chosen" : "cs-row"}>
          <span className={`cs-val cs-a${r.tone ? ` tone-${r.tone}` : ""}`}>{value(r.a, r, r.subA)}</span>
          <span className="cs-mid">
            <span className="cs-label">{r.label}</span>
            <span className="cs-diff">{signedDiff(r.a, r.b, r.digits)}</span>
          </span>
          <span className={`cs-val cs-b${r.tone ? ` tone-${r.tone}` : ""}`}>{value(r.b, r, r.subB)}</span>
        </div>
      ))}

      <div className="cs-row cs-sun">
        <span className="cs-val cs-a">
          {clock(sunA?.sunrise ?? null)}–{clock(sunA?.sunset ?? null)}
        </span>
        <span className="cs-mid">
          <span className="cs-label">日の出</span>
          <span className="cs-diff">{minutes(sunA?.sunrise ?? null, sunB?.sunrise ?? null)}</span>
        </span>
        <span className="cs-val cs-b">
          {clock(sunB?.sunrise ?? null)}–{clock(sunB?.sunset ?? null)}
        </span>
      </div>
    </section>
  );
}

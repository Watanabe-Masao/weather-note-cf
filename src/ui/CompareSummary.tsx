// The two days side by side, laid out like the table: the target day (upper table) on the left,
// the comparison day (lower table) on the right. Item names and the difference sit in the middle,
// so each row reads "this day ← difference → that day".

import { addDays } from "../../shared/dates";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { clock, hourOfDay } from "../data/sun";
import { signedDiff } from "../dayDetail";
import { useSun } from "./HourCompare";
import { WeatherIcon } from "./WeatherIcon";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  other: string | null;
  today: string;
}

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

/** Sunrise/sunset difference in minutes, "+7分" / "−3分" / "±0". */
function minutes(a: string | null, b: string | null): string {
  const x = hourOfDay(a);
  const y = hourOfDay(b);
  if (x == null || y == null) return "";
  const d = Math.round((x - y) * 60);
  return d === 0 ? "±0" : d > 0 ? `+${d}分` : `−${-d}分`;
}

interface Row {
  label: string;
  unit: string;
  tone?: string;
  digits: number;
  a: number | null;
  b: number | null;
  /** Shown even when only one side has a value (rain chance exists only for forecasts). */
  oneSided?: boolean;
}

export function CompareSummary({ store, station, target, other, today }: Props) {
  const rowOf = (d: string | null): WeatherRow | null => (d ? (store?.getDay(station, d).row ?? null) : null);
  const a = rowOf(target);
  const b = rowOf(other);
  const sunA = useSun(station, target, today, a);
  const sunB = useSun(station, other, today, b);
  const years = !!other && other.slice(0, 4) !== target.slice(0, 4);
  const chance = (r: WeatherRow | null) => (r?.type === "forecast" ? num(r.probability) : null);

  const rows: Row[] = [
    { label: "最高", unit: "℃", tone: "hot", digits: 1, a: num(a?.max), b: num(b?.max) },
    { label: "最低", unit: "℃", tone: "cold", digits: 1, a: num(a?.min), b: num(b?.min) },
    { label: "降水", unit: "mm", tone: "rain", digits: 1, a: num(a?.rain), b: num(b?.rain) },
    { label: "湿度", unit: "%", digits: 0, a: num(a?.humidity), b: num(b?.humidity) },
  ];
  if (chance(a) != null || chance(b) != null)
    rows.push({ label: "降水確率", unit: "%", tone: "rain", digits: 0, a: chance(a), b: chance(b), oneSided: true });

  const value = (v: number | null, r: Row) =>
    v == null ? (
      <span className="cs-none">—</span>
    ) : (
      <>
        {v.toFixed(r.digits)}
        <small>{r.unit}</small>
      </>
    );

  const head = (d: string | null, r: WeatherRow | null) => {
    if (!d) return <span className="cs-none">該当日なし</span>;
    const rel = relative(d, today);
    const kind = kindOf(store, station, d);
    return (
      <>
        <span className={`cs-date tone-${dayTone(d)}`}>
          {rel && <em className="cs-rel">{rel}</em>}
          {label(d, years && d === other)}
        </span>
        <span className="cs-weather">
          <WeatherIcon text={(r?.dayWeather as string | null) ?? null} />
          <span>{(r?.dayWeather as string) || "—"}</span>
          {kind && <span className={`cs-kind kind-${kind}`}>{kind}</span>}
        </span>
      </>
    );
  };

  return (
    <section className="compare-summary" aria-label="対象日と比較日">
      <div className="cs-side cs-a">{head(target, a)}</div>
      <div className="cs-mid cs-vs">比較</div>
      <div className="cs-side cs-b">{head(other, b)}</div>

      {rows.map((r) => (
        <div key={r.label} className="cs-row">
          <span className={`cs-val cs-a${r.tone ? ` tone-${r.tone}` : ""}`}>{value(r.a, r)}</span>
          <span className="cs-mid">
            <span className="cs-label">{r.label}</span>
            {!r.oneSided && <span className="cs-diff">{signedDiff(r.a, r.b, r.digits)}</span>}
          </span>
          <span className={`cs-val cs-b${r.tone ? ` tone-${r.tone}` : ""}`}>{value(r.b, r)}</span>
        </div>
      ))}

      <div className="cs-row cs-sun">
        <span className="cs-val cs-a">
          {clock(sunA?.sunrise ?? null)}
          <small>–{clock(sunA?.sunset ?? null)}</small>
        </span>
        <span className="cs-mid">
          <span className="cs-label">日の出–入り</span>
          <span className="cs-diff">{minutes(sunA?.sunrise ?? null, sunB?.sunrise ?? null)}</span>
        </span>
        <span className="cs-val cs-b">
          {clock(sunB?.sunrise ?? null)}
          <small>–{clock(sunB?.sunset ?? null)}</small>
        </span>
      </div>
      <p className="cs-note">中央の差は 左（対象日）− 右（比較日）</p>
    </section>
  );
}

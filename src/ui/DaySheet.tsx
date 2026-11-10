// Day detail sheet: opened by tapping a column. A summary of the day and its partner day,
// then the 24 hours of both as a graph, switchable between 実測 and 肌感.

import { useContext, useEffect, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { WeatherStore } from "../data/store";
import { clock } from "../data/sun";
import { type DetailMetricId, offeredMetrics, signedDiff } from "../dayDetail";
import { FeelContext } from "./FeelBar";
import { HourCompare, shortDate, useSun } from "./HourCompare";
import { ModalSheet, SheetCloseButton } from "./ModalSheet";
import { WeatherIcon } from "./WeatherIcon";

export interface DayPick {
  date: string;
  /** The day it is compared with (the other side of the table), when there is one. */
  other: string | null;
}

interface Props {
  store: WeatherStore | null;
  station: string;
  pick: DayPick;
  initialMetric: DetailMetricId;
  today: string;
  onClose: () => void;
}

function relative(date: string, today: string) {
  if (date === today) return "今日";
  if (date === addDays(today, -1)) return "昨日";
  if (date === addDays(today, 1)) return "明日";
  return null;
}

function kindOf(store: WeatherStore | null, station: string, date: string) {
  const day = store?.getDay(station, date);
  if (day?.state !== "ready" || !day.row) return null;
  if (day.row.type === "forecast") return "予報";
  return day.kind === "variable" ? "暫定" : "実績";
}

/** The day's summary: weather, kind, max/min/rain/humidity with the difference to `other`, sunrise/sunset. */
export function DaySummary({ store, station, date, other, today }: { store: WeatherStore | null; station: string; date: string; other: string | null; today: string }) {
  const day = store?.getDay(station, date);
  const otherDay = other ? store?.getDay(station, other) : null;
  const row = day?.row;
  const otherRow = otherDay?.row;
  const sun = useSun(station, date, today, row);
  const kind = kindOf(store, station, date);
  return (
        <div className="day-summary">
          <div className="day-weather">
            <span className="day-icon">{day?.state === "ready" ? <WeatherIcon text={row?.dayWeather as string | null} /> : <span className="skeleton icon" />}</span>
            <span className="day-text">{(row?.dayWeather as string) || (day?.state === "ready" ? "天気の記録なし" : "")}</span>
            {kind && <span className={`day-kind kind-${kind}`}>{kind}</span>}
          </div>
          <dl className="day-tiles" style={{ gridTemplateColumns: `repeat(${row?.type === "forecast" && typeof row.probability === "number" ? 5 : 4}, 1fr)` }}>
            <Tile label="最高" unit="℃" tone="hot" v={row?.max} o={otherRow?.max} hasOther={!!other} />
            <Tile label="最低" unit="℃" tone="cold" v={row?.min} o={otherRow?.min} hasOther={!!other} />
            <Tile label="降水" unit="mm" tone="rain" v={row?.rain} o={otherRow?.rain} hasOther={!!other} />
            <Tile label="湿度" unit="%" v={row?.humidity} o={otherRow?.humidity} hasOther={!!other} digits={0} />
            {/* Rain chance exists only for forecasts, so it has nothing to compare with. */}
            {row?.type === "forecast" && typeof row.probability === "number" && (
              <Tile label="降水確率" unit="%" tone="rain" v={row.probability} o={null} hasOther={false} digits={0} />
            )}
          </dl>
          <p className="day-sun">
            <span>
              日の出 {clock(sun?.sunrise ?? null)}　日の入り {clock(sun?.sunset ?? null)}
            </span>
            {other && (
              <span className="day-vs">
                差は <b className={`tone-${dayTone(other)}`}>{shortDate(other).slice(5)}（{weekdayOf(other)}）</b> と比べて
              </span>
            )}
          </p>
        </div>
  );
}

export function DaySheet({ store, station, pick, initialMetric, today, onClose }: Props) {
  const settings = useContext(FeelContext);
  const { date, other } = pick;
  const [metricId, setMetricId] = useState<DetailMetricId>(initialMetric);
  const lastMeasured = useRef<DetailMetricId>(initialMetric === "feel" ? "temp" : initialMetric);
  if (metricId !== "feel") lastMeasured.current = metricId;

  // Hourly data for both days, first in line while the sheet is open.
  useEffect(() => {
    if (!store) return;
    store.wantHours(station, [date, ...(other ? [other] : [])], 0, "day");
    return () => store.wantHours(station, [], 0, "day");
  }, [store, station, date, other]);

  const hours = store?.getHours(station, date);
  const otherHours = other ? store?.getHours(station, other) : null;

  const rel = relative(date, today);
  const feelName = settings.sun ? "日なた温度" : "日かげ温度";

  // Opened on snow or rain chance for days that have none: show temperature instead.
  const offered = offeredMetrics(hours?.rows ?? [], otherHours?.rows ?? [], settings);
  const loaded = hours?.state === "ready" && (!other || otherHours?.state === "ready");
  useEffect(() => {
    if (loaded && metricId !== "feel" && !offered.some((m) => m.id === metricId)) setMetricId("temp");
  }, [loaded, metricId, offered]);

  return (
    <ModalSheet label={`${shortDate(date)}の詳細`} onClose={onClose} className="day-sheet">
        <header className="day-head">
          <h2 className={`tone-${dayTone(date)}`}>
            {rel && <span className="day-rel">{rel}</span>}
            {shortDate(date)}（{weekdayOf(date)}）
          </h2>
          <SheetCloseButton />
        </header>

        <DaySummary store={store} station={station} date={date} other={other} today={today} />

        <div className="day-switch" role="tablist">
          <button
            role="tab"
            aria-selected={metricId !== "feel"}
            className={metricId !== "feel" ? "on" : ""}
            onClick={() => setMetricId(lastMeasured.current)}
          >
            実測
          </button>
          <button role="tab" aria-selected={metricId === "feel"} className={metricId === "feel" ? "on" : ""} onClick={() => setMetricId("feel")}>
            肌感
          </button>
        </div>
        {metricId !== "feel" ? (
          <div className="day-metrics">
            {offered.map((m) => (
              <button key={m.id} className={m.id === metricId ? "chip on" : "chip"} onClick={() => setMetricId(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="day-feel-note">
            {feelName}（気温・湿度・風{settings.sun ? "・日射" : ""}から）。背景は肌感の5段階
          </p>
        )}

        <HourCompare store={store} station={station} date={date} other={other} metricId={metricId} today={today} />
    </ModalSheet>
  );
}

function Tile({
  label,
  unit,
  tone,
  v,
  o,
  hasOther,
  digits = 1,
}: {
  label: string;
  unit: string;
  tone?: string;
  v: unknown;
  o: unknown;
  hasOther: boolean;
  digits?: number;
}) {
  const value = typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
  return (
    <div className="day-tile">
      <dt>{label}</dt>
      <dd className={tone ? `tone-${tone}` : undefined}>
        {value}
        <small>{unit}</small>
      </dd>
      {hasOther && <dd className="diff">{signedDiff(v, o, digits)}</dd>}
    </div>
  );
}


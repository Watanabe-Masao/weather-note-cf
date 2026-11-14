// その日の要約 (#176): a long press on a day's weather picture opens the day at a glance, beside
// its comparison day — the weather, temperatures, rain, sunshine and wind — and, on a 強風／暴風
// day, how far the wind went past JMA's criteria.

import { dayWeatherOf } from "../../shared/dayWeather";
import { STORM, stormLevel, stormOfRow } from "../../shared/storm";
import type { WeatherRow } from "../../shared/types";
import { hourlyExtreme } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { kindLabel } from "./CompareBoard";
import { dayComment } from "../data/dayComment";
import { dateLabel, formatValue, monthDay, needsYear, num, signedDiff } from "../design/format";
import { DATA } from "../design/tokens";
import { Badge, confidenceOfRow, GraphReadout, type Kind, type ReadoutRow, SectionHead } from "./kit";
import { useEffect } from "react";
import { ModalSheet } from "./ModalSheet";
import { DayWeatherIcon, StormMark } from "./WeatherIcon";

export interface DaySummaryAsk {
  date: string;
  /** The day it is read against (the partner column), or none. */
  other: string | null;
}

export function DaySummaryCard({ store, station, ask, onClose }: { store: WeatherStore | null; station: string; ask: DaySummaryAsk; onClose: () => void }) {
  const { date, other } = ask;
  const dayA = store?.getDay(station, date);
  const dayB = other ? store?.getDay(station, other) : null;
  const a = dayA?.row ?? null;
  const b = dayB?.row ?? null;
  // The hours, for the lowest pressure (the table may not have asked for them).
  useEffect(() => {
    store?.wantHours(station, [date, ...(other ? [other] : [])], Priority.Visible, "summary");
    return () => store?.wantHours(station, [], Priority.Visible, "summary");
  }, [store, station, date, other]);
  const v = (row: WeatherRow | null, k: string, unit: string) => (row ? formatValue(row[k], unit) : "—");
  const d = (k: string, unit: string) => (a && b ? signedDiff(num(a[k]), num(b[k]), unit) : "");
  const word = (row: WeatherRow | null) => (row ? (dayWeatherOf(row, station).text ?? "—") : "—");
  const rows: ReadoutRow[] = [
    { key: "wx", label: "天気", text: true, a: word(a), b: other ? word(b) : "—" },
    { key: "max", label: "最高", unit: "℃", color: DATA.hot, a: v(a, "max", "℃"), b: v(b, "max", "℃"), diff: d("max", "℃") },
    { key: "min", label: "最低", unit: "℃", color: DATA.cold, a: v(a, "min", "℃"), b: v(b, "min", "℃"), diff: d("min", "℃") },
    { key: "rain", label: "降水", unit: "mm", color: DATA.rain, a: v(a, "rain", "mm"), b: v(b, "rain", "mm"), diff: d("rain", "mm") },
    { key: "sun", label: "日照", unit: "h", color: DATA.sun, a: v(a, "sun", "h"), b: v(b, "sun", "h"), diff: d("sun", "h") },
    { key: "wind", label: "平均風速", unit: "m/s", color: DATA.wind, a: v(a, "wind", "m/s"), b: v(b, "wind", "m/s"), diff: d("wind", "m/s") },
    { key: "windMax", label: "最大風速", unit: "m/s", color: DATA.wind, a: v(a, "windMax", "m/s"), b: v(b, "windMax", "m/s"), diff: d("windMax", "m/s") },
    { key: "gust", label: "最大瞬間", unit: "m/s", color: DATA.gust, a: v(a, "gust", "m/s"), b: v(b, "gust", "m/s"), diff: d("gust", "m/s") },
  ];
  const storm = stormOfRow(a);
  const lowest = (day: string | null) => (day ? hourlyExtreme(store?.getHours(station, day).rows ?? null, "pressure", "min") : null);
  const otherName = other ? `${needsYear(other, date) ? `'${other.slice(2, 4)}/` : ""}${monthDay(other)}` : null;
  // The numbers in words (#176): two or three sentences, each from a value below.
  const comment = dayComment({ row: a, other: b, otherName, hours: store?.getHours(station, date).rows });
  const lowA = lowest(date);
  const lowB = lowest(other);
  const head = a && (
    <div className="ds-head">
      <DayWeatherIcon row={a} station={station} size={30} />
      <b className="ds-word">{word(a)}</b>
      {kindLabel(store, station, date) && <Badge kind={kindLabel(store, station, date) as Kind} confidence={confidenceOfRow(a)} />}
    </div>
  );

  return (
    <ModalSheet title={`${dateLabel(date)}の天気`} label={`${dateLabel(date)}の要約`} onClose={onClose} size="fit" className="day-summary-sheet">
      {head}
      {comment.length > 0 && (
        <p className="ds-comment">
          {comment.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </p>
      )}
      <GraphReadout
        title={storm ? <StormTitle level={storm} /> : "その日の値"}
        unit=""
        dates={{ a: monthDay(date), b: otherName ?? undefined }}
        rows={rows}
      />
      {storm && a && (
        <>
          <SectionHead title="風の強さ" />
          <div className="ds-wind">
            <Meter label="最大風速（10分平均）" value={num(a.windMax)} max={25} marks={[STORM.strong.mean, STORM.storm.mean]} />
            <Meter label="最大瞬間風速" value={num(a.gust)} max={40} marks={[STORM.strong.gust, STORM.storm.gust]} />
            <p className="ds-line">
              最低気圧
              <b>{lowA != null ? `${Math.round(lowA)} hPa` : "—"}</b>
              {lowB != null && <small>比較 {Math.round(lowB)} hPa</small>}
            </p>
            <p className="ds-note">
              基準：気象庁 高知市の強風注意報・暴風警報（平均 {STORM.strong.mean}・{STORM.storm.mean}{"\u00a0"}m/s）。瞬間は {STORM.strong.gust}・{STORM.storm.gust}{"\u00a0"}m/s。実績と予報で同じ基準です。
            </p>
          </div>
        </>
      )}
    </ModalSheet>
  );
}

function StormTitle({ level }: { level: "strong" | "storm" }) {
  return (
    <span className="ds-storm-title">
      <StormMark level={level} />
      {STORM[level].label}
    </span>
  );
}

/** How far a wind went past the criteria: a bar to `max`, ticks at 強風 and 暴風. */
function Meter({ label, value, max, marks }: { label: string; value: number | null; max: number; marks: [number, number] }) {
  const pos = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  const level = stormLevel(value, null) ?? stormLevel(null, value);
  return (
    <div className="ds-meter">
      <span className="ds-meter-label">
        {label}
        <b className={level ? "warn" : undefined}>{value == null ? "—" : `${value.toFixed(1)} m/s`}</b>
      </span>
      <span className="ds-meter-bar" role="img" aria-label={`${label} ${value == null ? "なし" : `${value.toFixed(1)} m/s`}。強風 ${marks[0]}、暴風 ${marks[1]}`}>
        {value != null && <i className="ds-meter-fill" style={{ width: pos(value) }} />}
        {marks.map((m, k) => (
          <i key={m} className="ds-meter-tick" style={{ left: pos(m) }}>
            <small>
              {m} {k ? "暴風" : "強風"}
            </small>
          </i>
        ))}
      </span>
    </div>
  );
}

// その日の要約 (#176): a long press on a day's weather picture opens the day at a glance, beside
// its comparison day — the weather, temperatures, rain, sunshine and wind — and, on a 強風／暴風
// day, how far the wind went past JMA's criteria. Under the values: the day by time band (weather) and
// by the hour (temperature and rain, a small graph).

import { dayWeatherOf } from "../../shared/dayWeather";
import { STORM, stormOfRow, type StormLevel } from "../../shared/storm";
import type { WeatherRow } from "../../shared/types";
import { hourlyExtreme } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { kindLabel } from "./CompareBoard";
import type { DaySummaryAsk } from "./daySummaryPress";
import { dayComment } from "../data/dayComment";
import { dateLabel, formatValue, monthDay, num, shortDay, signedDiff } from "../design/format";
import { DATA } from "../design/tokens";
import { Badge, BarSample, confidenceOfRow, GraphReadout, type Kind, LineSample, Num, type ReadoutRow, SectionHead } from "./kit";
import { MiniDayChart } from "./MiniDayChart";
import { PartsWeather } from "./PartsWeather";
import { useEffect, useState } from "react";
import { ModalSheet } from "./ModalSheet";
import { DayWeatherIcon, StormMark } from "./WeatherIcon";
import { useTyphoonOn } from "../data/typhoonDays";
import type { TyphoonInfo } from "../data/typhoonNow";
import { TyphoonSheet } from "./TyphoonSheet";
import { TyphoonTag } from "./TyphoonTag";

export type { DaySummaryAsk };

export function DaySummaryCard({ store, station, ask, typhoons, onClose }: { store: WeatherStore | null; station: string; ask: DaySummaryAsk; typhoons: TyphoonInfo; onClose: () => void }) {
  const { date, other } = ask;
  // 台風の日 (#220): the same 台 as on the table, said first in the words, and the way into the typhoon.
  const typhoonOn = useTyphoonOn();
  const ty = typhoonOn(date);
  const typhoon = ty === "none" || ty === "unknown" ? null : ty;
  const [tyOpen, setTyOpen] = useState(false);
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
  const otherName = other ? shortDay(other, date) : null;
  // The numbers in words (#176): two or three sentences, each from a value below.
  const comment = dayComment({ row: a, other: b, otherName, hours: store?.getHours(station, date).rows, typhoon });
  const lowA = lowest(date);
  const lowB = lowest(other);
  const kind = kindLabel(store, station, date);
  const ready = (day: string | null) => {
    const h = day ? store?.getHours(station, day) : null;
    return h?.state === "ready" && h.rows.length ? h.rows : null;
  };
  const hoursA = ready(date);
  const hoursB = ready(other);

  return (
    <ModalSheet title={`${dateLabel(date)}の天気`} label={`${dateLabel(date)}の要約`} onClose={onClose} size="fit" className="day-summary-sheet">
      {/* まとめ（浮いた面）: the day's picture, weather and status, and the numbers in words. */}
      {a && (
        <div className="ds-lead">
          <div className="ds-head">
            <DayWeatherIcon row={a} station={station} size={30} />
            <TyphoonTag date={date} inline />
            <b className="ds-word">{word(a)}</b>
            {kind && <Badge kind={kind as Kind} confidence={confidenceOfRow(a)} />}
          </div>
          {comment.length > 0 && (
            <p className="ds-comment">
              {comment.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </p>
          )}
          {typhoon && (
            <button className="ds-typhoon" onClick={() => setTyOpen(true)}>
              <span>
                台風{typhoon.number}号の情報
                <small>進路・{typhoon.area === "warning" ? "今の発表" : "当時の予報"}・地図</small>
              </span>
              <span aria-hidden className="ds-typhoon-go">›</span>
            </button>
          )}
        </div>
      )}
      {/* 数字を読む所（沈んだ面）: the same readout as every graph. */}
      <GraphReadout
        title={storm ? <StormTitle level={storm} /> : "その日の値"}
        unit=""
        dates={{ a: monthDay(date), b: otherName ?? undefined }}
        rows={rows}
        footer={<PartsWeather store={store} station={station} date={date} partner={other} />}
      />
      {/* 時間ごと: the day's temperature beside its comparison day's, and its rain, at a glance. */}
      {(hoursA || hoursB) && (
        <>
          <SectionHead title="時間ごと" />
          <div className="ds-hours">
            <MiniDayChart rows={hoursA} otherRows={hoursB} label={`${dateLabel(date)}の時間ごとの気温${other ? `（破線は${otherName}）` : ""}と降水`} />
            <p className="line-legend">
              <span>
                <LineSample day="target" color={DATA.temp} />
                気温 ℃（{monthDay(date)}）
              </span>
              {other && (
                <span>
                  <LineSample day="compare" color={DATA.temp} />
                  {otherName}
                </span>
              )}
              <span>
                <BarSample day="target" color={DATA.rain} />
                降水（{other ? "枠は比較" : "mm"}）
              </span>
            </p>
          </div>
        </>
      )}
      {storm && a && (
        <>
          <SectionHead title="風の強さ" />
          <div className="ds-wind">
            <Meter label="最大風速（10分平均）" tone="wind" value={num(a.windMax)} max={25} marks={[STORM.strong.mean, STORM.storm.mean]} />
            <Meter label="最大瞬間風速" tone="gust" value={num(a.gust)} max={40} marks={[STORM.strong.gust, STORM.storm.gust]} />
            {(lowA != null || lowB != null) && (
              <p className="ds-line">
                <span className="ds-line-label">最低気圧</span>
                <Num value={lowA} unit="hPa" tone="pressureLow" />
                {lowB != null && (
                  <span className="ds-line-other">
                    比較 <Num value={lowB} unit="hPa" />
                  </span>
                )}
              </p>
            )}
            <p className="ds-note">
              目安：平均 <span className="nowrap">{STORM.strong.mean}・{STORM.storm.mean} m/s</span> は気象庁 高知市の強風注意報・暴風警報の基準、瞬間{" "}
              <span className="nowrap">
                {STORM.strong.gust}・{STORM.storm.gust} m/s
              </span>{" "}
              は Weather Note の目安。注意報・警報が出たという意味ではありません。実績と予報で同じ目安です。
            </p>
          </div>
        </>
      )}
      {tyOpen && typhoon && <TyphoonSheet station={station} date={date} number={typhoon.number} info={typhoons} onClose={() => setTyOpen(false)} />}
    </ModalSheet>
  );
}

function StormTitle({ level }: { level: StormLevel }) {
  return (
    <span className="ds-storm-title">
      <StormMark level={level} />
      {STORM[level].label}
    </span>
  );
}

/**
 * How far a wind went past the criteria: a bar to `max` in the value's data colour, and ticks at
 * 強風 and 暴風 in the warning colour (the storm mark's colour: the criteria, not the value).
 */
function Meter({ label, tone, value, max, marks }: { label: string; tone: "wind" | "gust"; value: number | null; max: number; marks: [number, number] }) {
  const pos = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  return (
    <div className="ds-meter">
      <span className="ds-meter-label">
        {label}
        <Num value={value} unit="m/s" tone={tone} />
      </span>
      <span className="ds-meter-bar" role="img" aria-label={`${label} ${value == null ? "なし" : `${value.toFixed(1)} m/s`}。強風 ${marks[0]}、暴風 ${marks[1]}`}>
        {value != null && <i className={`ds-meter-fill fill-${tone}`} style={{ width: pos(value) }} />}
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

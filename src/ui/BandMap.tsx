// The sheet's 時間帯 face (spec 4.6–4.7): a summary of the target day and the temperature-band map
// (seven days × five bands) for the target and the comparison side.

import { useContext, useState } from "react";
import { addDays } from "../../shared/dates";
import { type Band, BANDS, describe, feelOf, hourlyBands, LEVELS, radiationOf, spread } from "../../shared/feel";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { bandsFor, FeelContext, LEVEL_COLORS } from "./FeelBar";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  partner: (date: string) => string | null;
}

const OFFSETS = [-3, -2, -1, 0, 1, 2, 3];
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(0)}`;

/** Per-band difference a − b in 日なた/日かげ温度, null where either side is missing. */
function bandDiffs(a: Band[] | null, b: Band[] | null): (number | null)[] {
  return BANDS.map((_, i) => (a?.[i]?.feel != null && b?.[i]?.feel != null ? a[i].feel! - b[i].feel! : null));
}

function useExactBands(store: WeatherStore | null, station: string, date: string | null): Band[] | null {
  const settings = useContext(FeelContext);
  if (!date) return null;
  const hours = store?.getHours(station, date);
  return hours?.state === "ready" && hours.rows.length ? hourlyBands(hours.rows, settings) : null;
}

function Summary({ store, station, target, partner }: Props) {
  const settings = useContext(FeelContext);
  const name = settings.sun ? "日なた温度" : "日かげ温度";
  const today = useExactBands(store, station, target);
  const before = useExactBands(store, station, addDays(target, -1));
  const compare = useExactBands(store, station, partner(target));
  const fallback = today ? null : bandsFor(store, station, target, settings);
  const shown = today ?? fallback?.bands ?? null;
  const phrase = shown ? describe(shown) : null;
  const feelSpread = shown ? spread(shown) : null;
  const temps = (shown ?? []).map((b) => b.temp).filter((v): v is number => v != null);
  const tempSpread = temps.length > 1 ? Math.max(...temps) - Math.min(...temps) : null;

  const diffRow = (label: string, diffs: (number | null)[]) =>
    diffs.some((d) => d != null) && (
      <p className="band-diff">
        <span className="band-diff-label">{label}</span>
        {BANDS.map((b, i) => (
          <span key={b.id} className={diffs[i] == null ? "muted" : diffs[i]! > 0.5 ? "warmer" : diffs[i]! < -0.5 ? "cooler" : ""}>
            {b.label} {diffs[i] == null ? "—" : signed(diffs[i]!)}
          </span>
        ))}
      </p>
    );

  return (
    <div className="band-summary">
      <p className="band-phrase">
        {phrase ?? "データを取得中…"}
        {!today && phrase && <small>（日別の値からの目安）</small>}
      </p>
      {feelSpread != null && (
        <p className="band-spread">
          寒暖差（{name}）<b>{feelSpread.toFixed(0)}℃</b>
          {tempSpread != null && <small>　気温では {tempSpread.toFixed(0)}℃</small>}
        </p>
      )}
      {diffRow("前日比", bandDiffs(today, before))}
      {diffRow("比較日比", bandDiffs(today, compare))}
    </div>
  );
}

interface Selected {
  side: string;
  date: string;
  band: number;
}

function MapGrid({
  title,
  dates,
  store,
  station,
  selected,
  onSelect,
}: {
  title: string;
  dates: (string | null)[];
  store: WeatherStore | null;
  station: string;
  selected: Selected | null;
  onSelect: (s: Selected) => void;
}) {
  const settings = useContext(FeelContext);
  const columns = dates.map((date) => {
    if (!date) return { date, state: "none" as const, bands: null };
    const hours = store?.getHours(station, date);
    const state = hours?.state ?? "empty";
    return { date, state, bands: state === "ready" && hours!.rows.length ? hourlyBands(hours!.rows, settings) : null };
  });

  return (
    <div className="band-map" role="table" aria-label={`${title}の温度帯マップ`}>
      <span className="band-map-title">{title}</span>
      <span aria-hidden="true" />
      {columns.map(({ date }, i) => (
        <span key={"h" + i} className={`band-map-date tone-${date ? dayTone(date) : "weekday"}${i === 3 ? " center" : ""}`}>
          {date ? `${+date.slice(5, 7)}/${+date.slice(8)}` : "—"}
          <small>{date ? weekdayOf(date) : ""}</small>
        </span>
      ))}
      {BANDS.map((band, b) => [
        <span key={band.id} className="band-map-label">
          {band.label}
        </span>,
        ...columns.map(({ date, state, bands }, i) => {
          const cell = bands?.[b];
          const isSelected = selected?.side === title && selected.date === date && selected.band === b;
          const classes = [
            "band-cell",
            i === 3 ? "center" : "",
            cell && cell.source !== "actual" ? "forecast" : "",
            isSelected ? "selected" : "",
            state === "outside" || state === "none" ? "outside" : "",
          ].join(" ");
          if (state === "empty")
            return (
              <span key={b + "-" + i} className={classes}>
                <span className="skeleton" />
              </span>
            );
          if (state === "error")
            return (
              <button key={b + "-" + i} className={classes + " error"} onClick={() => date && store?.retryDay(station, date)}>
                ×
              </button>
            );
          if (!cell || cell.feel == null)
            return (
              <span key={b + "-" + i} className={classes + " missing"}>
                {state === "ready" ? "欠測" : ""}
              </span>
            );
          return (
            <button
              key={b + "-" + i}
              className={classes}
              style={{ background: LEVEL_COLORS[cell.level!] }}
              onClick={() => date && onSelect({ side: title, date, band: b })}
              aria-label={`${date} ${band.label} ${LEVELS[cell.level!]} ${cell.feel.toFixed(0)}℃`}
            >
              <b>{cell.feel.toFixed(0)}</b>
              <small>{cell.temp == null ? "" : cell.temp.toFixed(0)}</small>
            </button>
          );
        }),
      ])}
    </div>
  );
}

function Detail({ store, station, selected, onClose }: { store: WeatherStore | null; station: string; selected: Selected; onClose: () => void }) {
  const settings = useContext(FeelContext);
  const band = BANDS[selected.band];
  const rows = (store?.getHours(station, selected.date).rows ?? []).filter((r) => (band.hours as readonly number[]).includes(r.n));
  const fmt = (v: unknown, d = 1) => (typeof v === "number" ? v.toFixed(d) : "—");
  const name = settings.sun ? "日なた" : "日かげ";
  return (
    <div className="band-detail">
      <header>
        <b>
          {selected.side} {+selected.date.slice(5, 7)}/{+selected.date.slice(8)}（{weekdayOf(selected.date)}） {band.label}
        </b>
        <button onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </header>
      <table>
        <thead>
          <tr>
            <th>時刻</th>
            <th>{name}</th>
            <th>気温</th>
            <th>湿度</th>
            <th>風速</th>
            <th>日射</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r: WeatherRow) => {
            const solar = radiationOf(r);
            const feel = feelOf(r.temp, r.humidity, r.wind, r.type === "forecast", settings, solar);
            return (
              <tr key={r.n}>
                <td>{r.n}時</td>
                <td>{fmt(feel)}</td>
                <td>{fmt(r.temp)}</td>
                <td>{fmt(r.humidity, 0)}%</td>
                <td>{fmt(r.wind)}</td>
                <td>{solar == null ? "—" : Math.round(solar)}</td>
                <td className="muted">{r.type === "forecast" ? "予報" : r.solarSource === "forecast" ? "実績＊" : "実績"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">℃・%・m/s・W/m²。＊日射は予報の値で補完。</p>
    </div>
  );
}

export function BandMap(props: Props) {
  const { store, station, target, partner } = props;
  const [selected, setSelected] = useState<Selected | null>(null);
  const targets = OFFSETS.map((n) => addDays(target, n));
  return (
    <div className="band-face">
      <Summary {...props} />
      <MapGrid title="対象日" dates={targets} store={store} station={station} selected={selected} onSelect={setSelected} />
      <MapGrid title="比較日" dates={targets.map(partner)} store={store} station={station} selected={selected} onSelect={setSelected} />
      {selected && <Detail store={store} station={station} selected={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Days the face needs hourly data for: the map's seven days on both sides and the day before the target. */
export function bandMapDays(target: string, partner: (date: string) => string | null): string[] {
  const days = [-4, ...OFFSETS].map((n) => addDays(target, n));
  return [...days, ...OFFSETS.map((n) => partner(addDays(target, n))).filter((d): d is string => !!d)];
}

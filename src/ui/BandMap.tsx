// 肌感マップ (spec 4.6–4.7): a summary of the target day and the map of 肌感 (seven days × the five
// 時間区分 朝・日中・昼・夕方・夜) for the target and the comparison side. Opened from a 肌感 bar.

import { useContext, useState } from "react";
import { addDays } from "../../shared/dates";
import { type Band, BANDS, describe, feelOf, hourlyBands, LEVELS, radiationOf, spread } from "../../shared/feel";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { BandTrend } from "./BandTrend";
import { IconButton, Segmented } from "./kit";
import { monthDay } from "../design/format";
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
  // The air-temperature spread is the day's 最高−最低, the same as the table's 寒暖差.
  const dayRow = store?.getDay(station, target).row;
  const tempSpread = typeof dayRow?.max === "number" && typeof dayRow?.min === "number" ? dayRow.max - dayRow.min : null;

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
          {name}の差 <b>{feelSpread.toFixed(0)}℃</b>
          {tempSpread != null && <small>　気温の寒暖差 {tempSpread.toFixed(1)}℃</small>}
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
  // Each day: the exact five bands from the hours; until then (or for forecast days without enough
  // hours) the same estimate the table shows, spread over the bands (朝・夜 from the low, the day from the high).
  const columns = dates.map((date) => {
    if (!date) return { date, state: "none" as const, bands: null, estimate: false };
    const hours = store?.getHours(station, date);
    const state = hours?.state ?? "empty";
    const exact = state === "ready" && hours!.rows.length ? hourlyBands(hours!.rows, settings) : null;
    if (exact && exact.some((b) => b.feel != null)) return { date, state, bands: exact, estimate: false };
    const est = bandsFor(store, station, date, settings);
    if (est && !est.exact) {
      const [low, high, late] = est.bands;
      return { date, state: "ready" as const, bands: [low, high, high, high, late], estimate: true };
    }
    return { date, state, bands: exact, estimate: false };
  });

  return (
    <div className="band-map" role="table" aria-label={`${title}の肌感マップ`}>
      <span className="band-map-title">{title}</span>
      <span aria-hidden="true" />
      {columns.map(({ date }, i) => (
        <span key={"h" + i} className={`band-map-date${i === 3 ? " center" : ""}`}>
          {date ? monthDay(date) : "—"}
          <small className={date ? `tone-${dayTone(date)}` : undefined}>{date ? weekdayOf(date) : ""}</small>
        </span>
      ))}
      {BANDS.map((band, b) => [
        <span key={band.id} className="band-map-label">
          {band.label}
        </span>,
        ...columns.map(({ date, state, bands, estimate }, i) => {
          const cell = bands?.[b];
          const isSelected = selected?.side === title && selected.date === date && selected.band === b;
          const classes = [
            "band-cell",
            i === 3 ? "center" : "",
            cell && cell.source !== "actual" ? "forecast" : "",
            estimate ? "estimate" : "",
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
              <span key={b + "-" + i} className={classes + " missing"} aria-label="データなし">
                —
              </span>
            );
          return (
            <button
              key={b + "-" + i}
              className={classes}
              style={{ background: LEVEL_COLORS[cell.level!] }}
              onClick={() => date && !estimate && onSelect({ side: title, date, band: b })}
              aria-label={`${date} ${band.label} ${LEVELS[cell.level!]} ${cell.feel.toFixed(0)}℃`}
            >
              <b>{cell.feel.toFixed(0)}</b>
              <small>{estimate ? "目安" : cell.temp == null ? "" : cell.temp.toFixed(0)}</small>
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
        <IconButton size="sm" label="閉じる" onClick={onClose}>
          ×
        </IconButton>
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
  const [view, setView] = useState<"map" | "trend">("map");
  const targets = OFFSETS.map((n) => addDays(target, n));
  return (
    <div className="band-face">
      <Summary {...props} />
      <Segmented
        label="表示"
        value={view}
        options={[
          { id: "map", label: "マップ" },
          { id: "trend", label: "推移" },
        ]}
        onChange={setView}
      />
      {view === "map" ? (
        <>
          <MapGrid title="対象日" dates={targets} store={store} station={station} selected={selected} onSelect={setSelected} />
          <MapGrid title="比較日" dates={targets.map(partner)} store={store} station={station} selected={selected} onSelect={setSelected} />
          {selected && <Detail store={store} station={station} selected={selected} onClose={() => setSelected(null)} />}
        </>
      ) : (
        <BandTrend {...props} />
      )}
    </div>
  );
}

/** Days the face needs hourly data for: the map's seven days on both sides and the day before the target. */
export function bandMapDays(target: string, partner: (date: string) => string | null): string[] {
  const days = [-4, ...OFFSETS].map((n) => addDays(target, n));
  return [...days, ...OFFSETS.map((n) => partner(addDays(target, n))).filter((d): d is string => !!d)];
}

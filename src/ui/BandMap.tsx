// 肌感マップ (spec 4.6–4.7): a summary of the target day (with where it differs most from the
// comparison day) and one map of 肌感 — seven days × the five 時間区分 朝・日中・昼・夕方・夜 — with the
// comparison day as a strip in every cell. Opened from a 肌感 bar.

import { type ReactNode, useContext, useState } from "react";
import { addDays } from "../../shared/dates";
import { type Band, BANDS, type FeelSettings, describe, feelOf, hourlyBands, LEVELS, radiationOf, spread } from "../../shared/feel";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { BandTrend } from "./BandTrend";
import { useSwipeDays } from "./useSwipeDays";
import { CloseIcon } from "./icons";
import { DayLabel, IconButton, Segmented } from "./kit";
import { monthDay } from "../design/format";
import { bandsFor, FeelContext, LEVEL_COLORS } from "./FeelBar";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  partner: (date: string) => string | null;
  /** Swipe the map sideways to move the target day (A/B: feelSwipe). */
  onStep?: (days: number) => void;
}

/** "6–8時": the hours a band covers (JMA hours: the value at the end of each hour). */
export const bandHours = (hours: readonly number[]) => `${hours[0]}–${hours[hours.length - 1]}時`;

const OFFSETS = [-3, -2, -1, 0, 1, 2, 3];
/** Whole degrees with a sign, rounded first so a small difference reads "±0", never "−0". */
const signed = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? "±0" : `${r > 0 ? "+" : "−"}${Math.abs(r)}`;
};

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
          <span key={b.id} className={diffs[i] == null || Math.round(diffs[i]!) === 0 ? "muted" : Math.abs(diffs[i]!) >= 3 ? "big" : ""}>
            {b.label} {diffs[i] == null ? "—" : signed(diffs[i]!)}
          </span>
        ))}
      </p>
    );

  // Where the two days differ most: the one line to read first.
  // Read in whole degrees, as the rows below show them.
  const vs = bandDiffs(today, compare).map((d) => (d == null ? null : Math.round(d)));
  const known = vs.filter((d): d is number => d != null);
  let most = -1;
  vs.forEach((d, i) => {
    if (d != null && (most < 0 || Math.abs(d) > Math.abs(vs[most]!))) most = i;
  });
  const same = known.length > 1 && known.every((d) => d === known[0]);

  return (
    <div className="band-summary">
      <p className="band-phrase">
        {phrase ?? "データを取得中…"}
        {!today && phrase && <small>（日別の値からの目安）</small>}
      </p>
      {feelSpread != null && (
        <p className="band-spread">
          寒暖差（{name}） <b>{feelSpread.toFixed(0)}℃</b>
          {tempSpread != null && <small>　寒暖差（気温） {tempSpread.toFixed(1)}℃</small>}
        </p>
      )}
      {most >= 0 && vs[most] !== 0 && !same && (
        <p className="band-most">
          比較日といちばん違うのは
          <b>
            {BANDS[most].label}（{signed(vs[most]!)}℃）
          </b>
        </p>
      )}
      {most >= 0 && (vs[most] === 0 || same) && (
        <p className="band-most">
          {vs[most] === 0 ? (
            "どの時間区分も比較日とほぼ同じ"
          ) : (
            <>
              どの時間区分も比較日より
              <b>{signed(vs[most]!)}℃</b>
            </>
          )}
        </p>
      )}
      {diffRow("前日比", bandDiffs(today, before))}
      {diffRow("比較日比", bandDiffs(today, compare))}
    </div>
  );
}

interface Selected {
  date: string;
  partner: string | null;
  band: number;
}

type Column = { date: string | null; state: string; bands: Band[] | null; estimate: boolean };

/**
 * Each day: the exact five bands from the hours; until then (or for forecast days without enough
 * hours) the same estimate the table shows, spread over the bands (朝・夜 from the low, the day from the high).
 */
function columnOf(store: WeatherStore | null, station: string, date: string | null, settings: FeelSettings): Column {
  if (!date) return { date, state: "none", bands: null, estimate: false };
  const hours = store?.getHours(station, date);
  const state = hours?.state ?? "empty";
  const exact = state === "ready" && hours!.rows.length ? hourlyBands(hours!.rows, settings) : null;
  if (exact && exact.some((b) => b.feel != null)) return { date, state, bands: exact, estimate: false };
  const est = bandsFor(store, station, date, settings);
  if (est && !est.exact) {
    const [low, high, late] = est.bands;
    return { date, state: "ready", bands: [low, high, high, high, late], estimate: true };
  }
  return { date, state, bands: exact, estimate: false };
}

/**
 * One map for both days: each cell is the target day's band (its colour and value), with the
 * comparison day's band as a strip along the bottom (its colour and value, smaller).
 */
function MapGrid({
  targets,
  partner,
  store,
  station,
  selected,
  onSelect,
}: {
  targets: string[];
  partner: (date: string) => string | null;
  store: WeatherStore | null;
  station: string;
  selected: Selected | null;
  onSelect: (s: Selected) => void;
}) {
  const settings = useContext(FeelContext);
  const cols = targets.map((d) => ({ a: columnOf(store, station, d, settings), b: columnOf(store, station, partner(d), settings) }));

  const half = (c: Column, b: number, side: "a" | "b") => {
    const cell = c.bands?.[b];
    const cls = `bm-${side}${c.estimate ? " estimate" : ""}${cell && cell.source !== "actual" ? " forecast" : ""}`;
    if (!c.date) return <span className={cls + " none"} />;
    if (c.state === "empty") return <span className={cls + " none"}><span className="skeleton" /></span>;
    if (c.state === "error" || !cell || cell.feel == null) return <span className={cls + " none"}>—</span>;
    return (
      <span className={cls} style={{ background: LEVEL_COLORS[cell.level!] }}>
        {side === "a" ? <b>{cell.feel.toFixed(0)}</b> : <small>{cell.feel.toFixed(0)}</small>}
      </span>
    );
  };

  return (
    <div className="band-map" role="table" aria-label="肌感マップ（対象日と比較日）">
      <span aria-hidden="true" />
      {cols.map(({ a, b }, i) => (
        <span key={"h" + i} className={`band-map-date${i === 3 ? " center" : ""}`}>
          {a.date ? monthDay(a.date) : "—"}
          <small className={a.date ? `tone-${dayTone(a.date)}` : undefined}>{a.date ? weekdayOf(a.date) : ""}</small>
          {/* The comparison date only when it reads differently (前年同日 would repeat "11/8"). */}
          {b.date && monthDay(b.date) !== (a.date ? monthDay(a.date) : "") && <em className={`tone-${dayTone(b.date)}`}>{monthDay(b.date)}</em>}
        </span>
      ))}
      {BANDS.map((band, bi) => [
        <span key={band.id} className="band-map-label">
          {band.label}
          <small>{bandHours(band.hours)}</small>
        </span>,
        ...cols.map(({ a, b }, i) => {
          const ca = a.bands?.[bi];
          const cb = b.bands?.[bi];
          const isSelected = selected?.date === a.date && selected.band === bi;
          const pickable = !!a.date && a.state !== "error" && (!a.estimate || !b.estimate);
          const diff = ca?.feel != null && cb?.feel != null ? ca.feel - cb.feel : null;
          if (a.state === "error")
            return (
              <button key={bi + "-" + i} className="band-cell error" onClick={() => a.date && store?.retryDay(station, a.date)}>
                ×
              </button>
            );
          return (
            <button
              key={bi + "-" + i}
              className={["band-cell", i === 3 ? "center" : "", isSelected ? "selected" : ""].join(" ")}
              disabled={!pickable}
              onClick={() => a.date && onSelect({ date: a.date, partner: b.date, band: bi })}
              aria-label={`${a.date} ${band.label} 対象 ${ca?.feel != null ? `${LEVELS[ca.level!]} ${ca.feel.toFixed(0)}℃` : "なし"}、比較 ${
                cb?.feel != null ? `${LEVELS[cb.level!]} ${cb.feel.toFixed(0)}℃` : "なし"
              }${diff != null ? `、差 ${signed(diff)}℃` : ""}`}
            >
              {half(a, bi, "a")}
              {half(b, bi, "b")}
            </button>
          );
        }),
      ])}
    </div>
  );
}

function DetailTable({
  store,
  station,
  date,
  band,
  title,
  year = false,
}: {
  store: WeatherStore | null;
  station: string;
  date: string;
  band: number;
  title: string;
  year?: boolean;
}) {
  const settings = useContext(FeelContext);
  const hours = BANDS[band].hours as readonly number[];
  const rows = (store?.getHours(station, date).rows ?? []).filter((r) => hours.includes(r.n));
  const fmt = (v: unknown, d = 1) => (typeof v === "number" ? v.toFixed(d) : "—");
  return (
    <>
      <p className="band-detail-day">
        {title} <DayLabel date={date} year={year} />
      </p>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th>時刻</th>
              <th>{settings.sun ? "日なた" : "日かげ"}</th>
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
                  <td>{fmt(r.humidity, 0)}</td>
                  <td>{fmt(r.wind)}</td>
                  <td>{solar == null ? "—" : Math.round(solar)}</td>
                  <td className="muted">{r.type === "forecast" ? "予報" : r.solarSource === "forecast" ? "実績＊" : "実績"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">時間ごとの値はまだありません（日別の値からの目安）。</p>
      )}
    </>
  );
}

function Detail({ store, station, selected, onClose }: { store: WeatherStore | null; station: string; selected: Selected; onClose: () => void }) {
  const band = BANDS[selected.band];
  return (
    <div className="band-detail">
      <header>
        <b>
          {band.label}
          <small className="muted"> {bandHours(band.hours)}</small>
        </b>
        <IconButton size="sm" label="時刻ごとの値を閉じる" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <DetailTable store={store} station={station} date={selected.date} band={selected.band} title="対象日" />
      {selected.partner && <DetailTable store={store} station={station} date={selected.partner} band={selected.band} title="比較日" year={selected.partner.slice(0, 4) !== selected.date.slice(0, 4)} />}
      <p className="muted">単位：℃・%・m/s・W/㎡。＊日射は予報の値で補った値。</p>
    </div>
  );
}

/** The map's swipe area (mounted with the map, so its listeners come and go with it). */
function SwipeArea({ onStep, children }: { onStep?: (days: number) => void; children: ReactNode }) {
  const swipe = useSwipeDays(onStep);
  return (
    <div ref={swipe.ref} className={onStep ? "swipeable" : undefined} style={onStep ? swipe.style : undefined}>
      {children}
    </div>
  );
}

/** The five feel levels: the colours behind every 肌感 view. */
function LevelLegend() {
  return (
    <p className="feel-legend">
      {LEVELS.map((label, i) => (
        <span key={label}>
          <i style={{ background: LEVEL_COLORS[i] }} />
          {label}
        </span>
      ))}
    </p>
  );
}

export function BandMap(props: Props) {
  const { store, station, target, partner } = props;
  const [selected, setSelected] = useState<Selected | null>(null);
  const [view, setView] = useState<"map" | "trend">("map");
  const onStep = props.onStep;
  const targets = OFFSETS.map((n) => addDays(target, n));
  const p = partner(target);
  const partnerYear = p && p.slice(0, 4) !== target.slice(0, 4) ? p.slice(0, 4) : null;
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
          <SwipeArea onStep={onStep}>
            <MapGrid targets={targets} partner={partner} store={store} station={station} selected={selected} onSelect={setSelected} />
          </SwipeArea>
          {onStep && <p className="hint map-hint">マップを左右にスワイプすると、1日ずつ動きます。</p>}
          {/* Legend right under the map, in the map's own marks. */}
          <p className="line-legend map-legend">
            <span>
              <i className="bm-key-a" />
              対象日
            </span>
            <span>
              <i className="bm-key-b" />
              比較日{partnerYear && `（${partnerYear}年）`}
            </span>
            <span>
              <i className="ls-forecast" />
              予報
            </span>
            <span>
              <i className="ls-estimate" />
              目安（日別の値から）
            </span>
          </p>
          <p className="hint map-hint">マスをタップすると、その時間区分の時刻ごとの値が開きます。</p>
          {selected && <Detail store={store} station={station} selected={selected} onClose={() => setSelected(null)} />}
        </>
      ) : (
        <BandTrend {...props} />
      )}
      <LevelLegend />
    </div>
  );
}

/** Days the face needs hourly data for: the map's seven days on both sides and the day before the target. */
export function bandMapDays(target: string, partner: (date: string) => string | null): string[] {
  const days = [-4, ...OFFSETS].map((n) => addDays(target, n));
  return [...days, ...OFFSETS.map((n) => partner(addDays(target, n))).filter((d): d is string => !!d)];
}

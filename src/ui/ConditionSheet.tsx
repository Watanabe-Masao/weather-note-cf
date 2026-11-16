// 条件から選ぶ: a way of choosing the comparison day, so it opens from the compare menu. 雨 can ask
// for a strength (the strongest hour, 強い雨〜), and 台風 for the days inside a typhoon's 強風域 or
// all but them (shared/typhoon.ts, from the best track's copy).
// Conditions start from the target day's values; each sits on one line and opens on a tap (one at
// a time). The days that meet them are listed nearest first; a tap makes one the comparison day,
// and the sheet stays open with a way to take it back.

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  CONDITION_NAME,
  type Conditions,
  candidateDays,
  PARTS,
  periodStretches,
  type Part,
  RAIN_STRENGTHS,
  type RainMode,
  SPAN_CHOICES,
  SPAN_LABEL,
  type Span,
  searchConditions,
  startConditions,
  TEMP_STEP,
  tempScale,
  type TempCondition,
  type TempMode,
  TYPHOON_FILTERS,
  type TyphoonFilter,
  WEEKDAY_FILTERS,
  type WeekdayFilter,
  YEAR_CHOICES,
  type Years,
} from "../../shared/conditions";
import { monthDay, num, weekdayOf, yearMark } from "../design/format";
import { stationLatLon } from "../../shared/sunTimes";
import { typhoonDaysAt } from "../../shared/typhoon";
import { useTyphoonTracks } from "../data/typhoon";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { DayLabel, SectionHead, Segmented, Slider } from "./kit";
import { ModalSheet } from "./ModalSheet";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  compareDate: string | null;
  onPick: (date: string) => void;
  onClose: () => void;
  /** Conditions laid over the start (前の台風の日と比べる: the typhoon days, any temperature). */
  preset?: Partial<Conditions>;
}

const TEMP_MODES: { id: TempMode; label: string }[] = [
  { id: "any", label: "問わない" },
  { id: "ge", label: "以上" },
  { id: "le", label: "以下" },
  { id: "range", label: "範囲" },
];
const RAIN_MODES: { id: RainMode; label: string }[] = [
  { id: "dry", label: "降らない" },
  { id: "wet", label: "降る" },
  { id: "any", label: "問わない" },
];
/** The table lists this many days at most. */
const SHOWN = 60;

const t1 = (v: number) => v.toFixed(1);

function tempText(c: TempCondition): string {
  if (c.mode === "ge") return `${t1(c.lo)}℃ 以上`;
  if (c.mode === "le") return `${t1(c.hi)}℃ 以下`;
  if (c.mode === "range") return `${t1(c.lo)} – ${t1(c.hi)}℃`;
  return "問わない";
}

function rainText(c: Conditions["rain"]): string {
  if (c.mode === "any") return "問わない";
  const parts = PARTS.filter((p) => c.parts.includes(p.id));
  const where = parts.length === PARTS.length ? "一日中" : parts.map((p) => p.label).join("・") + "に";
  const strength = c.mode === "wet" && c.strength ? RAIN_STRENGTHS.find((x) => x.mm === c.strength) : null;
  if (strength) return `${parts.length === PARTS.length ? "" : where}${strength.label}`;
  return where + (c.mode === "dry" ? "降らない" : "降る");
}

/** The period in dates: 「'23/5/18〜'26/5/16」, or 「11/2〜11/30（'23・'24・'25）」 when it is a stretch a year. */
function periodDates(origin: string, c: Conditions, today: string): string {
  const st = periodStretches(origin, c, today);
  if (!st.length) return "";
  const ymd = (d: string) => `'${d.slice(2, 4)}/${+d.slice(5, 7)}/${+d.slice(8)}`;
  const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
  if (st.length === 1) return `${ymd(st[0].from)}〜${ymd(st[0].to)}`;
  // The same stretch each year (it may cross the year's end): its dates once, then the years.
  return `${md(st[0].from)}〜${md(st[0].to)}（${st.map((x) => `'${x.from.slice(2, 4)}`).join("・")}）`;
}

function periodText(c: Conditions): string {
  const wd = c.weekday === "any" ? "" : "・" + WEEKDAY_FILTERS.find((f) => f.id === c.weekday)!.label;
  return `過去${c.years}年・${SPAN_LABEL[c.span]}${wd}`;
}

type Key = "max" | "min" | "rain" | "typhoon" | "period";

/** One condition: a line with its value; tapping it opens the controls below. */
function Line({
  id,
  label,
  tone,
  value,
  sub,
  off,
  open,
  onToggle,
  children,
}: {
  id: Key;
  label: string;
  tone: string;
  value: string;
  /** A smaller second line under the value (the period in dates). */
  sub?: string;
  off?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`cond-line${open ? " open" : ""}`} data-cond={id}>
      <button className="cond-head" onClick={onToggle} aria-expanded={open}>
        <i className={`cond-bar tone-${tone}`} aria-hidden />
        <span className="cond-label">{label}</span>
        <span className={`cond-value num${off ? " off" : ""}`}>
          {value}
          {sub && <small className="cond-sub">{sub}</small>}
        </span>
        <span className="cond-caret" aria-hidden>
          ›
        </span>
      </button>
      {open && <div className="cond-body">{children}</div>}
    </div>
  );
}

/** 以上 / 以下 move one thumb, 範囲 two. The target's own value is a tick on the track. */
function TempControls({
  label,
  tone,
  cond,
  scale,
  origin,
  onChange,
}: {
  label: string;
  tone: string;
  cond: TempCondition;
  scale: { lo: number; hi: number };
  origin: number | null;
  onChange: (c: TempCondition) => void;
}) {
  const set = (which: "lo" | "hi", v: number) => {
    if (cond.mode !== "range") onChange({ ...cond, [which]: v });
    else if (which === "lo") onChange({ ...cond, lo: Math.min(v, cond.hi) });
    else onChange({ ...cond, hi: Math.max(v, cond.lo) });
  };
  return (
    <>
      <Segmented label={label} options={TEMP_MODES} value={cond.mode} onChange={(mode) => onChange({ ...cond, mode })} />
      {cond.mode !== "any" && (
        <>
          <Slider
            className={`tone-${tone}`}
            min={scale.lo}
            max={scale.hi}
            step={TEMP_STEP}
            fill={[cond.mode === "le" ? scale.lo : cond.lo, cond.mode === "ge" ? scale.hi : cond.hi]}
            ticks={origin != null ? [origin] : undefined}
            thumbs={[
              ...(cond.mode !== "le" ? [{ value: cond.lo, label: `${label}の下限`, onChange: (v: number) => set("lo", v) }] : []),
              ...(cond.mode !== "ge" ? [{ value: cond.hi, label: `${label}の上限`, onChange: (v: number) => set("hi", v) }] : []),
            ]}
          />
          <div className="cond-scale num">
            <span>{scale.lo}℃</span>
            {origin != null && <span>基準 {t1(origin)}℃</span>}
            <span>{scale.hi}℃</span>
          </div>
        </>
      )}
    </>
  );
}

function Face({ store, station, target, compareDate, onPick, preset }: Omit<Props, "onClose">) {
  const originDay = store?.getDay(station, target);
  const originRow = originDay?.row;
  const origin = { date: target, max: num(originRow?.max), min: num(originRow?.min) };
  const [cond, setCond] = useState<Conditions | null>(null);
  // Start from the target's values once they are there.
  useEffect(() => {
    if (!cond && originDay?.state === "ready") setCond({ ...startConditions(originRow), ...preset });
  }, [cond, originDay?.state, originRow, preset]);
  const c = cond ?? { ...startConditions(null), ...preset };
  const set = (patch: Partial<Conditions>) => setCond({ ...c, ...patch });

  const [open, setOpen] = useState<Key | null>(preset?.typhoon && preset.typhoon !== "any" ? "typhoon" : "max");
  const toggle = (k: Key) => setOpen((o) => (o === k ? null : k));

  const today = store?.today ?? "9999-12-31";
  const candidates = useMemo(
    () => candidateDays(target, { years: c.years, span: c.span, weekday: c.weekday }, today),
    [target, c.years, c.span, c.weekday, today],
  );
  // 台風の日 over the candidates' span (the 強風域 only), once the tracks are read.
  const tracks = useTyphoonTracks();
  const typhoonOn = (c.typhoon ?? "any") !== "any";
  const typhoons = useMemo(() => {
    const at = stationLatLon(station);
    if (!Array.isArray(tracks) || !at || !candidates.length) return null;
    return typhoonDaysAt(tracks, at.lat, at.lon, candidates[candidates.length - 1], candidates[0]);
  }, [tracks, station, candidates]);
  // 台風の日だけ: only those days are looked at (and fetched), so 通年 does not fetch every month.
  const looked = useMemo(
    () => (c.typhoon === "only" && typhoons ? candidates.filter((d) => typhoons.get(d)?.gale) : candidates),
    [c.typhoon, typhoons, candidates],
  );
  // Ask for the candidates' months while this sheet is open; withdraw when it closes.
  // While the tracks are still coming for 台風の日だけ, nothing is fetched yet (they choose the days).
  const waitTracks = c.typhoon === "only" && tracks === "loading";
  useEffect(() => {
    store?.prefetch(station, waitTracks ? [] : looked, "conditions", Priority.Ahead);
    return () => store?.prefetch(station, [], "conditions");
  }, [store, station, looked, waitTracks]);

  const result = searchConditions(c, origin, looked, {
    typhoon: (d) => {
      // No copy of the tracks: no day can be told a typhoon day; the line says so.
      if (tracks === "none") return 0;
      if (!typhoons) return typhoonOn ? null : 0;
      const t = typhoons.get(d);
      return t?.gale ? t.storm.number : 0;
    },
    day: (d) => {
      const v = store?.getDay(station, d);
      return v?.state === "ready" ? v.row : v?.state === "error" ? null : undefined;
    },
    hours: (d) => {
      const v = store?.getHours(station, d);
      return v?.state === "ready" ? v.rows : null;
    },
  });
  // Hours only for the rainy days the other conditions let through.
  const wanted = result.hoursWanted.join(",");
  useEffect(() => {
    store?.wantHours(station, wanted ? wanted.split(",") : [], Priority.Ahead, "conditions");
  }, [store, station, wanted]);
  useEffect(() => () => store?.wantHours(station, [], Priority.Ahead, "conditions"), [store, station]);

  // The day picked here, with the one before it to go back to.
  const [picked, setPicked] = useState<{ date: string; before: string | null } | null>(null);
  const pick = (date: string) => {
    if (date === compareDate) return;
    setPicked({ date, before: picked?.before ?? compareDate });
    onPick(date);
  };

  const loading = result.loaded < result.total || result.hoursWanted.length > 0;
  const shown = result.matches.slice(0, SHOWN);

  return (
    <div className="cond-face">
      <p className="cond-origin">
        基準 <DayLabel date={target} />
        {originRow?.type === "forecast" ? "の予報" : ""}
      </p>

      <div className="cond-list">
        <Line id="max" label="最高" tone="hot" value={tempText(c.max)} off={c.max.mode === "any"} open={open === "max"} onToggle={() => toggle("max")}>
          <TempControls label="最高" tone="hot" cond={c.max} scale={tempScale(origin.max, c.max)} origin={origin.max} onChange={(max) => set({ max })} />
        </Line>
        <Line id="min" label="最低" tone="cold" value={tempText(c.min)} off={c.min.mode === "any"} open={open === "min"} onToggle={() => toggle("min")}>
          <TempControls label="最低" tone="cold" cond={c.min} scale={tempScale(origin.min, c.min)} origin={origin.min} onChange={(min) => set({ min })} />
        </Line>
        <Line id="rain" label="雨" tone="rain" value={rainText(c.rain)} off={c.rain.mode === "any"} open={open === "rain"} onToggle={() => toggle("rain")}>
          <Segmented label="雨" options={RAIN_MODES} value={c.rain.mode} onChange={(mode) => set({ rain: { ...c.rain, mode } })} />
          {c.rain.mode === "wet" && (
            <Segmented
              label="強さ（いちばん強い1時間）"
              options={RAIN_STRENGTHS.map((x) => ({
                id: String(x.mm),
                label: x.mm ? (
                  <>
                    {x.label.replace(/雨$/, "")}
                    <small>{x.short}</small>
                  </>
                ) : (
                  "問わない"
                ),
              }))}
              value={String(c.rain.strength ?? 0)}
              onChange={(v) => set({ rain: { ...c.rain, strength: Number(v) } })}
            />
          )}
          {c.rain.mode !== "any" && (
            <div className="seg multi" role="group" aria-label="時間帯（いくつでも）">
              {PARTS.map((p) => {
                const on = c.rain.parts.includes(p.id);
                return (
                  <button
                    key={p.id}
                    aria-pressed={on}
                    onClick={() => {
                      const parts: Part[] = on ? c.rain.parts.filter((x) => x !== p.id) : [...c.rain.parts, p.id];
                      if (parts.length) set({ rain: { ...c.rain, parts } });
                    }}
                  >
                    {p.label}
                    <small>
                      {p.from}–{p.to}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </Line>
        <Line
          id="typhoon"
          label="台風"
          tone="mean"
          value={TYPHOON_FILTERS.find((f) => f.id === (c.typhoon ?? "any"))!.label}
          off={!typhoonOn}
          open={open === "typhoon"}
          onToggle={() => toggle("typhoon")}
        >
          <Segmented<TyphoonFilter>
            label="台風"
            options={TYPHOON_FILTERS}
            value={c.typhoon ?? "any"}
            onChange={(typhoon) =>
              // 台風の日: few days, so the temperatures and rain step aside (問わない); they can be set again.
              set(
                typhoon === "only"
                  ? { typhoon, max: { ...c.max, mode: "any" }, min: { ...c.min, mode: "any" }, rain: { ...c.rain, mode: "any" } }
                  : { typhoon },
              )
            }
          />
          <p className="cond-help">
            台風の日：その日、観測点が台風の強風域に入った日。出典：気象庁（ベストトラック）、判定は Weather Note。
            {tracks === "loading" && typhoonOn ? " 台風の進路を読み込み中…" : ""}
            {tracks === "none" ? " 台風の進路のデータが読めないため、いまは台風で絞り込めません。" : ""}
          </p>
        </Line>
        <Line id="period" label="期間" tone="mean" value={periodText(c)} sub={periodDates(target, c, today)} open={open === "period"} onToggle={() => toggle("period")}>
          <Segmented
            label="何年分"
            options={YEAR_CHOICES.map((y) => ({ id: String(y), label: `過去${y}年` }))}
            value={String(c.years)}
            onChange={(y) => set({ years: Number(y) as Years })}
          />
          <Segmented
            label="季節の幅"
            options={SPAN_CHOICES.map((s) => ({ id: String(s), label: SPAN_LABEL[s] }))}
            value={String(c.span)}
            onChange={(s) => set({ span: (s === "all" ? "all" : Number(s)) as Span })}
          />
          <Segmented<WeekdayFilter> label="曜日" options={WEEKDAY_FILTERS} value={c.weekday} onChange={(weekday) => set({ weekday })} />
        </Line>
      </div>

      <div className="cond-result">
        {/* The result under its own head (#151), the count in it; while fetching, the progress on its right. */}
        <SectionHead
          title={
            <span className="cond-count">
              合う日 <b className="num">{result.matches.length}</b> 日
            </span>
          }
        >
          {loading && (
            <span className="section-note loading">
              取得中 {result.loaded}/{result.total}日{result.hoursWanted.length > 0 && `・時間別 残り${result.hoursWanted.length}日`}
            </span>
          )}
        </SectionHead>
        {result.matches.length === 0 && !loading && (
          <p className="hint">
            {result.loosen
              ? `「${CONDITION_NAME[result.loosen.key]}」をゆるめると最大 ${result.loosen.count} 日あります。`
              : "条件に合う日がありません。期間を広げてください。"}
          </p>
        )}
        {shown.length > 0 && (
          <>
            <div className="cond-table" role="list">
              <div className="cond-fixed">
                <div className="cond-col labels" aria-hidden>
                  <span className="head" />
                  <span>最高</span>
                  <span>最低</span>
                  <span>雨</span>
                  {(c.rain.strength ?? 0) > 0 && c.rain.mode === "wet" && <span>強さ</span>}
                  {typhoonOn && <span>台風</span>}
                </div>
                <div className="cond-col origin">
                  <span className="head">
                    <b className="num">{monthDay(target)}</b>
                    <small>{originRow?.type === "forecast" ? "予報" : "基準"}</small>
                  </span>
                  <span className={origin.max == null ? "num tone-hot" : "num grid tone-hot"}>{origin.max == null ? "—" : t1(origin.max)}</span>
                  <span className={origin.min == null ? "num tone-cold" : "num grid tone-cold"}>{origin.min == null ? "—" : t1(origin.min)}</span>
                  <span className="num tone-rain">{rainCell(num(originRow?.rain) ?? 0, null)}</span>
                  {(c.rain.strength ?? 0) > 0 && c.rain.mode === "wet" && <span className="num tone-rain">{num(originRow?.rainHour) == null ? "—" : num(originRow?.rainHour)!.toFixed(0)}</span>}
                  {typhoonOn && <span className="num">—</span>}
                </div>
              </div>
              {shown.map((m) => (
                <button
                  key={m.date}
                  role="listitem"
                  className={`cond-col day${m.date === compareDate ? " current" : ""}`}
                  aria-pressed={m.date === compareDate}
                  aria-label={`${m.date} 最高${t1(m.max)} 最低${t1(m.min)}`}
                  onClick={() => pick(m.date)}
                >
                  <span className="head">
                    <span className="num">{monthDay(m.date)}</span>
                    <small>
                      {yearMark(m.date)} {weekdayOf(m.date)}
                    </small>
                  </span>
                  <span className="num grid tone-hot">{t1(m.max)}</span>
                  <span className="num grid tone-cold">{t1(m.min)}</span>
                  <span className="num tone-rain">{rainCell(m.rain, m.wet)}</span>
                  {(c.rain.strength ?? 0) > 0 && c.rain.mode === "wet" && <span className="num tone-rain">{m.top == null ? "—" : m.top.toFixed(0)}</span>}
                  {typhoonOn && <span className="num cond-ty">{m.typhoon ? `${m.typhoon}号` : "—"}</span>}
                </button>
              ))}
            </div>
            <p className="cond-note">
              {monthDay(target)}に近い順{result.matches.length > SHOWN ? `（上位${SHOWN}日）` : ""}・押すと比較日に
            </p>
          </>
        )}
      </div>

      {picked && picked.date === compareDate && (
        <div className="cond-toast" role="status">
          <span>
            <DayLabel date={picked.date} year /> を比較日に
          </span>
          {picked.before && (
            <button
              onClick={() => {
                onPick(picked.before!);
                setPicked(null);
              }}
            >
              取り消す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The parts that had rain when known (朝昼), else the day's amount; "—" for a dry day. */
function rainCell(mm: number, wet: Set<Part> | null): string {
  if (wet && wet.size) return PARTS.filter((p) => wet.has(p.id)).map((p) => p.label).join("");
  if (mm >= 0.5) return wet ? "深夜" : mm.toFixed(1);
  return "—";
}

export function ConditionSheet({ onClose, ...props }: Props) {
  return (
    <ModalSheet title="条件から選ぶ" onClose={onClose} className="cond-sheet">
      <Face {...props} />
    </ModalSheet>
  );
}

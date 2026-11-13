// 移り変わり (#101): how the light moves from day to day, in the item 日照 (日照時間と明るさ).
//
// Two views, chosen by what one wants to know (mocks O and P, 2026-11-12):
//   - 時刻で: a chosen clock time — how bright it is then, day by day; the difference with the
//     comparison day said in minutes ("17:00 は去年より 9分ぶん暗い").
//   - 明るさで: a chosen level — when that light begins and ends, morning and evening, and how long.
// The difference is split into the season (where the sun is) and the weather (shared/lightShift.ts).
// The app's line rules hold: the target day solid with filled dots, the comparison dashed with
// rings, forecasts hatched; the clear sky (晴れなら) is a pale wide line, never dashed.
// Clouds: the week reads each hour (as the hours face does); a month or a year reads each day's
// sunshine, so that it needs no hours of 60 or 700 days.

import { useEffect, useMemo, useState } from "react";
import { CLOUD, brightnessIndex, brightnessLevel, dayLights } from "../../shared/brightness";
import { addDays } from "../../shared/dates";
import { type Clouds, dayFactor, lightSpan, luxAtMinute, shiftAt, spanLength, spanShift, weeklyChange, clearClockOf } from "../../shared/lightShift";
import type { WeatherRow } from "../../shared/types";
import { diffDays } from "../compare";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { DATA, LIGHT_LEVELS, lineLook } from "../design/tokens";
import { monthDay } from "../design/format";
import { Chip, ForecastHatch, GraphReadout, Segmented } from "./kit";

type View = "time" | "level";
type Span = "week" | "month" | "year";

const TIMES = [390, 990, 1020, 1050, 1080, 1110]; // 6:30, 16:30 … 18:30
const LEVELS = [
  { lux: 1000, label: "明るい" },
  { lux: 100, label: "薄暗い" },
  { lux: 1, label: "薄明" },
];
const SAVED = "weather-note:light-trend";

const clock = (m: number) => {
  const r = Math.round(m);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};
const hours = (m: number) => {
  const r = Math.round(m);
  return `${Math.floor(r / 60)}時間${r % 60}分`;
};
/** "9分ぶん暗い" / "±0分". */
const minutes = (v: number, plus: string, minus: string) => {
  const r = Math.round(v);
  return r === 0 ? "±0分" : `${Math.abs(r)}分${r > 0 ? plus : minus}`;
};

function loadSaved(): { view: View; span: Span; at: number; lux: number } {
  const fallback = { view: "time" as View, span: "week" as Span, at: 1020, lux: 1000 };
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) ?? "null");
    if (!v) return fallback;
    return {
      view: v.view === "level" ? "level" : "time",
      span: v.span === "month" || v.span === "year" ? v.span : "week",
      at: TIMES.includes(v.at) ? v.at : 1020,
      lux: LEVELS.some((l) => l.lux === v.lux) ? v.lux : 1000,
    };
  } catch {
    return fallback;
  }
}

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  compareDate: string | null;
  today: string;
  height: number;
  onPickDay?: (date: string) => void;
}

export function LightTrend({ store, station, target, compareDate, today, height, onPickDay }: Props) {
  const [saved, setSaved] = useState(loadSaved);
  const { view, span, at, lux } = saved;
  const set = (patch: Partial<typeof saved>) =>
    setSaved((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SAVED, JSON.stringify(next));
      } catch {
        /* private mode: just not remembered */
      }
      return next;
    });

  const offset = compareDate ? diffDays(target, compareDate) : null;
  const days = useMemo(() => {
    if (span === "week") return Array.from({ length: 7 }, (_, i) => addDays(target, i - 3));
    if (span === "month") return Array.from({ length: 31 }, (_, i) => addDays(target, i - 15));
    return Array.from({ length: 53 }, (_, i) => addDays(target, (i - 26) * 7));
  }, [span, target]);
  const partnerOf = (d: string) => (offset == null ? null : addDays(d, offset));

  // The days' data: hours for the week (the table already asks for them), daily rows otherwise.
  useEffect(() => {
    if (!store) return;
    const all = [...days, ...days.map(partnerOf).filter((d): d is string => !!d)];
    // The target and the comparison day always by the hour, so their numbers do not change with the period.
    const pair = [target, compareDate].filter((d): d is string => !!d);
    store.wantHours(station, span === "week" ? all : pair, Priority.Visible, "light-trend");
    store.prefetch(station, all, "light-trend", Priority.Behind);
    return () => {
      store.wantHours(station, [], Priority.Visible, "light-trend");
      store.prefetch(station, [], "light-trend");
    };
  }, [store, station, days, offset, span, target, compareDate]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A day's clouds: its hours in the week, its daily sunshine otherwise; null without data. */
  const cloudsOf = (d: string | null, byHour = span === "week" || d === target || d === compareDate): Clouds | null => {
    if (!d || !store) return null;
    if (byHour) {
      const rows = [...(store.getHours(station, d).rows ?? [])].sort((a, b) => a.n - b.n);
      if (rows.length >= 12) {
        const byHour: (number | null)[] = Array(24).fill(null);
        dayLights(rows, station).forEach((l, i) => (byHour[rows[i].n - 1] = l.factor));
        return byHour;
      }
    }
    const row = store.getDay(station, d).row;
    const sun = row ? (row as WeatherRow & { sun?: unknown }).sun : null;
    return typeof sun === "number" ? dayFactor(sun, d, station) : null;
  };
  const isForecast = (d: string) => d > today || store?.getDay(station, d).row?.type === "forecast";

  const T = { date: target, clouds: cloudsOf(target, true) };
  const C = compareDate ? { date: compareDate, clouds: cloudsOf(compareDate, true) } : null;

  return (
    <div className="light-trend">
      <div className="lt-controls">
        <Segmented<View> label="見方" value={view} onChange={(v) => set({ view: v })} options={[{ id: "time", label: "時刻で" }, { id: "level", label: "明るさで" }]} />
        <Segmented<Span> label="期間" value={span} onChange={(s) => set({ span: s })} options={[{ id: "week", label: "1週間" }, { id: "month", label: "1か月" }, { id: "year", label: "1年" }]} />
      </div>
      <div className="lt-chips">
        {view === "time"
          ? TIMES.map((m) => (
              <Chip key={m} size="sm" on={m === at} onClick={() => set({ at: m })}>
                {clock(m)}
              </Chip>
            ))
          : LEVELS.map((l) => (
              <Chip key={l.lux} size="sm" on={l.lux === lux} onClick={() => set({ lux: l.lux })}>
                {l.label} 以上
              </Chip>
            ))}
      </div>
      {view === "time" ? (
        <TimeView {...{ station, target, compareDate, at, days, partnerOf, cloudsOf, isForecast, height, onPickDay, T, C, span }} />
      ) : (
        <LevelView {...{ station, target, compareDate, lux, days, partnerOf, cloudsOf, isForecast, onPickDay, T, C, span }} />
      )}
      <p className="lt-legend">
        <span><i className="lt-solid" />対象日</span>
        <span><i className="lt-dashed" />比較日</span>
        <span><i className="lt-clear" />晴れなら</span>
        <span><i className="lt-hatch" />予報</span>
      </p>
      <p className="lt-note">
        {span === "week" ? "雲は1時間ごとの日照と降水から。" : "雲は日ごとの日照から（期間が長いので時間ごとは読みません）。"}
        差は「季節（太陽の位置。2日とも晴れとしたときの差）」と「天気（残り）」に分けています。
      </p>
    </div>
  );
}

interface ViewProps {
  station: string;
  target: string;
  compareDate: string | null;
  days: string[];
  partnerOf: (d: string) => string | null;
  cloudsOf: (d: string | null, byHour?: boolean) => Clouds | null;
  isForecast: (d: string) => boolean;
  onPickDay?: (d: string) => void;
  T: { date: string; clouds: Clouds | null };
  C: { date: string; clouds: Clouds | null } | null;
  span: Span;
}

function Headline({ a, b, c, parts, season }: { a: string; b: string; c: string; parts: string[]; season: string }) {
  return (
    <div className="lt-head">
      <p className="lt-head-main">
        {a}
        <b>{b}</b>
        {c}
      </p>
      {parts.length > 0 && (
        <p className="lt-parts">
          {parts.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </p>
      )}
      <p className="lt-season">{season}</p>
    </div>
  );
}

const W = 340;
const X0 = 44;

function TimeView({ station, target, compareDate, at, days, partnerOf, cloudsOf, isForecast, height, onPickDay, T, C, span }: ViewProps & { at: number; height: number }) {
  const luxOf = (d: string | null, clouds: Clouds | null) => (d && clouds != null ? luxAtMinute(d, at, station, clouds) : null);
  const lt = luxOf(target, T.clouds);
  const lc = C ? luxOf(C.date, C.clouds) : null;
  const shift = C && T.clouds != null && C.clouds != null ? shiftAt(at, { date: target, clouds: T.clouds }, { date: C.date, clouds: C.clouds }, station) : null;
  const week = (() => {
    const s = shiftAt(at, { date: target, clouds: 1 }, { date: addDays(target, -7), clouds: 1 }, station);
    return s ? s.season : null;
  })();
  const eqT = lt != null ? clearClockOf(target, lt, at, station) : null;
  const eqC = lc != null ? clearClockOf(target, lc, at, station) : null;
  const name = (l: number | null) => (l == null ? "—" : brightnessLevel(brightnessIndex(l)).label);
  const who = compareDate ? "比較日" : "";

  // The graph: brightness levels behind, one column per day.
  const H = Math.max(180, Math.min(300, height - 40));
  const top = 8, bottom = top + H, plotW = W - X0 - 4;
  const n = days.length;
  const xOf = (i: number) => X0 + ((i + 0.5) / n) * plotW;
  const yOf = (l: number) => bottom - ((Math.log10(Math.min(1e5, Math.max(0.01, l))) + 2) / 7) * H;
  const edges = [0.01, 1, 100, 1000, 10000, 50000, 1e5];
  const pts = (f: (d: string) => number | null) =>
    days
      .map((d, i) => {
        const v = f(d);
        return v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
      })
      .filter(Boolean);
  const path = (p: (string | null)[]) => (p.length ? `M${p.join("L")}` : "");
  const clearP = path(pts((d) => luxAtMinute(d, at, station)));
  const targetP = path(pts((d) => luxOf(d, cloudsOf(d))));
  const compareP = compareDate ? path(pts((d) => luxOf(partnerOf(d), cloudsOf(partnerOf(d))))) : "";
  const firstForecast = days.findIndex((d) => isForecast(d));
  const small = span !== "week";
  const ti = days.indexOf(target);

  return (
    <>
      <Headline
        a={`${clock(at)} は ${compareDate ? "比較日より " : ""}`}
        b={shift ? `${Math.abs(Math.round(shift.total))}分ぶん` : "—"}
        c={shift ? (Math.round(shift.total) === 0 ? " 同じ明るさ" : shift.total > 0 ? " 暗い" : " 明るい") : ""}
        parts={shift ? [`季節 ${minutes(shift.season, "暗く", "明るく")}`, `天気 ${minutes(shift.weather, "暗く", "明るく")}`] : []}
        season={week != null ? `季節の変わる速さ：${clock(at)} は1週間で ${minutes(week, "ぶん暗く", "ぶん明るく")}（晴れなら）` : ""}
      />
      <GraphReadout
        title={monthDay(target)}
        unit=""
        rows={[
          { key: "level", label: `${clock(at)} の明るさ`, a: name(lt), b: compareDate ? name(lc) : "—", diff: shift ? minutes(shift.total, "暗", "明") : "" },
          { key: "eq", label: "晴れた日の何時", a: eqT != null ? clock(eqT) : "—", b: compareDate && eqC != null ? clock(eqC) : "—", diff: shift ? minutes(shift.total, "遅", "早") : "" },
        ]}
      />
      <svg className="lt-chart" width="100%" viewBox={`0 0 ${W} ${bottom + 34}`} role="img" aria-label={`${clock(at)}の明るさの移り変わり${who ? "、対象日と比較日" : ""}`}>
        <defs>
          <ForecastHatch id="lt-hatch" />
        </defs>
        {edges.slice(0, -1).map((lo, i) => (
          <g key={lo}>
            <rect x={X0} y={yOf(edges[i + 1])} width={plotW} height={yOf(lo) - yOf(edges[i + 1])} fill={LIGHT_LEVELS[i]} opacity={0.38} />
            {yOf(lo) - yOf(edges[i + 1]) > 14 && (
              <text x={X0 - 4} y={(yOf(lo) + yOf(edges[i + 1])) / 2 + 3.5} className="lt-axis" textAnchor="end">
                {["暗い", "薄明", "薄暗い", "明るい", "とても", "日差し"][i]}
              </text>
            )}
          </g>
        ))}
        {firstForecast >= 0 && <rect x={X0 + (firstForecast / n) * plotW} y={top} width={plotW - (firstForecast / n) * plotW} height={H} fill="url(#lt-hatch)" />}
        {ti >= 0 && <rect x={X0 + (ti / n) * plotW + 1} y={top} width={plotW / n - 2} height={H} className="lt-today" rx={4} />}
        <path d={clearP} className="lt-clear-line" />
        {compareP && <path d={compareP} fill="none" {...lineLook("compare", DATA.sun)} />}
        <path d={targetP} fill="none" {...lineLook("target", DATA.sun)} />
        {days.map((d, i) => {
          const v = luxOf(d, cloudsOf(d));
          const p = partnerOf(d);
          const vc = compareDate ? luxOf(p, cloudsOf(p)) : null;
          return (
            <g key={d} onClick={() => onPickDay?.(d)}>
              {vc != null && <circle cx={xOf(i)} cy={yOf(vc)} r={small ? 1.6 : 3.2} fill="var(--surface-base)" stroke={DATA.sun} strokeWidth={1.4} />}
              {v != null && <circle cx={xOf(i)} cy={yOf(v)} r={small ? 1.8 : 3.6} fill={DATA.sun} />}
              <rect x={X0 + (i / n) * plotW} y={top} width={plotW / n} height={H} fill="transparent" />
            </g>
          );
        })}
        <DateTicks days={days} partnerOf={partnerOf} target={target} y={bottom + 14} xOf={xOf} span={span} />
      </svg>
    </>
  );
}

function DateTicks({ days, partnerOf, target, y, xOf, span }: { days: string[]; partnerOf: (d: string) => string | null; target: string; y: number; xOf: (i: number) => number; span: Span }) {
  return (
    <g className="lt-dates">
      {days.map((d, i) => {
        const ti = days.indexOf(target);
        const show = span === "week" || d === target || (span === "month" ? i % 5 === 0 && Math.abs(i - ti) > 2 : d.slice(8) <= "14" && d.slice(8) > "07" && Math.abs(i - ti) > 2);
        if (!show) return null;
        const label = span === "year" && d !== target ? `${Number(d.slice(5, 7))}月` : monthDay(d);
        const p = partnerOf(d);
        return (
          <g key={d}>
            <text x={xOf(i)} y={y} textAnchor="middle" className={d === target ? "lt-date on" : "lt-date"}>
              {label}
            </text>
            {span === "week" && p && (
              <text x={xOf(i)} y={y + 14} textAnchor="middle" className="lt-date sub">
                {monthDay(p)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function LevelView({ station, target, compareDate, lux, days, partnerOf, cloudsOf, isForecast, onPickDay, T, C, span }: ViewProps & { lux: number }) {
  const level = LEVELS.find((l) => l.lux === lux)!;
  const spanOf = (d: string | null, clouds: Clouds | null) => (d && clouds != null ? lightSpan(d, lux, station, clouds, span === "week" ? 1 : 2) : null);
  const st = spanOf(target, T.clouds);
  const sc = C ? spanOf(C.date, C.clouds) : null;
  const shift = C && T.clouds != null && C.clouds != null ? spanShift(lux, { date: target, clouds: T.clouds }, { date: C.date, clouds: C.clouds }, station) : null;
  const rate = weeklyChange(target, lux, station, addDays);

  // Rows: one per day; two calendars, morning and evening, coloured by the target day's light.
  const rows = days.map((d) => {
    const p = partnerOf(d);
    const ct = cloudsOf(d), cc = cloudsOf(p);
    return { d, p, ct, t: spanOf(d, ct), clear: lightSpan(d, lux, station, CLOUD.clear, span === "week" ? 1 : 2), c: compareDate ? spanOf(p, cc) : null };
  });
  const all = rows.flatMap((r) => [r.t, r.clear, r.c].filter((s): s is NonNullable<typeof s> => !!s));
  const win = (k: "start" | "end") => {
    const vs = all.map((s) => s[k]);
    const stepM = span === "year" ? 60 : 10;
    return vs.length ? [Math.floor((Math.min(...vs) - 15) / stepM) * stepM, Math.ceil((Math.max(...vs) + 15) / stepM) * stepM] : [k === "start" ? 300 : 960, k === "start" ? 480 : 1140];
  };
  const panels = [
    { x: X0, w: 116, k: "start" as const, title: "朝（明るくなる）", win: win("start") },
    { x: X0 + 126, w: 116, k: "end" as const, title: "夕方（暗くなる）", win: win("end") },
  ];
  const rowH = span === "week" ? 24 : span === "month" ? 8 : 6;
  const gap = span === "week" ? 3 : 1;
  const top = 30;
  const yOf = (i: number) => top + i * (rowH + gap);
  const bottom = yOf(rows.length);
  const ti = days.indexOf(target);

  return (
    <>
      <Headline
        a={`${level.label}時間は ${compareDate ? "比較日より " : ""}`}
        b={shift ? `${Math.abs(Math.round(shift.total))}分` : st ? hours(spanLength(st)) : "—"}
        c={shift ? (Math.round(shift.total) === 0 ? " 同じ" : shift.total < 0 ? " 短い" : " 長い") : ""}
        parts={shift ? [`季節 ${minutes(shift.season, "長く", "短く")}`, `天気 ${minutes(shift.weather, "長く", "短く")}`, `朝 ${minutes(shift.start, "遅く", "早く")}・夕方 ${minutes(shift.end, "遅く", "早く")}`] : []}
        season={rate ? `季節の変わる速さ：${level.label}時間は1週間で ${minutes(rate.length, "長く", "短く")}（朝 ${minutes(rate.start, "遅く", "早く")}・夕方 ${minutes(rate.end, "遅く", "早く")}、晴れなら）` : ""}
      />
      <GraphReadout
        title={monthDay(target)}
        unit=""
        rows={[
          { key: "start", label: "はじまり", a: st ? clock(st.start) : "—", b: sc ? clock(sc.start) : "—", diff: shift ? minutes(shift.start, "遅", "早") : "" },
          { key: "end", label: "おわり", a: st ? clock(st.end) : "—", b: sc ? clock(sc.end) : "—", diff: shift ? minutes(shift.end, "遅", "早") : "" },
          { key: "len", label: "長さ", a: st ? clock(spanLength(st)) : "—", b: sc ? clock(spanLength(sc)) : "—", diff: shift ? minutes(shift.total, "長", "短") : "" },
        ]}
      />
      <svg className="lt-chart" width="100%" viewBox={`0 0 ${W} ${bottom + 8}`} role="img" aria-label={`「${level.label}」以上の時間の移り変わり`}>
        <defs>
          <ForecastHatch id="lt-hatch2" />
        </defs>
        {panels.map((pn) => {
          const [s0, s1] = pn.win;
          const stepM = s1 - s0 > 120 ? 10 : 5;
          const cells = Math.round((s1 - s0) / stepM);
          const cw = pn.w / cells;
          const xm = (m: number) => pn.x + ((Math.min(s1, Math.max(s0, m)) - s0) / (s1 - s0)) * pn.w;
          const tick = s1 - s0 > 240 ? 120 : s1 - s0 > 90 ? 60 : 30;
          const line = (f: (r: (typeof rows)[number]) => number | null) => {
            const p = rows.map((r, i) => {
              const v = f(r);
              return v == null ? null : `${xm(v).toFixed(1)},${(yOf(i) + rowH / 2).toFixed(1)}`;
            });
            return p.filter(Boolean).length ? `M${p.filter(Boolean).join("L")}` : "";
          };
          return (
            <g key={pn.k}>
              <text x={pn.x + pn.w / 2} y={10} textAnchor="middle" className="lt-panel">
                {pn.title}
              </text>
              {Array.from({ length: Math.floor((s1 - s0) / tick) + 1 }, (_, j) => Math.ceil(s0 / tick) * tick + j * tick)
                .filter((m) => m <= s1 && (pn.k === "start" ? xm(m) < pn.x + pn.w - 12 : xm(m) > pn.x + 12))
                .map((m) => (
                  <text key={m} x={xm(m)} y={24} textAnchor="middle" className="lt-axis">
                    {clock(m)}
                  </text>
                ))}
              {rows.map((r, i) =>
                Array.from({ length: cells }, (_, q) => {
                  const m = s0 + q * stepM + stepM / 2;
                  const v = luxAtMinute(r.d, m, station, r.ct ?? CLOUD.clear);
                  return <rect key={`${i}-${q}`} x={pn.x + q * cw} y={yOf(i)} width={cw + 0.3} height={rowH} fill={LIGHT_LEVELS[Math.min(5, Math.floor(brightnessIndex(v)))]} opacity={v >= lux ? 1 : 0.35} />;
                }),
              )}
              {rows.map((r, i) => (isForecast(r.d) ? <rect key={`h${i}`} x={pn.x} y={yOf(i)} width={pn.w} height={rowH} fill="url(#lt-hatch2)" /> : null))}
              <path d={line((r) => r.clear?.[pn.k] ?? null)} className="lt-clear-line" />
              {compareDate && <path d={line((r) => r.c?.[pn.k] ?? null)} fill="none" {...lineLook("compare", DATA.sun)} />}
              <path d={line((r) => (r.ct != null ? (r.t?.[pn.k] ?? null) : null))} fill="none" {...lineLook("target", DATA.sun)} />
              {span === "week" &&
                rows.map((r, i) => (
                  <g key={`m${i}`}>
                    {r.c && <circle cx={xm(r.c[pn.k])} cy={yOf(i) + rowH / 2} r={3} fill="var(--surface-base)" stroke={DATA.sun} strokeWidth={1.4} />}
                    {r.t && r.ct != null && <circle cx={xm(r.t[pn.k])} cy={yOf(i) + rowH / 2} r={3.4} fill={DATA.sun} />}
                  </g>
                ))}
            </g>
          );
        })}
        <text x={X0 + 278} y={10} textAnchor="middle" className="lt-panel">
          長さ
        </text>
        {rows.map((r, i) => {
          const show = span === "week" || r.d === target || (span === "month" ? i % 5 === 0 && Math.abs(i - ti) > 1 : r.d.slice(8) <= "07" && Math.abs(i - ti) > 2);
          const y = yOf(i) + rowH / 2;
          return (
            <g key={r.d} onClick={() => onPickDay?.(r.d)}>
              <rect x={0} y={yOf(i)} width={W} height={rowH} fill="transparent" />
              {show && (
                <text x={X0 - 4} y={y + 3.5} textAnchor="end" className={r.d === target ? "lt-date on" : "lt-date"}>
                  {span === "year" && r.d !== target ? `${Number(r.d.slice(5, 7))}月` : monthDay(r.d)}
                </text>
              )}
              {span === "week" && (
                <>
                  <text x={X0 + 278} y={y - 1} textAnchor="middle" className={r.d === target ? "lt-len on" : "lt-len"}>
                    {r.t && r.ct != null ? clock(spanLength(r.t)) : r.clear ? clock(spanLength(r.clear)) : "—"}
                  </text>
                  {r.c && (
                    <text x={X0 + 278} y={y + 10} textAnchor="middle" className="lt-len sub">
                      {clock(spanLength(r.c))}
                    </text>
                  )}
                </>
              )}
              {span !== "week" && (r.ct != null ? r.t : r.clear) && (
                <rect x={X0 + 252} y={yOf(i)} width={Math.max(1, ((spanLength(r.ct != null ? r.t : r.clear) - 300) / 600) * 50)} height={rowH} fill={DATA.sun} opacity={r.d === target ? 1 : r.ct != null ? 0.55 : 0.25} />
              )}
            </g>
          );
        })}
        {ti >= 0 && <rect x={2} y={yOf(ti) - gap / 2 - 0.5} width={W - 4} height={rowH + gap + 1} className="lt-today" rx={4} />}
      </svg>
      {span !== "week" && <p className="lt-note">右の棒は長さ（5時間〜15時間）。</p>}
    </>
  );
}

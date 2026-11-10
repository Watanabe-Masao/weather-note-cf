// Weather Note: compare a target day with a comparison day, around a 7-day centre-fixed strip.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays } from "../shared/dates";
import { COMPARE_MODES, type CompareMode, diffDays, matchDate } from "./compare";
import { useWeatherStore } from "./data";
import { METRICS, metricById } from "./metrics";
import { useFeelSettings } from "./feelSettings";
import { useViewState } from "./state";
import { BandMap, bandMapDays } from "./ui/BandMap";
import { FeelContext } from "./ui/FeelBar";
import { Chart } from "./ui/Chart";
import { CompareBoard } from "./ui/CompareBoard";
import { type DayPick, DaySheet } from "./ui/DaySheet";
import { initialDetailMetric } from "./dayDetail";
import { type Detent, GraphSheet, sheetHeights } from "./ui/GraphSheet";
import { Settings } from "./ui/Settings";
import { SimilarFace } from "./ui/SimilarFace";

const PREFETCH_IDLE_MS = 1_000;
const PREFETCH_RADIUS = 14;

/** The graph fills the sheet: its height minus the tabs, notes and legend. */
function chartHeight(sheet: number, m: { forecastOnly?: boolean; emptyNote?: string; spread?: string }) {
  const chrome = 136 + (m.forecastOnly || m.emptyNote ? 22 : 0) + (m.spread ? 54 : 0);
  // With the spread rows the plot needs more room; the sheet scrolls if it is short.
  return Math.round(Math.min(480, Math.max(m.spread ? 220 : 150, sheet - chrome)));
}

export function App() {
  const store = useWeatherStore();
  const { view, today: startToday, last, bounds, compareDate, direction, moveTarget, moveCompare, setLinked, setMode, pickCompare, set } =
    useViewState();
  const today = store?.today ?? startToday;
  const [detent, setDetent] = useState<Detent>("mid");
  const [full, setFull] = useState(false);
  const [settings, setSettings] = useState(false);
  const metric = metricById(view.metric);
  const feel = useFeelSettings(view.station, view.sun);
  const feelSettings = feel.settings;
  const [face, setFace] = useState<"chart" | "bands" | "similar">("chart");
  const [dayPick, setDayPick] = useState<DayPick | null>(null);


  // Tell the store what is on screen (both sides, so neither stays empty).
  useEffect(() => {
    store?.setView(view.station, [view.target, compareDate].filter((d): d is string => !!d), direction);
  }, [store, view.station, view.target, compareDate, direction]);

  // Once the screen is still, fetch the other comparison rules' days quietly.
  useEffect(() => {
    if (!store) return;
    const t = setTimeout(() => {
      const days = new Set<string>();
      for (const { mode } of COMPARE_MODES) {
        if (mode === "custom" || mode === view.mode) continue;
        for (let n = -PREFETCH_RADIUS; n <= PREFETCH_RADIUS; n++) {
          const d = matchDate(addDays(view.target, n), mode);
          if (d) days.add(d);
        }
      }
      store.prefetch(view.station, [...days]);
    }, PREFETCH_IDLE_MS);
    return () => clearTimeout(t);
  }, [store, view.station, view.target, view.mode]);

  const partner = useMemo(
    () => (d: string) => (view.linked ? matchDate(d, view.mode, view.offset) : addDays(view.compare, diffDays(view.target, d))),
    [view.linked, view.mode, view.offset, view.compare, view.target],
  );

  // The feel row wants hourly data for the visible days, after the daily values (low priority).
  useEffect(() => {
    if (!store) return;
    // Temperature: for the feel row. Radiation: the day's total is added up from the hours.
    if (view.metric !== "temp" && !metric.needsHours) return store.wantHours(view.station, [], 2, "table");
    const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => addDays(view.target, n));
    const partners = days.map(partner).filter((d): d is string => !!d);
    store.wantHours(view.station, [...days, ...partners], 2, "table");
  }, [store, view.station, view.target, view.metric, metric, partner]);

  const sheetDetent = full ? "min" : detent;

  // The 時間帯 face wants hourly data only while it can be seen.
  useEffect(() => {
    if (!store) return;
    const open = face === "bands" && sheetDetent !== "min";
    store.wantHours(view.station, open ? bandMapDays(view.target, partner) : [], 1, "sheet");
  }, [store, face, sheetDetent, view.station, view.target, partner]);

  // Keep the chosen item in view in the scrolling chip row (also after a reload).
  const metricsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = metricsRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !chip) return;
    const left = chip.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollTo({ left: left - 8, behavior: "smooth" });
  }, [view.metric]);

  // Measure the space under the comparison table: that is the sheet's middle height.
  const boardRef = useRef<HTMLDivElement>(null);
  const [spaceBelow, setSpaceBelow] = useState(320);
  useLayoutEffect(() => {
    const el = boardRef.current!;
    const measure = () => setSpaceBelow(window.innerHeight - (el.offsetTop + el.offsetHeight) - 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [full]);
  const heights = sheetHeights(spaceBelow);

  return (
    <div className={full ? "app full" : "app"} style={{ paddingBottom: heights[sheetDetent] + 12 }}>
      {!full && (
        <header className="app-head">
          <h1>Weather Note</h1>
        </header>
      )}

      <div className="controls">
        <select
          className="chip mode"
          value={view.mode}
          onChange={(e) => setMode(e.target.value as CompareMode)}
          aria-label="比較のしかた"
        >
          {COMPARE_MODES.map((m) => (
            <option key={m.mode} value={m.mode}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className={view.linked ? "chip on" : "chip"} onClick={() => setLinked(!view.linked)} aria-pressed={view.linked}>
          {view.linked ? "連動" : "個別"}
        </button>
        <button className="chip icon" onClick={() => setSettings(true)} aria-label="設定">
          ⚙
        </button>
        <button className="chip icon" onClick={() => setFull(!full)} aria-label={full ? "縮小" : "全画面"}>
          {full ? "⤡" : "⤢"}
        </button>
      </div>

      <div className="metrics" role="tablist" ref={metricsRef}>
        {METRICS.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={m.id === view.metric}
            className={m.id === view.metric ? "chip on" : "chip"}
            onClick={() => set("metric", m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div ref={boardRef}>
        <FeelContext.Provider value={feelSettings}>
          <CompareBoard
            store={store}
            view={view}
            today={today}
            last={last}
            bounds={bounds}
            compareDate={compareDate}
            metric={metric}
            moveTarget={moveTarget}
            moveCompare={moveCompare}
            onToggleSun={() => set("sun", !view.sun)}
            onOpenDay={(date, other) => setDayPick({ date, other })}
          />
        </FeelContext.Provider>
      </div>

      <FeelContext.Provider value={feelSettings}>
        <GraphSheet
          title={face === "chart" ? "比較グラフ" : face === "bands" ? "時間帯" : "似た日"}
          detent={sheetDetent}
          heights={heights}
          onDetent={setDetent}
          tabs={
            <div className="sheet-tabs" role="tablist">
              {(
                [
                  ["chart", "比較グラフ"],
                  ["bands", "時間帯"],
                  ["similar", "似た日"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={face === id}
                  className={face === id ? "on" : ""}
                  onClick={() => {
                    setFace(id);
                    if (sheetDetent === "min") setDetent("mid");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {face === "chart" ? (
            <Chart
              store={store}
              station={view.station}
              target={view.target}
              partner={partner}
              metric={metric}
              height={chartHeight(heights[sheetDetent], metric)}
            />
          ) : face === "bands" ? (
            <BandMap store={store} station={view.station} target={view.target} partner={partner} />
          ) : (
            <SimilarFace store={store} station={view.station} target={view.target} compareDate={compareDate} onPick={pickCompare} />
          )}
        </GraphSheet>
      </FeelContext.Provider>

      {dayPick && (
        <FeelContext.Provider value={feelSettings}>
          <DaySheet
            store={store}
            station={view.station}
            pick={dayPick}
            initialMetric={initialDetailMetric(view.metric)}
            today={today}
            onClose={() => setDayPick(null)}
          />
        </FeelContext.Provider>
      )}

      {settings && (
        <Settings
          store={store}
          station={view.station}
          onStation={(id) => set("station", id)}
          feel={feel}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}

// Weather Note: compare a target day with a comparison day, around a 7-day centre-fixed strip.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays } from "../shared/dates";
import { COMPARE_MODES, type CompareMode, diffDays, matchDate } from "./compare";
import { useWeatherStore } from "./data";
import { METRICS, metricById } from "./metrics";
import { useFeelSettings } from "./feelSettings";
import { useViewState } from "./state";
import { FeelContext } from "./ui/FeelBar";
import { Chart } from "./ui/Chart";
import { CompareBoard } from "./ui/CompareBoard";
import { type Detent, GraphSheet, sheetHeights } from "./ui/GraphSheet";
import { Settings } from "./ui/Settings";
import { FeelSheet } from "./ui/FeelSheet";
import { HourFace } from "./ui/HourFace";
import { SimilarSheet } from "./ui/SimilarSheet";

const PREFETCH_IDLE_MS = 1_000;
const PREFETCH_RADIUS = 14;
const SIMILAR = "__similar";

/** The 24-hour graph fills the sheet too: its height minus the tabs, the day line, readout and legend. */
const hourHeight = (sheet: number) => Math.round(Math.min(420, Math.max(170, sheet - 250)));

/** The graph fills the sheet: its height minus the tabs, notes and legend. */
function chartHeight(sheet: number, m: { forecastOnly?: boolean; emptyNote?: string; spread?: string; under?: unknown[] }) {
  const chrome = 136 + (m.forecastOnly || m.emptyNote ? 22 : 0) + (m.spread ? 54 : 0) + (m.under ? 22 : 0);
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
  // The sheet shows the chosen item two ways: seven days (日別) or the 24 hours of the day (時間帯).
  const [face, setFace] = useState<"chart" | "hours">("chart");
  const [feelMap, setFeelMap] = useState(false);
  const [similar, setSimilar] = useState(false);

  /** A column tap: that day becomes the selected day and the sheet shows the two days side by side, hour by hour. */
  const openDay = (date: string, other: string | null, side: "target" | "compare") => {
    if (side === "target") moveTarget(date);
    else if (view.linked && other) moveTarget(other);
    else moveCompare(date);
    setFace("hours");
    setFull(false);
    // A tap asks to see the day: open high enough for the summary and the graph together.
    setDetent("max");
  };


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

  // The 時間帯 face wants the two days' hours, first, while it can be seen.
  useEffect(() => {
    if (!store) return;
    const open = face === "hours" && sheetDetent !== "min";
    const days = [view.target, compareDate].filter((d): d is string => !!d);
    store.wantHours(view.station, open ? days : [], 0, "sheet");
  }, [store, face, sheetDetent, view.station, view.target, compareDate]);

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
  // The sheet's highest position stops just under the item chips, so they stay usable.
  const [chipsBottom, setChipsBottom] = useState(0);
  useLayoutEffect(() => {
    const el = metricsRef.current;
    if (!el) return;
    const measure = () => setChipsBottom(el.getBoundingClientRect().bottom + window.scrollY);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [full]);
  const heights = sheetHeights(spaceBelow, window.innerHeight, chipsBottom);

  return (
    <div className={full ? "app full" : "app"} style={{ paddingBottom: heights[sheetDetent] + 12 }}>
      {!full && (
        <header className="app-head">
          <h1>Weather Note</h1>
          <button className="chip icon" onClick={() => setSettings(true)} aria-label="設定">
            ⚙
          </button>
        </header>
      )}

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
            onOpenDay={openDay}
            onOpenFeel={() => setFeelMap(true)}
            targetExtra={
              <button className="chip icon mini" onClick={() => setFull(!full)} aria-label={full ? "縮小" : "表に集中"}>
                {full ? "⤡" : "⤢"}
              </button>
            }
            compareExtra={
              <>
                <button
                  className={view.linked ? "chip mini on" : "chip mini"}
                  onClick={() => setLinked(!view.linked)}
                  aria-pressed={view.linked}
                  title={view.linked ? "比較日は対象日に付いて動きます（タップで個別）" : "比較日は別に動きます（タップで連動）"}
                >
                  {view.linked ? "連動" : "個別"}
                </button>
                <select
                  className="chip mini mode"
                  value={view.mode}
                  onChange={(e) => {
                    // 似た日 is a way of choosing the day, not a rule: it opens the list and the menu stays as it was.
                    if (e.target.value === SIMILAR) setSimilar(true);
                    else setMode(e.target.value as CompareMode);
                  }}
                  aria-label="比較のしかた"
                >
                  {COMPARE_MODES.map((m) => (
                    <option key={m.mode} value={m.mode}>
                      {m.label}
                    </option>
                  ))}
                  <option value={SIMILAR}>似た日から選ぶ…</option>
                </select>
              </>
            }
          />
        </FeelContext.Provider>
      </div>

      <FeelContext.Provider value={feelSettings}>
        <GraphSheet
          title={face === "chart" ? "日別" : "時間帯"}
          detent={sheetDetent}
          heights={heights}
          onDetent={setDetent}
          scrimTop={chipsBottom}
          tabs={
            // The item chips stay visible above the sheet, so the sheet only says what it shows.
            <div className="sheet-head">
              {face === "hours" ? (
                <>
                  <button className="chip back" onClick={() => setFace("chart")} aria-label="日別に戻る">
                    ‹ 日別
                  </button>
                  <span className="sheet-head-title">{`${+view.target.slice(5, 7)}/${+view.target.slice(8)} の時間帯`}</span>
                </>
              ) : (
                <>
                  <span className="sheet-head-title">日別</span>
                  <span className="sheet-head-hint">日をタップで時間帯 ›</span>
                </>
              )}
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
              onPickDay={(d) => openDay(d, partner(d), "target")}
            />
          ) : (
            <HourFace
              store={store}
              station={view.station}
              target={view.target}
              compareDate={compareDate}
              metric={view.metric}
              today={today}
              height={hourHeight(heights[sheetDetent])}
            />
          )}
        </GraphSheet>
      </FeelContext.Provider>

      {feelMap && (
        <FeelContext.Provider value={feelSettings}>
          <FeelSheet store={store} station={view.station} target={view.target} partner={partner} onClose={() => setFeelMap(false)} />
        </FeelContext.Provider>
      )}

      {similar && (
        <SimilarSheet
          store={store}
          station={view.station}
          target={view.target}
          compareDate={compareDate}
          onPick={pickCompare}
          onClose={() => setSimilar(false)}
        />
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

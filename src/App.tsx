// Weather Note: compare a target day with a comparison day, around a 7-day centre-fixed strip.

import { CalendarModal, type CalendarSide } from "./ui/CalendarModal";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, FIRST_DAY } from "../shared/dates";
import {
  COMPARE_MODES,
  type CompareMode,
  diffDays,
  matchDate,
} from "./compare";
import { useWeatherStore } from "./data";
import { METRICS, metricById } from "./metrics";
import { useFeelSettings } from "./feelSettings";
import { BetaContext, useBetaSettings } from "./beta/settings";
import { useAutoSync } from "./beta/useSync";
import { useViewState } from "./state";
import { FeelContext } from "./ui/FeelBar";
import { Chart } from "./ui/Chart";
import { CompareBoard } from "./ui/CompareBoard";
import {
  ChevronIcon,
  ExpandIcon,
  GearIcon,
  LinkIcon,
  ShrinkIcon,
} from "./ui/icons";
import { StatusBar } from "./ui/StatusBar";
import { IconButton } from "./ui/kit";
import { type Detent, GraphSheet, sheetHeights } from "./ui/GraphSheet";
import { Settings } from "./ui/Settings";
import { FeelSheet } from "./ui/FeelSheet";
import { HourFace } from "./ui/HourFace";
import { SimilarSheet } from "./ui/SimilarSheet";

const PREFETCH_IDLE_MS = 1_000;
const PREFETCH_RADIUS = 14;
const SIMILAR = "__similar";

/** The 24-hour graph fills the sheet too: its height minus the tabs, the day line, readout and legend. */
const hourHeight = (sheet: number) =>
  Math.round(Math.min(420, Math.max(170, sheet - 250)));

/** The graph fills the sheet: its height minus the tabs, notes and legend. */
function chartHeight(
  sheet: number,
  m: {
    forecastOnly?: boolean;
    emptyNote?: string;
    spread?: string;
    under?: unknown[];
  },
) {
  const chrome =
    136 +
    (m.forecastOnly || m.emptyNote ? 22 : 0) +
    (m.spread ? 54 : 0) +
    (m.under ? 22 : 0);
  // With the spread rows the plot needs more room; the sheet scrolls if it is short.
  return Math.round(
    Math.min(480, Math.max(m.spread ? 220 : 150, sheet - chrome)),
  );
}

export function App() {
  const store = useWeatherStore();
  const [calendar, setCalendar] = useState<CalendarSide | null>(null);
  const {
    view,
    today: startToday,
    last,
    bounds,
    compareDate,
    direction,
    moveTarget,
    moveCompare,
    setLinked,
    setMode,
    pickCompare,
    set,
  } = useViewState();
  const today = store?.today ?? startToday;
  const [detent, setDetent] = useState<Detent>("mid");
  const [full, setFull] = useState(false);
  const [settings, setSettings] = useState(false);
  const metric = metricById(view.metric);
  const feel = useFeelSettings(view.station, view.sun);
  const feelSettings = feel.settings;
  const beta = useBetaSettings();
  useAutoSync();
  // The sheet shows the chosen item two ways: seven days (日別) or the 24 hours of the day (時間帯).
  const [face, setFace] = useState<"chart" | "hours">("chart");
  // While a drum moves, the switches that change which days are shown wait (rule: 動いている間).
  const [moving, setMoving] = useState(false);
  const [feelMap, setFeelMap] = useState(false);
  const [similar, setSimilar] = useState(false);

  // How the comparison day is chosen: in the comparison header, and in the sheet head (which covers it when raised).
  const modeSelect = (
    <select
      className="chip sm mode"
      value={view.mode}
      disabled={moving}
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
  );

  /** A column tap: that day becomes the selected day and the sheet shows the two days side by side, hour by hour. */
  const openDay = (
    date: string,
    other: string | null,
    side: "target" | "compare",
  ) => {
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
    store?.setView(
      view.station,
      [view.target, compareDate].filter((d): d is string => !!d),
      direction,
    );
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
    () => (d: string) =>
      view.linked
        ? matchDate(d, view.mode, view.offset)
        : addDays(view.compare, diffDays(view.target, d)),
    [view.linked, view.mode, view.offset, view.compare, view.target],
  );

  // The feel row wants hourly data for the visible days, after the daily values (low priority).
  useEffect(() => {
    if (!store) return;
    // Temperature: for the feel row. Radiation: the day's total is added up from the hours.
    if (view.metric !== "temp" && !metric.needsHours)
      return store.wantHours(view.station, [], 2, "table");
    // The visible week plus the daily graph's buffer (it is drawn beyond the edges for swiping).
    const days = Array.from({ length: 15 }, (_, i) =>
      addDays(view.target, i - 7),
    );
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
    if (
      left < row.scrollLeft ||
      left + chip.offsetWidth > row.scrollLeft + row.clientWidth
    )
      row.scrollTo({ left: left - 8, behavior: "smooth" });
  }, [view.metric]);

  // Measure the space under the comparison table: that is the sheet's middle height.
  const boardRef = useRef<HTMLDivElement>(null);
  const [spaceBelow, setSpaceBelow] = useState(320);
  useLayoutEffect(() => {
    const el = boardRef.current!;
    const measure = () =>
      setSpaceBelow(window.innerHeight - (el.offsetTop + el.offsetHeight) - 8);
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
    const measure = () =>
      setChipsBottom(el.getBoundingClientRect().bottom + window.scrollY);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [full]);
  const heights = sheetHeights(spaceBelow, window.innerHeight, chipsBottom);
  // Overlay sheets open to the same height as the graph sheet at its highest (rule: 重なり順と高さ).
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--sheet-max",
      `${heights.max}px`,
    );
  }, [heights.max]);

  return (
    <div
      className={full ? "app full wide" : "app"}
      style={{ paddingBottom: heights[sheetDetent] + 12 }}
    >
      {!full && (
        <header className="app-head">
          <h1>Weather Note</h1>
          <IconButton label="設定" onClick={() => setSettings(true)}>
            <GearIcon />
          </IconButton>
        </header>
      )}

      <div className="metrics" role="tablist" ref={metricsRef}>
        {METRICS.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={m.id === view.metric}
            className={m.id === view.metric ? "chip item on" : "chip item"}
            onClick={() => set("metric", m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <StatusBar
        store={store}
        station={view.station}
        days={[view.target, compareDate]}
      />

      <div ref={boardRef}>
        <BetaContext.Provider value={beta}>
          <FeelContext.Provider value={feelSettings}>
            <CompareBoard
              onMoving={setMoving}
              onOpenCalendar={setCalendar}
              wide={full}
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
                <IconButton
                  size="sm"
                  label={full ? "表示を戻す" : "表に集中"}
                  onClick={() => setFull(!full)}
                >
                  {full ? <ShrinkIcon /> : <ExpandIcon />}
                </IconButton>
              }
              compareExtra={
                <>
                  {/* The state is shown, with an icon: linked (chain) or separate (broken chain). */}
                  <button
                    className={
                      view.linked
                        ? "chip sm link-toggle on"
                        : "chip sm link-toggle"
                    }
                    onClick={() => setLinked(!view.linked)}
                    disabled={moving}
                    aria-pressed={view.linked}
                    title={
                      view.linked
                        ? "連動中：比較日は対象日に付いて動きます（タップで個別）"
                        : "個別：比較日は別に動きます（タップで連動）"
                    }
                  >
                    <LinkIcon linked={view.linked} />
                    {view.linked ? "連動" : "個別"}
                  </button>
                  {modeSelect}
                </>
              }
            />
          </FeelContext.Provider>
        </BetaContext.Provider>
      </div>

      <BetaContext.Provider value={beta}>
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
                    <button
                      className="back-btn"
                      onClick={() => setFace("chart")}
                      aria-label="日別に戻る"
                    >
                      <ChevronIcon />
                      日別
                    </button>
                    <span className="sheet-head-title">{`${metric.label}の時間帯`}</span>
                    <span className="sheet-head-end">{modeSelect}</span>
                  </>
                ) : (
                  <>
                    <span className="sheet-head-title">{`${metric.label}の日別`}</span>
                    <span className="sheet-head-hint">日をタップで時間帯</span>
                    <span className="sheet-head-end">{modeSelect}</span>
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
                onShiftDays={(n) => moveTarget(addDays(view.target, n))}
                onToggleSun={() => set("sun", !view.sun)}
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
                onStep={(n) => moveTarget(addDays(view.target, n))}
                onToggleSun={() => set("sun", !view.sun)}
                pick={setCalendar}
              />
            )}
          </GraphSheet>
        </FeelContext.Provider>
      </BetaContext.Provider>

      {feelMap && (
        <BetaContext.Provider value={beta}>
          <FeelContext.Provider value={feelSettings}>
            <FeelSheet
              store={store}
              station={view.station}
              target={view.target}
              partner={partner}
              onStep={(n) => moveTarget(addDays(view.target, n))}
              onClose={() => setFeelMap(false)}
            />
          </FeelContext.Provider>
        </BetaContext.Provider>
      )}

      {calendar && (
        <CalendarModal
          side={calendar}
          target={view.target}
          compare={compareDate}
          mode={view.mode}
          min={calendar === "target" ? bounds.min : FIRST_DAY}
          max={calendar === "target" ? bounds.max : last}
          store={store}
          station={view.station}
          today={today}
          partnerOf={partner}
          onTarget={moveTarget}
          onCompare={pickCompare}
          onPreset={setMode}
          onClose={() => setCalendar(null)}
        />
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
        <BetaContext.Provider value={beta}>
          <Settings
            store={store}
            station={view.station}
            onStation={(id) => set("station", id)}
            feel={feel}
            sun={view.sun}
            onSun={(v) => set("sun", v)}
            onClose={() => setSettings(false)}
          />
        </BetaContext.Provider>
      )}
    </div>
  );
}

// Weather Note: compare a target day with a comparison day, around a 7-day centre-fixed strip.

import { AfterAnswer } from "./beta/AfterAnswer";
import { useSeasonDays } from "./feelSeason";
import type { WeatherStore } from "./data/store";
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
import { ReportSheet } from "./beta/ReportSheet";
import { useAccount } from "./account/account";
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
import { ConditionSheet } from "./ui/ConditionSheet";
import { LightTrend } from "./ui/LightTrend";

const PREFETCH_IDLE_MS = 1_000;
const PREFETCH_RADIUS = 14;
const BY_CONDITIONS = "__conditions";

/**
 * The 24-hour graph's height in the sheet: its height minus the tabs, the day line, readout and
 * legend, at most 300 — taller made the readout and the strips under it (明るさと空) scroll out of
 * reach (渡辺さん, 2026-11-13: "縦軸サイズが若干大きすぎる").
 */
const hourHeight = (sheet: number) =>
  Math.round(Math.min(300, Math.max(170, sheet - 330)));

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
  // 記録: from the header at any time, or from a notification (?report=1&n=<when it was due>).
  const [reportFrom, setReportFrom] = useState<{ notifiedAt?: number } | null>(null);
  const [reportSaved, setReportSaved] = useState(false);
  const account = useAccount();
  const metric = metricById(view.metric);
  const feel = useFeelSettings(view.station, view.sun);
  const feelSettings = feel.settings;
  const beta = useBetaSettings();
  useAutoSync(); // who is logged in, and the reports kept in step with the server
  // Opened from a notification: as a URL (the app was closed) or as a message (it was open).
  const [asked, setAsked] = useState<{ notifiedAt?: number } | null>(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("report") !== "1") return null;
    const n = Number(q.get("n"));
    history.replaceState(null, "", location.pathname); // a reload does not open it again
    return { notifiedAt: Number.isFinite(n) && n > 0 ? n : undefined };
  });
  useEffect(() => {
    const onMessage = (e: MessageEvent<{ type?: string; n?: number }>) => e.data?.type === "report" && setAsked({ notifiedAt: e.data.n || undefined });
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  // Waits until the login is known: logged in, the record opens; logged out, the settings (to log in).
  useEffect(() => {
    if (!asked || account.status !== "ready") return;
    if (account.me) setReportFrom(asked);
    else setSettings(true);
    setAsked(null);
  }, [asked, account.status, account.me]);
  useEffect(() => {
    if (!reportSaved) return;
    const t = setTimeout(() => setReportSaved(false), 2500);
    return () => clearTimeout(t);
  }, [reportSaved]);
  // The sheet shows the chosen item two ways: seven days (日別) or the 24 hours of the day (時間帯);
  // 日照 also a third, how the light moves from day to day (移り変わり, LightTrend).
  const [face, setFace] = useState<"chart" | "hours" | "trend">("chart");
  const shownFace = face === "trend" && view.metric !== "light" ? "chart" : face;
  // While a drum moves, the switches that change which days are shown wait (rule: 動いている間).
  const [moving, setMoving] = useState(false);
  const [feelMap, setFeelMap] = useState(false);
  const [conditions, setConditions] = useState(false);

  // How the comparison day is chosen: in the comparison header, and in the sheet head (which covers it when raised).
  const modeSelect = (
    <select
      className="chip sm mode"
      value={view.mode}
      disabled={moving}
      onChange={(e) => {
        // 条件から選ぶ is a way of choosing the day, not a rule: it opens the sheet and the menu stays as it was.
        if (e.target.value === BY_CONDITIONS) setConditions(true);
        else setMode(e.target.value as CompareMode);
      }}
      aria-label="比較のしかた"
    >
      {COMPARE_MODES.map((m) => (
        <option key={m.mode} value={m.mode}>
          {m.label}
        </option>
      ))}
      <option value={BY_CONDITIONS}>条件から選ぶ…</option>
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
          <div className="app-head-actions">
            {account.me && (
              <button className="head-report" onClick={() => setReportFrom({})} aria-label="今の感じ方を記録する">
                {reportSaved ? "記録しました" : "記録"}
              </button>
            )}
            <IconButton label="設定" onClick={() => setSettings(true)}>
              <GearIcon />
            </IconButton>
          </div>
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

      <SeasonDays store={store} station={view.station} dates={[view.target, compareDate]} />
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
            title={shownFace === "chart" ? "日別" : shownFace === "trend" ? "移り変わり" : "時間帯"}
            detent={sheetDetent}
            heights={heights}
            onDetent={setDetent}
            scrimTop={chipsBottom}
            tabs={
              // The item chips stay visible above the sheet, so the sheet only says what it shows.
              <div className="sheet-head">
                {shownFace === "trend" ? (
                  <>
                    <button className="back-btn" onClick={() => setFace("chart")} aria-label="日別に戻る">
                      <ChevronIcon />
                      日別
                    </button>
                    <span className="sheet-head-title">明るさの移り変わり</span>
                    <span className="sheet-head-end">{modeSelect}</span>
                  </>
                ) : shownFace === "hours" ? (
                  <>
                    <button
                      className="back-btn"
                      onClick={() => setFace("chart")}
                      aria-label="日別に戻る"
                    >
                      <ChevronIcon />
                      日別
                    </button>
                    <span className="sheet-head-title">{`${metric.title ?? metric.label}の時間帯`}</span>
                    <span className="sheet-head-end">{modeSelect}</span>
                  </>
                ) : (
                  <>
                    {/* 日照 has a button here too, so its title is the chip's own word (日照), which fits at 360. */}
                    <span className="sheet-head-title">{`${view.metric === "light" ? metric.label : (metric.title ?? metric.label)}の日別`}</span>
                    {view.metric === "light" ? (
                      <button className="chip sm trend-btn" onClick={() => setFace("trend")}>
                        移り変わり
                      </button>
                    ) : (
                      <span className="sheet-head-hint">日をタップで時間帯</span>
                    )}
                    <span className="sheet-head-end">{modeSelect}</span>
                  </>
                )}
              </div>
            }
          >
            {shownFace === "trend" ? (
              <LightTrend
                store={store}
                station={view.station}
                target={view.target}
                compareDate={compareDate}
                today={today}
                height={hourHeight(heights[sheetDetent])}
                onPickDay={(d) => openDay(d, partner(d), "target")}
              />
            ) : shownFace === "chart" ? (
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

      {conditions && (
        <ConditionSheet
          store={store}
          station={view.station}
          target={view.target}
          compareDate={compareDate}
          onPick={pickCompare}
          onClose={() => setConditions(false)}
        />
      )}

      <BetaContext.Provider value={beta}>
        <FeelContext.Provider value={feelSettings}>
          <AfterAnswer />
        </FeelContext.Provider>
      </BetaContext.Provider>

      {reportFrom && (
        <BetaContext.Provider value={beta}>
          <FeelContext.Provider value={feelSettings}>
            <ReportSheet
              store={store}
              station={view.station}
              today={today}
              notifiedAt={reportFrom.notifiedAt}
              onClose={() => setReportFrom(null)}
              onSaved={() => setReportSaved(true)}
            />
          </FeelContext.Provider>
        </BetaContext.Provider>
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

/** Asks the store, quietly, for the 30 days the 従来版 boundaries of the shown days move by (#111). */
function SeasonDays({ store, station, dates }: { store: WeatherStore | null; station: string; dates: (string | null)[] }) {
  useSeasonDays(store, station, dates, "season");
  return null;
}

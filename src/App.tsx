// Weather Note: compare a target day with a comparison day, around a 7-day centre-fixed strip.

import { Brand } from "./ui/Brand";
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
  ItemIcon,
  ExpandIcon,
  GearIcon,
  LinkIcon,
  ShrinkIcon,
} from "./ui/icons";
import { StatusBar } from "./ui/StatusBar";
import { Button, CheckGlyph, IconButton, Segmented } from "./ui/kit";
import { DayDetail } from "./ui/DayDetail";
import { type Detent, GraphSheet, sheetHeights } from "./ui/GraphSheet";
import { MonthReview } from "./ui/MonthReview";
import { Settings } from "./ui/Settings";
import { FeelSheet } from "./ui/FeelSheet";
import { HourFace } from "./ui/HourFace";
import { ConditionSheet } from "./ui/ConditionSheet";
import { TyphoonCard } from "./ui/TyphoonCard";
import { TyphoonSheet } from "./ui/TyphoonSheet";
import { useActiveTyphoons } from "./data/typhoonNow";
import { TyphoonDaysContext, useTyphoonDays } from "./data/typhoonDays";
import type { Conditions } from "../shared/conditions";
import { LightTrend } from "./ui/LightTrend";
import { DaySummaryCard } from "./ui/DaySummaryCard";
import { DaySummaryContext, type DaySummaryAsk } from "./ui/daySummaryPress";

const PREFETCH_IDLE_MS = 1_000;
const PREFETCH_RADIUS = 14;
const BY_CONDITIONS = "__conditions";
/** 前の台風の日と比べる: the typhoon days of five years, all year round (typhoons keep to their season, so a month either side is often empty), any temperature or rain. */
const TYPHOON_PRESET: Partial<Conditions> = {
  typhoon: "only",
  max: { mode: "any", lo: 10, hi: 20 },
  min: { mode: "any", lo: 10, hi: 20 },
  rain: { mode: "any", parts: ["morning", "day", "evening", "night"], strength: 0 },
  years: 5,
  span: "all",
};

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

/** `theme`: only so a change of theme draws everything again (src/main.tsx). */
export function App(_: { theme?: string } = {}) {
  const store = useWeatherStore();
  const [calendar, setCalendar] = useState<CalendarSide | null>(null);
  // 月の振り返り: opened from the calendar's month name; the calendar closes behind it.
  const [monthReview, setMonthReview] = useState<string | null>(null);
  // その日の要約 (#176): a long press on a day's weather picture.
  const [summary, setSummary] = useState<DaySummaryAsk | null>(null);
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
    setSingle,
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
  // 前の台風の日と比べる (TyphoonCard): 条件から選ぶ opened on the typhoon days, any temperature or rain.
  const [conditionsPreset, setConditionsPreset] = useState<Partial<Conditions> | undefined>(undefined);
  const typhoons = useActiveTyphoons();
  // 台風の目安 (#220): opened from its notification (?typhoon=<number>, or a message while open).
  const [typhoonAsked, setTyphoonAsked] = useState<number | null>(() => {
    const n = Number(new URLSearchParams(location.search).get("typhoon"));
    if (!n) return null;
    history.replaceState(null, "", location.pathname);
    return n;
  });
  useEffect(() => {
    const onMessage = (e: MessageEvent<{ type?: string; number?: number }>) => e.data?.type === "typhoon" && e.data.number && setTyphoonAsked(e.data.number);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  // 台風の日 for the table's 台 mark: past days from the best track, today and ahead from JMA's word now.
  const typhoonOn = useTyphoonDays(view.station, today, typhoons);

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
    if (view.single) return moveTarget(date); // 1日: the day is told below the week, no sheet
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
    // 1日モード: the day told below the week wants its hours first, always.
    const open = view.single || (face === "hours" && sheetDetent !== "min");
    const days = [view.target, compareDate].filter((d): d is string => !!d);
    store.wantHours(view.station, open ? days : [], 0, "sheet");
  }, [store, face, sheetDetent, view.station, view.target, compareDate, view.single]);

  // Keep the chosen item in view in the scrolling chip row (also after a reload).
  const metricsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = metricsRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !chip) return;
    // The chosen chip comes to the middle of the bar (the ones beside it show that the row goes on).
    const left = row.scrollLeft + chip.getBoundingClientRect().left - row.getBoundingClientRect().left;
    const to = left - (row.clientWidth - chip.offsetWidth) / 2;
    if (Math.abs(to - row.scrollLeft) > 4) row.scrollTo({ left: to, behavior: "smooth" });
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
  // The item bar is fixed at the bottom; the sheet stands on it and may rise to the top of the screen.
  const [barH, setBarH] = useState(0);
  const [safeTop, setSafeTop] = useState(0);
  useLayoutEffect(() => {
    const el = metricsRef.current;
    if (!el) return;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const measure = () => {
      setBarH(Math.round(el.getBoundingClientRect().height));
      setSafeTop(Math.round(probe.getBoundingClientRect().height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      probe.remove();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--itembar-h", `${barH}px`);
  }, [barH]);
  const heights = sheetHeights(spaceBelow - barH, window.innerHeight - barH, safeTop + 8);
  // Overlay sheets open to the same height as the graph sheet at its highest (rule: 重なり順と高さ).
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--sheet-max",
      `${heights.max}px`,
    );
  }, [heights.max]);

  return (
    <DaySummaryContext.Provider value={setSummary}>
    {/* 台風の日 for every picture of a day: the table, the calendars, the summaries (#220). */}
    <TyphoonDaysContext.Provider value={typhoonOn}>
    <div
      className={full ? "app full wide" : "app"}
      style={{ paddingBottom: (view.single ? 24 : heights[sheetDetent] + 12) + barH }}
    >
      {!full && (
        <header className="app-head">
          <Brand store={store} />
          <div className="app-head-actions">
            {/* 比較｜1日 (#247): whether the comparison day is shown; the rest of the screen stays. */}
            <Segmented
              label="見かた"
              value={view.single ? "single" : "compare"}
              options={[
                { id: "compare", label: "比較" },
                { id: "single", label: "1日" },
              ]}
              onChange={(v) => setSingle(v === "single")}
            />
            {account.me && (
              <Button size="sm" className="head-report" onClick={() => setReportFrom({})} aria-label="今の感じ方を記録する">
                {reportSaved ? (
                  <>
                    <CheckGlyph />
                    記録しました
                  </>
                ) : (
                  "記録"
                )}
              </Button>
            )}
            <IconButton label="設定" onClick={() => setSettings(true)}>
              <GearIcon />
            </IconButton>
          </div>
        </header>
      )}

      {!full && (
        <TyphoonCard
          station={view.station}
          info={typhoons}
          onCompare={() => {
            setConditionsPreset(TYPHOON_PRESET);
            setConditions(true);
          }}
        />
      )}

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
              single={view.single}
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

      {view.single && (
        <BetaContext.Provider value={beta}>
          <FeelContext.Provider value={feelSettings}>
            <DayDetail
              store={store}
              station={view.station}
              date={view.target}
              today={today}
              metric={view.metric}
              onMetric={(id) => set("metric", id)}
              onOpenFeel={() => setFeelMap(true)}
              onToggleSun={() => set("sun", !view.sun)}
            />
          </FeelContext.Provider>
        </BetaContext.Provider>
      )}

      {!view.single && (
      <BetaContext.Provider value={beta}>
        <FeelContext.Provider value={feelSettings}>
          <GraphSheet
            title={shownFace === "chart" ? "日別" : shownFace === "trend" ? "移り変わり" : "時間帯"}
            detent={sheetDetent}
            heights={heights}
            onDetent={setDetent}
            tabs={
              // The item bar stays visible under the sheet, so the sheet only says what it shows.
              <div className="sheet-head">
                {shownFace === "trend" ? (
                  <>
                    <button className="back-btn" onClick={() => setFace("chart")} aria-label="日別に戻る">
                      <ChevronIcon />
                      日別
                    </button>
                    <span className="sheet-head-title"><ItemIcon id="light" /><span className="sheet-head-text">明るさの移り変わり</span></span>
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
                    <span className="sheet-head-title"><ItemIcon id={view.metric} long={(metric.title ?? metric.label).length > 4} /><span className="sheet-head-text">{`${metric.title ?? metric.label}の時間帯`}</span></span>
                    <span className="sheet-head-end">{modeSelect}</span>
                  </>
                ) : (
                  <>
                    {/* 日照 has a button here too, so its title is the chip's own word (日照), which fits at 360. */}
                    <span className="sheet-head-title"><ItemIcon id={view.metric} /><span className="sheet-head-text">{`${view.metric === "light" ? metric.label : (metric.title ?? metric.label)}の日別`}</span></span>
                    {view.metric === "light" ? (
                      <Button size="sm" className="trend-btn" onClick={() => setFace("trend")}>
                        移り変わり
                      </Button>
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
                onShiftDays={(n) => moveTarget(addDays(view.target, n))}
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
      )}

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
          onMonthReview={(m) => {
            setCalendar(null);
            setMonthReview(m);
          }}
        />
      )}

      {monthReview && (
        <FeelContext.Provider value={feelSettings}>
          <MonthReview store={store} station={view.station} month={monthReview} today={today} onClose={() => setMonthReview(null)} />
        </FeelContext.Provider>
      )}

      {conditions && (
        <ConditionSheet
          store={store}
          station={view.station}
          target={view.target}
          compareDate={compareDate}
          onPick={pickCompare}
          preset={conditionsPreset}
          onClose={() => {
            setConditions(false);
            setConditionsPreset(undefined);
          }}
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

      {/* 項目の帯：画面の下に固定、1行で横にスワイプ（2026-11-22 渡辺さん。比較・1日とも同じ）。グラフのシートはこの上に乗る。 */}
      <nav className="metrics item-bar" role="tablist" aria-label="グラフの項目" ref={metricsRef}>
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
      </nav>

      {/* その日の要約 (#176): over whatever it was opened from (the table, the calendar, the hours). */}
      {typhoonAsked && <TyphoonSheet station={view.station} date={today} number={typhoonAsked} info={typhoons} onClose={() => setTyphoonAsked(null)} />}
      {summary && <DaySummaryCard store={store} station={view.station} ask={summary} typhoons={typhoons} onClose={() => setSummary(null)} />}
    </div>
    </TyphoonDaysContext.Provider>
    </DaySummaryContext.Provider>
  );
}

/** Asks the store, quietly, for the 30 days the 従来版 boundaries of the shown days move by (#111). */
function SeasonDays({ store, station, dates }: { store: WeatherStore | null; station: string; dates: (string | null)[] }) {
  useSeasonDays(store, station, dates, "season");
  return null;
}

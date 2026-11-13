// The 24 hours of one day next to its partner day, for one hourly item.
// Shared by the day detail and the sheet's 時間帯 tab, so both look and behave the same.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, jstHour } from "../../shared/dates";
import { altitudeCurve, type DayEdges, dayEdges, dayParts, type PartWindow } from "../../shared/dayParts";
import { BRIGHTNESS_LEVELS, brightnessLevel, brightnessRatio, dayLights, luxText, stepOutFeel, usualText } from "../../shared/brightness";
import { usualLightOf } from "../light";
import { daySky, luminanceText, SKY_STEPS, type SkyColour, stepTime } from "../../shared/sky";
import { hoursWeather } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { ForecastHatch, GraphReadout, GuideLines, InfoNote } from "./kit";

/** Which boundaries colour the 肌感 graph: everyone's (the app's settings) or the person's (β, #118). */
type Bands = "shared" | "you";
const BANDS_KEY = "wn.hourBands";
const readBands = (): Bands => {
  try {
    return localStorage.getItem(BANDS_KEY) === "you" ? "you" : "shared";
  } catch {
    return "shared";
  }
};
import { WeatherIcon } from "./WeatherIcon";
import { cachedSun, hourOfDay, loadSun, sunAvailable, type SunTimes } from "../data/sun";
import {
  axisRange,
  type DetailMetricId,
  detailMetric,
  formatDetail,
  type HourPoint,
  hourSeries,
  initialHour,
  signedDiff,
} from "../dayDetail";
import { barLook, type DataColor, DATA, LIGHT_LEVELS, LINE, type LineLook, lineLook } from "../design/tokens";
import { type AverageWindow, AVERAGE_WINDOWS, daysBefore, meanByHour, nextWindow, WINDOW_LABEL } from "../hourAverage";
import { Priority } from "../data/plan";
import { axisWidth, dateLabel, needsYear, niceTicks, tickLabel } from "../design/format";
import { FeelContext, legendOf, levelName, levelRanges } from "./FeelBar";
import { levelOf, type Thresholds } from "../../shared/feel";
import { Segmented } from "./kit";
import { personalThresholds, useDayComfortState } from "../beta/useDayComfort";
import { feelOn } from "../feelSeason";

/** The colour of an hourly item: the same for both days (they differ by solid / dashed). */
export const HOUR_TONE: Record<DetailMetricId, DataColor> = {
  temp: "temp",
  feel: "feel",
  rain: "rain",
  snow: "snow",
  probability: "rain",
  humidity: "humidity",
  wind: "wind",
  radiation: "sun",
  sun: "sun",
  pressure: "pressure",
};

export const shortDate = (d: string) => dateLabel(d, { year: true, weekday: false });

/** Sunrise and sunset: from the forecast row when it has them, otherwise asked once. */
export function useSun(station: string, date: string | null, today: string, row: WeatherRow | null | undefined): SunTimes | null {
  const fromRow = row && typeof row.sunrise === "string" ? { sunrise: row.sunrise as string, sunset: (row.sunset as string) ?? null } : null;
  const [sun, setSun] = useState<SunTimes | null>(() => (date ? (cachedSun(station, date) ?? null) : null));
  useEffect(() => {
    if (!date || fromRow || !sunAvailable(date, today)) return setSun(null);
    setSun(cachedSun(station, date) ?? null);
    let live = true;
    void loadSun(station, date).then((s) => live && setSun(s));
    return () => {
      live = false;
    };
  }, [station, date, today, !!fromRow]); // eslint-disable-line react-hooks/exhaustive-deps
  return fromRow ?? sun;
}

interface Props {
  store: WeatherStore | null;
  station: string;
  date: string;
  other: string | null;
  metricId: DetailMetricId;
  today: string;
  /** Drawing height of the graph. */
  height?: number;
}

export function HourCompare({ store, station, date, other, metricId, today, height = 210 }: Props) {
  const settings = useContext(FeelContext);
  const metric = detailMetric(metricId);
  const hours = store?.getHours(station, date);
  const otherHours = other ? store?.getHours(station, other) : null;
  const sun = useSun(station, date, today, store?.getDay(station, date).row);
  // The parts of the day and the sun's height, by the sun at this station (shared/dayParts.ts).
  const day = useMemo(() => ({ parts: dayParts(date, station), edges: dayEdges(date, station), curve: altitudeCurve(date, station, 10) }), [date, station]);

  const main = useMemo(() => hourSeries(hours?.rows ?? [], metricId, settings), [hours, metricId, settings]);
  const second = useMemo(() => hourSeries(otherHours?.rows ?? [], metricId, settings), [otherHours, metricId, settings]);
  const air = useMemo(() => (metricId === "feel" ? hourSeries(hours?.rows ?? [], "temp", settings) : null), [hours, metricId, settings]);
  // 手前の平均 (src/hourAverage.ts): each day's own weeks before it, hour by hour. Tapping the legend
  // steps the span (1週 → 2週 → 1か月) and sets a line aside (grey); both are the person's to choose.
  const [avgWindow, setAvgWindow] = useState<AverageWindow>(readWindow);
  const stepWindow = () => {
    const w = nextWindow(avgWindow);
    setAvgWindow(w);
    try {
      localStorage.setItem(WINDOW_KEY, String(w));
    } catch {
      /* not kept: fine */
    }
  };
  const [dim, setDim] = useState<Record<LineId, boolean>>({ main: false, other: false, avgMain: false, avgOther: false });
  const toggleDim = (k: LineId) => setDim((d) => ({ ...d, [k]: !d[k] }));
  // Every span's days are asked for (the month holds the week and the two weeks), so the graph's
  // axis can be set from all three spans and does not move when the span is switched.
  const LONGEST = AVERAGE_WINDOWS.at(-1)!;
  const avgDaysMain = useMemo(() => daysBefore(date, LONGEST, today), [date, LONGEST, today]);
  const avgDaysOther = useMemo(() => (other ? daysBefore(other, LONGEST, today) : []), [other, LONGEST, today]);
  const avgWanted = [...avgDaysMain, ...avgDaysOther].join(",");
  useEffect(() => {
    store?.wantHours(station, avgWanted ? avgWanted.split(",") : [], Priority.Behind, "hour-average");
  }, [store, station, avgWanted]);
  useEffect(() => () => store?.wantHours(station, [], Priority.Behind, "hour-average"), [store, station]);
  // daysBefore gives the nearest first, so a span's days are the first `w` of the month's.
  const seriesOf = (days: string[]) => days.map((d) => store?.getHours(station, d)).map((h) => (h?.state === "ready" ? hourSeries(h.rows, metricId, settings) : null));
  const daySeriesMain = seriesOf(avgDaysMain);
  const daySeriesOther = seriesOf(avgDaysOther);
  const averageOf = (series: (HourPoint[] | null)[], days: string[], anchor: string, w: number) => {
    const span = days.filter((d) => d >= addDays(anchor, -w)); // a prefix: nearest first
    if (!span.length) return null;
    const m = meanByHour(series.slice(0, span.length).filter((x): x is HourPoint[] => !!x), span.length);
    return m.some((p) => p.v != null) ? m : null;
  };
  const avgMain = averageOf(daySeriesMain, avgDaysMain, date, avgWindow);
  const avgOther = other ? averageOf(daySeriesOther, avgDaysOther, other, avgWindow) : null;
  // The axis: the days' own values and every span's averages, whichever span is shown.
  const axisExtra = AVERAGE_WINDOWS.flatMap((w) => [averageOf(daySeriesMain, avgDaysMain, date, w), other ? averageOf(daySeriesOther, avgDaysOther, other, w) : null])
    .flatMap((a) => a?.map((p) => p.v) ?? [])
    .filter((v): v is number => v != null);
  const chance = useMemo(() => hourSeries(hours?.rows ?? [], "probability", settings), [hours, settings]);
  // 明るさ for each hour 1–24 (null where the hour is missing), both days, at the station.
  // dayLights: a twilight hour's clouds come from the nearest hour of daylight when it has no weather text.
  const lightOf = (rows: WeatherRow[] | undefined) => {
    const sorted = [...(rows ?? [])].sort((x, y) => x.n - y.n);
    const byHour = new Map(dayLights(sorted, station, settings.alpha).map((l, i) => [sorted[i].n, l.index]));
    return Array.from({ length: 24 }, (_, i) => byHour.get(i + 1) ?? null);
  };
  const lightMain = useMemo(() => lightOf(hours?.rows), [hours, station]); // eslint-disable-line react-hooks/exhaustive-deps
  const lightOther = useMemo(() => lightOf(otherHours?.rows), [otherHours, station]); // eslint-disable-line react-hooks/exhaustive-deps
  // 空の色（模式, shared/sky.ts）: six 10-minute colours per hour, only for the 日照 item.
  const skyOf = (rows: WeatherRow[] | undefined) => {
    const sorted = [...(rows ?? [])].sort((x, y) => x.n - y.n);
    const byHour = new Map(daySky(sorted, station, settings.alpha).map((h) => [h.n, h.steps])); // the town's glow by 周りの様子
    return Array.from({ length: 24 }, (_, i) => byHour.get(i + 1) ?? null);
  };
  const skyMain = useMemo(() => (metricId === "sun" ? skyOf(hours?.rows) : []), [hours, station, metricId, settings.alpha]); // eslint-disable-line react-hooks/exhaustive-deps
  const skyOther = useMemo(() => (metricId === "sun" && other ? skyOf(otherHours?.rows) : null), [otherHours, station, metricId, other, settings.alpha]); // eslint-disable-line react-hooks/exhaustive-deps
  // The weather under each time tick (0, 3, … 24 o'clock): the hour either side of it.
  const bandWx = useMemo(() => {
    // JMA hour n covers n−1 to n o'clock: hours h and h + 1 are the hour either side of h o'clock.
    const around = (h: number) => [h, h + 1].filter((n) => n >= 1 && n <= 24);
    return {
      main: WX_TICKS.map((h) => hoursWeather(hours?.rows ?? [], around(h), station, 1)),
      other: other ? WX_TICKS.map((h) => hoursWeather(otherHours?.rows ?? [], around(h), station, 1)) : null,
    };
  }, [hours, otherHours, other]);
  // β (#118): the person's own levels for the day, beside everyone's.
  const comfort = useDayComfortState(store, station, metricId === "feel" ? date : null, hours?.rows, "hour-bands");
  const [bandsPick, setBandsPick] = useState<Bands>(readBands);
  const pickBands = (b: Bands) => {
    setBandsPick(b);
    try {
      localStorage.setItem(BANDS_KEY, b);
    } catch {
      /* not kept: fine */
    }
  };
  // 従来版's boundaries of the day: the settings' moved by the season (#111).
  const dayFeel = feelOn(store, station, date, settings);
  const personal: Thresholds | null = metricId === "feel" && comfort.st && !comfort.hidden ? personalThresholds(comfort.st) : null;
  const bands: Bands = personal && bandsPick === "you" ? "you" : "shared";
  const isToday = date === today;
  const nowHour = jstHour();
  const [hour, setHour] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // The 10-minute step within the hour (空の色): set from the strip, cleared when the graph picks an hour.
  const [step, setStep] = useState<number | null>(null);
  const shownHour = hour ?? initialHour(main, isToday, nowHour);
  useEffect(() => {
    setHour(null);
    setStep(null);
  }, [date]);
  const skyStep = (list: (SkyColour[] | null)[] | null) => list?.[shownHour - 1]?.[step ?? 3] ?? null;

  const at = (points: HourPoint[]) => points[shownHour - 1]?.v ?? null;
  // Same month and day a year apart would read "11/10" twice: the comparison day keeps its year.
  const mainLabel = dateLabel(date, { weekday: false });
  // Another year as 'YY (as in the summary line), so the title fits beside the column heads.
  const otherLabel = other ? (needsYear(other, date) ? `’${other.slice(2, 4)}/` : "") + dateLabel(other, { weekday: false }) : "";
  const tone = HOUR_TONE[metricId];
  const color = DATA[tone];

  return (
    <div className="hour-compare">
      {/* The hour's values above the graph, in the card every graph uses. */}
      <GraphReadout
        live={scrubbing}
        unit={metric.unit === "h" || metric.unit === "肌感" ? "" : metric.unit}
        title={
          <>
            {shownHour}時<small> {mainLabel}{other ? ` / ${otherLabel}` : ""}</small>
          </>
        }
        rows={[
          {
            key: "main",
            label: metric.label,
            color,
            a: formatDetail(at(main), metric),
            b: other ? formatDetail(at(second), metric) : "—",
            diff: other && metric.unit !== "h" ? signedDiff(at(main), at(second), metric.unit) : "",
          },
          // The same hour over each day's own weeks before it, and how far the day is from that.
          ...(avgMain || avgOther
            ? [
                {
                  key: "avg",
                  label: `手前${WINDOW_LABEL[avgWindow]}の平均`,
                  color: LINE.reference,
                  a: avgMain ? formatDetail(at(avgMain), metric) : "—",
                  b: avgOther ? formatDetail(at(avgOther), metric) : "—",
                  diff: avgMain && avgOther ? signedDiff(at(avgMain), at(avgOther), metric.unit) : "",
                },
                {
                  key: "dev",
                  label: "平均との差",
                  unit: "",
                  a: (avgMain && signedDiff(at(main), at(avgMain), metric.unit)) || "—",
                  b: (avgOther && signedDiff(at(second), at(avgOther), metric.unit)) || "—",
                  diff: avgMain && avgOther ? signedDiff(devOf(at(main), at(avgMain)), devOf(at(second), at(avgOther)), metric.unit) : "",
                },
              ]
            : []),
          // The weather of the shown hour (#: 時間帯の天気), both days. Faint = estimated.
          {
            key: "wx",
            label: "天気",
            a: <HourWeather w={hoursWeather(hours?.rows ?? [], [shownHour], station, 1)} />,
            b: other ? <HourWeather w={hoursWeather(otherHours?.rows ?? [], [shownHour], station, 1)} /> : "—",
          },
          ...(metricId === "sun"
            ? [
                // 明るさ (shared/brightness.ts): the felt level of the hour, and how many times brighter.
                {
                  key: "light",
                  text: true,
                  label: "明るさ",
                  unit: "",
                  a: lightMain[shownHour - 1] == null ? "—" : brightnessLevel(lightMain[shownHour - 1]!).label,
                  b: other ? (lightOther[shownHour - 1] == null ? "—" : brightnessLevel(lightOther[shownHour - 1]!).label) : "—",
                  diff: other ? brightnessRatio(lightMain[shownHour - 1], lightOther[shownHour - 1]) : "",
                },
                // The first impression on stepping out of a lit room (about 500 lx; shared/brightness.ts).
                {
                  key: "stepOut",
                  text: true,
                  label: "外に出たとき",
                  unit: "",
                  a: stepOutFeel(lightMain[shownHour - 1]) ?? "—",
                  b: other ? (stepOutFeel(lightOther[shownHour - 1]) ?? "—") : "—",
                },
                // 空の色（模式）at the step (the middle of the hour until a step is picked on the strip).
                {
                  key: "sky",
                  text: true,
                  label: `空（${stepTime(shownHour, step ?? 3)}）`,
                  unit: "",
                  a: <SkyWord s={skyStep(skyMain)} />,
                  b: other ? <SkyWord s={skyStep(skyOther)} /> : "—",
                },
              ]
            : []),
          ...(metricId === "feel" && personal
            ? [
                // The level of the shown hour: everyone's, and the person's (β).
                {
                  key: "level",
                  text: true,
                  label: "あなたの段",
                  unit: "",
                  // The person's levels are of the shown day (対象) only.
                  a: at(main) == null ? "—" : `${levelName(levelOf(at(main)!, { ...settings, thresholds: personal }), settings.scale)}（従来版 ${levelName(levelOf(at(main)!, dayFeel), settings.scale)}）`,
                  b: "—",
                },
              ]
            : []),
          ...(metricId === "rain" && chance.some((p) => p.v != null)
            ? [{ key: "chance", label: "降水確率", color: DATA.rain, unit: "%", a: at(chance) == null ? "—" : String(Math.round(at(chance)!)) }]
            : []),
        ]}
      />

      <div className="hour-chart-wrap">
      <HourChart
        metricId={metricId}
        main={main}
        second={other ? second : null}
        air={air}
        avgMain={avgMain}
        avgOther={avgOther}
        axisExtra={axisExtra}
        dim={dim}
        ranges={levelRanges(bands === "you" && personal ? personal : dayFeel.thresholds, settings.scale)}
        guides={bands === "you" ? dayFeel.thresholds : undefined}
        sun={sun}
        day={day}
        nowHour={isToday ? nowHour : null}
        hour={shownHour}
        onHour={(h) => {
          setHour(h);
          setStep(null);
        }}
        onScrub={setScrubbing}
        height={height}
        color={color}
        bandWx={bandWx}
      />
      <HourStatus state={hours?.state} error={hours?.error} onRetry={() => store?.retryDay(station, date)} />
      </div>

      {metricId === "sun" && (
        <LightStrip
          hasOther={!!other}
          skyMain={skyMain}
          skyOther={other ? skyOther : null}
          shownHour={shownHour}
          step={step}
          onPick={(h, k) => {
            setHour(h);
            setStep(k);
          }}
          usual={{ main: usualLightOf(store, station, date), other: other ? usualLightOf(store, station, other) : null }} />
      )}

      {metricId === "feel" && comfort.st && (
        <div className="hour-bands">
          {comfort.hidden ? (
            <p className="basis-note">あなた（β）の段は、今日の最初の記録の後に出ます。</p>
          ) : (
            <>
              <Segmented
                label="段の色"
                value={bands}
                onChange={pickBands}
                options={[
                  { id: "shared", label: "従来版の段" },
                  { id: "you", label: "あなたの段（β）" },
                ]}
              />
              {bands === "you" && personal && (
                <p className="basis-note">
                  色はあなたの記録から学んだ段（ちょうどよい＝涼しい〜暖かい {personal[1].toFixed(1)}〜{personal[4].toFixed(1)}）。点線は従来版の境目（同じく {dayFeel.thresholds[1]}〜{dayFeel.thresholds[4]}、季節で動く）。β は検証中の計算です。
                </p>
              )}
            </>
          )}
        </div>
      )}
      {metricId === "feel" && (
        <p className="level-legend">
          {legendOf(settings.scale).map(({ label, color }) => (
            <span key={label}>
              <i style={{ background: color }} />
              {label}
            </span>
          ))}
        </p>
      )}
      <p className="line-legend">
        {/* A tap on a line's name sets it aside (grey) or brings it back (design engine: dimmed lines keep their form). */}
        <LegendLine on={!dim.main} onToggle={() => toggleDim("main")} look={lineLook("target", color, { dimmed: dim.main })} label={`対象 ${mainLabel}`} />
        {other && <LegendLine on={!dim.other} onToggle={() => toggleDim("other")} look={lineLook("compare", color, { dimmed: dim.other })} label={`比較 ${otherLabel}`} />}
        {avgMain && (
          <LegendLine on={!dim.avgMain} onToggle={() => toggleDim("avgMain")} look={lineLook("target", color, { kind: "reference", dimmed: dim.avgMain })} label="対象の手前" />
        )}
        {avgOther && (
          <LegendLine on={!dim.avgOther} onToggle={() => toggleDim("avgOther")} look={lineLook("compare", color, { kind: "reference", dimmed: dim.avgOther })} label="比較の手前" />
        )}
        <button className="avg-window" onClick={stepWindow} aria-label={`平均の期間（今は手前${WINDOW_LABEL[avgWindow]}）。押すと切り替え`}>
          平均 <b>{WINDOW_LABEL[avgWindow]}</b>
          <span className="steps" aria-hidden>
            {AVERAGE_WINDOWS.map((w) => (
              <i key={w} className={w === avgWindow ? "on" : undefined} />
            ))}
          </span>
        </button>
        <span>
          <i className="ls-forecast" />
          予報
        </span>
        {metricId === "feel" && (
          <span>
            <i className="ls-solid" style={{ borderColor: lineLook("target", "", { kind: "reference" }).stroke }} />
            気温
          </span>
        )}
      </p>
      <InfoNote more={<>時刻の下の天気は、その時刻の前後1時間。大きい方が対象{other ? "・小さい方が比較" : ""}。薄いのは日照と降水からの推定です。凡例の線の名前を押すと、その線を薄くできます。</>} />
    </div>
  );
}

/**
 * The target day's hours while they are not there (rule: 状態の見せ方): over the graph area, which
 * keeps its size so nothing jumps — loading shimmers, a failure says so with 再試行 in the same place.
 */
function HourStatus({ state, error, onRetry }: { state?: string; error?: string; onRetry: () => void }) {
  if (state === "ready") return null;
  if (state === "error")
    return (
      <div className="state-overlay error" role="alert">
        <b>時間ごとのデータを取得できませんでした</b>
        {error && <small>{error}</small>}
        <button className="state-retry" onClick={onRetry}>
          再試行
        </button>
      </div>
    );
  if (state === "outside")
    return (
      <div className="state-overlay">
        <small>この日の時間ごとのデータはありません</small>
      </div>
    );
  return (
    <div className="state-overlay loading" aria-live="polite">
      <span className="state-spinner" aria-hidden />
      <small>時間ごとのデータを取得中…</small>
    </div>
  );
}

const PAD = { right: 10, top: 18, bottom: 26 };

type BandWx = { text: string | null; estimated: boolean };

/** The hours of the x axis's labels, under which the weather is shown. */
const WX_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** One hour's weather in the readout card: icon and words; faint when estimated. */
function HourWeather({ w }: { w: BandWx }) {
  if (!w.text) return <>—</>;
  return (
    // Icon only: the value columns are narrow (the words are in the title and the label).
    <span className={`ro-wx${w.estimated ? " weather-estimated" : ""}`} title={w.estimated ? `${w.text}（日照と降水からの推定）` : w.text} aria-label={w.estimated ? `${w.text}（推定）` : w.text}>
      <WeatherIcon text={w.text} size={20} />
    </span>
  );
}

/** One band's weather: the day's icon, and the partner day's smaller beside it. Estimates are faint. */
function BandWeatherIcons({ main, other }: { main: BandWx; other: BandWx | null }) {
  const icon = (w: BandWx, size: number, cls: string) =>
    w.text ? (
      <span className={`${cls}${w.estimated ? " weather-estimated" : ""}`} title={w.estimated ? `${w.text}（推定：日照と降水から）` : w.text}>
        <WeatherIcon text={w.text} size={size} />
      </span>
    ) : (
      <span className={`${cls} none`}>—</span>
    );
  return (
    <>
      {icon(main, 18, "band-wx-main")}
      {other ? icon(other, 13, "band-wx-other") : null}
    </>
  );
}

/** One hour of sky as a cell: the 10-minute colours left to right, the zenith above the horizon. */
const skyFill = (steps: SkyColour[]) => ({
  top: `linear-gradient(90deg, ${steps.map((s) => s.zenith).join(", ")})`,
  bottom: `linear-gradient(90deg, ${steps.map((s) => s.horizon).join(", ")})`,
});
/** The level line under an hour: each 10 minutes in its felt level's colour (hard steps). */
const levelFill = (steps: SkyColour[]) =>
  `linear-gradient(90deg, ${steps
    .map((s, k) => {
      const c = LIGHT_LEVELS[Math.min(5, Math.floor(s.index))];
      return `${c} ${((k / steps.length) * 100).toFixed(2)}% ${(((k + 1) / steps.length) * 100).toFixed(2)}%`;
    })
    .join(", ")})`;

/** Width of the 拡大 card (px). */
const ZOOM_W = 264;

/**
 * 明るさと空 under the 日差し graph (one strip, 2026-11-13): each hour as the sky's colour (schematic,
 * shared/sky.ts) in six 10-minute steps — how light it is follows the felt brightness — over a thin
 * line in the six levels' colours, so the levels stay readable. The cells sit under the graph's hours
 * (same side margins as the plot). The strip can be traced with a finger: a card above it enlarges
 * the hour, 10 minutes at a time. Nothing here is text to select: no loupe or copy menu.
 */
function LightStrip({
  hasOther,
  skyMain,
  skyOther,
  shownHour,
  step,
  onPick,
  usual,
}: {
  hasOther: boolean;
  skyMain: (SkyColour[] | null)[];
  skyOther: (SkyColour[] | null)[] | null;
  shownHour: number;
  step: number | null;
  onPick: (hour: number, step: number) => void;
  usual: { main: number | null; other: number | null };
}) {
  // The enlarged hour: while tracing ("trace"), or left open by a tap ("tap", closed with ×).
  const [zoom, setZoom] = useState<null | "trace" | "tap">(null);
  const [at, setAt] = useState(0); // the finger's place across the cells, 0–1
  const area = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; moved: boolean } | null>(null);
  const pick = (clientX: number) => {
    const box = area.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const f = Math.min(0.9999, Math.max(0, (clientX - box.left) / box.width));
    const t = Math.floor(f * 24 * SKY_STEPS);
    setAt(f);
    onPick(Math.floor(t / SKY_STEPS) + 1, t % SKY_STEPS);
  };
  const end = () => {
    const p = press.current;
    press.current = null;
    setZoom(p && !p.moved ? "tap" : null);
  };
  const shownStep = step ?? 3;
  const hourSky = skyMain[shownHour - 1];
  const width = area.current?.getBoundingClientRect().width ?? 0;
  const left = Math.max(0, Math.min(width - ZOOM_W, at * width - ZOOM_W / 2));
  const otherSky = hasOther ? skyOther?.[shownHour - 1] : null;
  // The target's hour, and the comparison day's same hour under it, so the two read side by side.
  const zoomDays = hourSky?.[shownStep]
    ? [{ label: "対象", steps: hourSky }, ...(otherSky?.[shownStep] ? [{ label: "比較", steps: otherSky }] : [])]
    : [];

  const row = (label: string, skies: (SkyColour[] | null)[]) => (
    <div className="light-row">
      <span className="light-row-label">{label}</span>
      <div className="light-cells sky" role="img" aria-label={`${label}の明るさと空の色（1時間ごと）`}>
        {Array.from({ length: 24 }, (_, i) => {
          const s = skies[i];
          const fill = s ? skyFill(s) : null;
          return (
            <i key={i} className={`${i + 1 === shownHour ? "on" : ""}${s ? "" : " none"}`}>
              {fill && s && (
                <>
                  <b style={{ background: fill.top }} />
                  <b style={{ background: fill.bottom }} />
                  <u style={{ background: levelFill(s) }} />
                </>
              )}
            </i>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="light-strip">
      <span className="light-title">
        明るさと空
        {usual.main != null || usual.other != null ? (
          <small>
            {" "}昼は {usualText(usual.main)}{hasOther ? `・比較は ${usualText(usual.other)}` : ""}
          </small>
        ) : null}
      </span>
      <div className="light-rows">
        <div
          ref={area}
          className="light-trace on"
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* capture is a nicety */
            }
            press.current = { x: e.clientX, moved: false };
            setZoom("trace");
            pick(e.clientX);
          }}
          onPointerMove={(e) => {
            const p = press.current;
            if (!p) return;
            if (Math.abs(e.clientX - p.x) > 4) p.moved = true;
            pick(e.clientX);
          }}
          onPointerUp={end}
          onPointerCancel={() => {
            press.current = null;
            setZoom(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {row("対象", skyMain)}
        {hasOther && skyOther && row("比較", skyOther)}
        {zoom && zoomDays.length > 0 && (
          <div className="sky-zoom" role="group" aria-label={`${stepTime(shownHour, 0)}〜${shownHour}:00の明るさと空（拡大）`} style={{ left: left + 34 }}>
            <div className="sky-zoom-head">
              <b>
                {stepTime(shownHour, 0)}〜{shownHour}:00
              </b>
              <small>雲は1時間の値</small>
            </div>
            {zoomDays.map(({ label, steps }, d) => {
              const cur = steps[shownStep];
              return (
                <div key={label} className="sky-zoom-day">
                  <div className="sky-zoom-steps" role="img" aria-label={`${label}の10分ごとの空`}>
                    {steps.map((s, k) => (
                      <span key={k} className={k === shownStep ? "on" : undefined}>
                        <i style={{ background: `linear-gradient(180deg, ${s.zenith}, ${s.horizon})` }} />
                        <u style={{ background: LIGHT_LEVELS[Math.min(5, Math.floor(s.index))] }} />
                        {d === zoomDays.length - 1 && <small>{stepTime(shownHour, k)}</small>}
                      </span>
                    ))}
                  </div>
                  <div className="sky-zoom-now">
                    <b>
                      {zoomDays.length > 1 && <em>{label}</em>}
                      {stepTime(shownHour, shownStep)}　{cur.word}
                    </b>
                    <small>
                      太陽 {cur.altitude > 0 ? "+" : ""}
                      {Math.round(cur.altitude)}°
                    </small>
                  </div>
                  <div className="sky-zoom-light">
                    地上 {brightnessLevel(cur.index).label}（{luxText(cur.lux)}）・空 {luminanceText(cur.skyLuminance)}
                  </div>
                </div>
              );
            })}
            {zoom === "tap" && (
              <button className="sky-zoom-close" onClick={() => setZoom(null)} aria-label="拡大を閉じる">
                ×
              </button>
            )}
          </div>
        )}
      </div>
      <p className="light-legend">
        {BRIGHTNESS_LEVELS.map((l, i) => (
          <span key={l.id}>
            <i style={{ background: LIGHT_LEVELS[i] }} />
            {l.label}
          </span>
        ))}
      </p>
      <InfoNote
        className="light-note"
        more={
          <>
            太陽の高さ（10分ごと）と、その時間の日照・降水から描いたもので、写真や実測ではありません。色の明るさは空の見かけの明るさで、夜は周りの様子（設定）に応じた街の明かりで明るく見えます。下の細い線は地上の明るさの段。「いつも」は手前7日の同じ時間。「外に出たとき」は、室内（約500lx）に慣れた目で外に出た直後の感じ方です。
          </>
        }
      >
        空の色は模式です。なぞると10分ごとに拡大。
      </InfoNote>
    </div>
  );
}

/** The sky's word with a small swatch (zenith over horizon). */
function SkyWord({ s }: { s: SkyColour | null }) {
  if (!s) return <>—</>;
  return (
    <span className="sky-word">
      <i style={{ background: `linear-gradient(180deg, ${s.zenith}, ${s.horizon})` }} aria-hidden="true" />
      {s.word}
    </span>
  );
}

type LineId = "main" | "other" | "avgMain" | "avgOther";
const WINDOW_KEY = "weather-note:hour-average";
function readWindow(): AverageWindow {
  try {
    const w = Number(localStorage.getItem(WINDOW_KEY));
    return (AVERAGE_WINDOWS as readonly number[]).includes(w) ? (w as AverageWindow) : 7;
  } catch {
    return 7;
  }
}
const devOf = (v: number | null, avg: number | null) => (v == null || avg == null ? null : v - avg);

/** A line's name in the legend, in its own line form; a tap sets it aside (grey) or brings it back. */
function LegendLine({ look, label, on, onToggle }: { look: LineLook; label: string; on: boolean; onToggle: () => void }) {
  return (
    <button className={on ? "legend-line" : "legend-line off"} onClick={onToggle} aria-pressed={on} aria-label={`${label}（${on ? "表示中・押すと薄く" : "薄く表示中・押すと戻す"}）`}>
      <svg width="22" height="6" aria-hidden>
        <line x1="1" x2="21" y1="3" y2="3" stroke={look.stroke} strokeWidth={look.strokeWidth} strokeDasharray={look.strokeDasharray} opacity={look.opacity} />
      </svg>
      {label}
    </button>
  );
}

function HourChart({
  metricId,
  main,
  second,
  air,
  avgMain,
  avgOther,
  axisExtra,
  dim,
  ranges,
  sun,
  day,
  nowHour,
  hour,
  onHour,
  onScrub,
  height,
  color,
  bandWx,
  guides,
}: {
  bandWx?: { main: BandWx[]; other: BandWx[] | null };
  /** Other boundaries drawn as dashed lines over the feel ranges (everyone's, when the ranges are the person's). */
  guides?: readonly number[];
  metricId: DetailMetricId;
  main: HourPoint[];
  second: HourPoint[] | null;
  air: HourPoint[] | null;
  /** Each day's own weeks before it (手前の平均), hour by hour. */
  avgMain?: HourPoint[] | null;
  /** Values the axis must hold besides the lines shown (every span's averages, so switching the span keeps the axis). */
  axisExtra?: number[];
  avgOther?: HourPoint[] | null;
  /** Lines the person has set aside: drawn grey, under the others. */
  dim?: Record<LineId, boolean>;
  /** Coloured 肌感 ranges behind the feel graph (the chosen scale). */
  ranges: { from: number; to: number; color: string }[];
  sun: SunTimes | null;
  /** The five parts (by the sun's altitude), the day's edges, and the altitude through the day. */
  day: { parts: PartWindow[]; edges: DayEdges; curve: { min: number; deg: number }[] };
  nowHour: number | null;
  hour: number;
  onHour: (h: number) => void;
  /** True while the finger is on the graph (the card above reads live). */
  onScrub?: (on: boolean) => void;
  height: number;
  /** The item's data colour (both days). */
  color: string;
}) {
  const H = height;
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const metric = detailMetric(metricId);
  const values = [main, second ?? [], air ?? [], avgMain ?? [], avgOther ?? []].flatMap((s) => s.map((p) => p.v)).filter((v): v is number => v != null).concat(axisExtra ?? []);
  // Round ticks (10 / 15 / 20): the padded data range widened to whole steps.
  const range = axisRange(values, metric);
  const { lo, hi, ticks } = niceTicks(range.lo, range.hi, 5);
  // The axis column is as wide as its longest label (1020 hPa needs more than 25 ℃), so nothing is cut.
  const left = axisWidth(ticks.map(tickLabel));
  const plotW = w - left - PAD.right;
  const step = plotW / 24;
  // Hour n is the value at n o'clock: x runs from 0 to 24 o'clock.
  const xOf = (h: number) => left + (h / 24) * plotW;
  const yOf = (v: number) => PAD.top + ((hi - Math.min(hi, Math.max(lo, v))) * (H - PAD.top - PAD.bottom)) / (hi - lo);
  // Sunrise and sunset from the sun API when known (the stored ones), else calculated.
  const rise = hourOfDay(sun?.sunrise ?? null) ?? day.edges.rise / 60;
  const set = hourOfDay(sun?.sunset ?? null) ?? day.edges.set / 60;
  const dawn = day.edges.dawn / 60;
  const dusk = day.edges.dusk / 60;
  const plotTop = PAD.top;
  const plotBottom = H - PAD.bottom;
  // The sun's height as a faint hill along the bottom: 90° would fill a third of the graph.
  const sunY = (deg: number) => plotBottom - (Math.max(0, deg) / 90) * (plotBottom - plotTop) * 0.33;
  const above = day.curve.filter((p, i, a) => p.deg > 0 || (a[i - 1]?.deg ?? -1) > 0 || (a[i + 1]?.deg ?? -1) > 0);
  const sunPath = above.length ? `M${xOf(above[0].min / 60)},${plotBottom} ` + above.map((p) => `L${xOf(p.min / 60)},${sunY(p.deg)}`).join(" ") + ` L${xOf(above.at(-1)!.min / 60)},${plotBottom} Z` : null;
  const clip = (m: number) => Math.min(24, Math.max(0, m / 60));

  const pickAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const x = ((clientX - box.left - left) / plotW) * 24;
    // A bar covers the hour before its time (19–20 o'clock is the 20時 bar).
    const h = metric.chart === "bar" ? Math.ceil(x) : Math.round(x);
    onHour(Math.min(24, Math.max(1, h)));
  };
  const scrub = useRef(false);

  // Lines and bars follow the design engine's rule (tokens.ts: lineLook / barLook).
  const line = (points: HourPoint[], look: LineLook) =>
    points.slice(1).map((p, i) => {
      const a = points[i];
      if (a.v == null || p.v == null) return null;
      return (
        <line
          key={`${look.stroke}-${look.strokeDasharray ?? "solid"}-${i}`}
          x1={xOf(a.hour)}
          y1={yOf(a.v)}
          x2={xOf(p.hour)}
          y2={yOf(p.v)}
          stroke={look.stroke}
          strokeWidth={look.strokeWidth}
          strokeDasharray={look.strokeDasharray}
          strokeLinecap={look.strokeDasharray ? "butt" : "round"}
          opacity={look.opacity}
        />
      );
    });

  const bars = (points: HourPoint[], color: string, other: boolean, dimmed = false) =>
    points.map((p) =>
      p.v == null || p.v <= 0 ? null : (
        <rect
          key={`${color}-${other}-${p.hour}`}
          x={xOf(p.hour) - step + (other ? step * 0.5 : step * 0.08)}
          y={yOf(p.v)}
          width={step * 0.42}
          height={Math.max(0, yOf(0) - yOf(p.v))}
          {...barLook(other ? "compare" : "target", color, dimmed)}
        />
      ),
    );
  // An average over bars: a short line across its own day's bar, in that day's line form.
  const averageTicks = (points: HourPoint[], other: boolean, dimmed: boolean) => {
    const look = lineLook(other ? "compare" : "target", color, { kind: "reference", dimmed });
    return points.map((p) =>
      p.v == null || p.v <= 0.005 ? null : (
        <line
          key={`avg-${other}-${p.hour}`}
          x1={xOf(p.hour) - step + (other ? step * 0.46 : step * 0.04)}
          x2={xOf(p.hour) - step + (other ? step * 0.96 : step * 0.54)}
          y1={yOf(p.v)}
          y2={yOf(p.v)}
          stroke={look.stroke}
          strokeWidth={look.strokeWidth + 0.4}
          strokeDasharray={look.strokeDasharray ? "3 2" : undefined}
          opacity={look.opacity}
        />
      ),
    );
  };
  const d = dim ?? { main: false, other: false, avgMain: false, avgOther: false };
  // Lines set aside go under the others, so the ones still in colour read on top.
  const under = (k: LineId) => (d[k] ? 0 : 1);

  return (
    <div
      ref={ref}
      className="chart day-chart"
      onPointerDown={(e) => {
        scrub.current = true;
        onScrub?.(true);
        pickAt(e.clientX);
      }}
      onPointerMove={(e) => scrub.current && pickAt(e.clientX)}
      onPointerUp={() => {
        scrub.current = false;
        onScrub?.(false);
      }}
      onPointerLeave={() => {
        scrub.current = false;
        onScrub?.(false);
      }}
      onPointerCancel={() => {
        scrub.current = false;
        onScrub?.(false);
      }}
    >
      <svg width={w} height={H} role="img" aria-label={`${metric.label}の時間ごとのグラフ`}>
        {/* Feel levels behind the lines. */}
        {metricId === "feel" &&
          ranges.map(({ from, to, color }, i) => {
            if (to <= lo || from >= hi) return null;
            const top = yOf(Math.min(hi, to));
            const bottom = yOf(Math.max(lo, from));
            return <rect key={i} x={left} width={plotW} y={top} height={Math.max(0, bottom - top)} fill={color} opacity={0.14} />;
          })}
        {metricId === "feel" &&
          guides?.map((v, i) =>
            v > lo && v < hi ? <line key={`g${i}`} x1={left} x2={left + plotW} y1={yOf(v)} y2={yOf(v)} className="chart-guide-shared" /> : null,
          )}
        <defs>
          <ForecastHatch id="fc-hours" />
        </defs>
        {/* Forecast hours (of either day): hatched, 予報 over the first of them. */}
        {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => {
          const fc = (k: number) => !!main[k - 1]?.forecast || !!second?.[k - 1]?.forecast;
          if (!fc(h)) return null;
          return (
            <g key={`fc-${h}`}>
              <rect x={xOf(h - 1)} width={xOf(h) - xOf(h - 1)} y={PAD.top} height={H - PAD.top - PAD.bottom} fill="url(#fc-hours)" className="chart-forecast" />
              {(h === 1 || !fc(h - 1)) && (
                <text x={xOf(h - 1) + 4} y={PAD.top + 12} className="chart-forecast-label">
                  予報
                </text>
              )}
            </g>
          );
        })}
        {/* Night (the sun more than 6° below the horizon) dark; twilight (sunrise and sunset to 6° below) lighter. */}
        <rect x={xOf(0)} width={xOf(dawn) - xOf(0)} y={plotTop} height={plotBottom - plotTop} className="day-night" />
        <rect x={xOf(dusk)} width={xOf(24) - xOf(dusk)} y={plotTop} height={plotBottom - plotTop} className="day-night" />
        <rect x={xOf(dawn)} width={Math.max(0, xOf(rise) - xOf(dawn))} y={plotTop} height={plotBottom - plotTop} className="day-twilight" />
        <rect x={xOf(set)} width={Math.max(0, xOf(dusk) - xOf(set))} y={plotTop} height={plotBottom - plotTop} className="day-twilight" />
        {/* The sun's height through the day, and its highest point. */}
        {sunPath && <path d={sunPath} className="day-sun" />}
        {/* The five parts of the day (by the sun's height), named along the top. */}
        {day.parts.map((p) => {
          const from = clip(p.from);
          const to = clip(p.to);
          if (to - from < 0.2) return null;
          return (
            <g key={p.id}>
              <line x1={xOf(from)} x2={xOf(from)} y1={plotTop} y2={plotBottom} className="day-band-edge" />
              <text x={xOf((from + to) / 2)} y={plotTop - 6} textAnchor="middle" className="day-band-label">
                {p.label}
              </text>
            </g>
          );
        })}
        {day.parts.at(-1)!.to < 1440 && <line x1={xOf(day.parts.at(-1)!.to / 60)} x2={xOf(day.parts.at(-1)!.to / 60)} y1={plotTop} y2={plotBottom} className="day-band-edge" />}

        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={w - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
            <text x={left - 6} y={yOf(t) + 4} className="chart-tick" textAnchor="end">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {/* The unit once, above the axis. */}
        <text x={2} y={PAD.top - 6} className="chart-unit">
          {metric.unit === "h" ? "時間" : metric.unit}
        </text>

        {nowHour != null && (
          <g>
            <line x1={xOf(nowHour)} x2={xOf(nowHour)} y1={PAD.top} y2={H - PAD.bottom} className="day-now" />
            <text x={xOf(nowHour) + 3} y={H - PAD.bottom - 4} className="day-now-label">
              今
            </text>
          </g>
        )}
        {metric.chart === "bar" ? (
          <rect x={xOf(hour - 1)} width={step} y={PAD.top} height={H - PAD.top - PAD.bottom} className="day-cursor-bar" />
        ) : (
          <GuideLines
            x={xOf(hour)}
            top={PAD.top}
            bottom={H - PAD.bottom}
            left={left}
            points={main[hour - 1]?.v != null ? [{ y: yOf(main[hour - 1].v!), color, label: formatDetail(main[hour - 1].v, metric) }] : []}
          />
        )}

        {metric.chart === "bar" ? (
          <>
            {second && bars(second, color, true, d.other)}
            {bars(main, color, false, d.main)}
            {avgOther && averageTicks(avgOther, true, d.avgOther)}
            {avgMain && averageTicks(avgMain, false, d.avgMain)}
          </>
        ) : (
          <>
            {air && line(air, lineLook("target", color, { kind: "reference" }))}
            {(
              [
                ["avgOther", avgOther, lineLook("compare", color, { kind: "reference", dimmed: d.avgOther })],
                ["avgMain", avgMain, lineLook("target", color, { kind: "reference", dimmed: d.avgMain })],
                ["other", second, lineLook("compare", color, { dimmed: d.other })],
                ["main", main, lineLook("target", color, { dimmed: d.main })],
              ] as [LineId, HourPoint[] | null | undefined, LineLook][]
            )
              .filter(([, pts]) => pts)
              .sort(([a], [b]) => under(a) - under(b))
              .map(([k, pts, look]) => (
                <g key={k}>{line(pts!, look)}</g>
              ))}
            {[main, ...(second ? [second] : [])].map((s, k) => {
              const p = s[hour - 1];
              const c = (k ? d.other : d.main) ? LINE.dimmed : color;
              return p?.v == null ? null : (
                <circle key={k} cx={xOf(p.hour)} cy={yOf(p.v)} r={3.6} fill={k ? "var(--surface-base)" : c} stroke={c} opacity={k ? 0.8 : 1} />
              );
            })}
          </>
        )}

        {/* The sun's highest point, in front of bars and lines (it was hidden behind 日差し's bars). */}
        <text x={xOf(day.edges.noon / 60)} y={sunY(day.edges.noonAltitude) - 4} textAnchor="middle" className="day-sun-label">
          南中 {Math.round(day.edges.noonAltitude)}°
        </text>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <text key={h} x={xOf(h)} y={H - 8} textAnchor="middle" className="chart-x">
            {h}
          </text>
        ))}
      </svg>
      {bandWx && (
        <div className="band-wx" aria-label="時刻ごとの天気（その前後1時間。大きい方が対象日、小さい方が比較日。薄いものは日照と降水からの推定）">
          {WX_TICKS.map((h, i) => (
            <span key={h} className="band-wx-cell" style={{ left: xOf(h) }}>
              <BandWeatherIcons main={bandWx.main[i]} other={bandWx.other?.[i] ?? null} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


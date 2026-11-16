// Small weather icons drawn from the JMA summary text (晴 / 曇 / 雨 / 雪) or the forecast label.

import { dayWeatherOf } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";
import { ICON } from "../design/tokens";
import { STORM, stormOfRow, stormReason, type StormLevel } from "../../shared/storm";

type Sky = "sun" | "cloud" | "sunCloud" | "rain" | "sunRain" | "snow" | "thunder" | "fog" | "none";
export function skyOf(text: string | null | undefined): Sky {
  if (!text) return "none";
  const first = text.split(/後|時々|一時|、/)[0];
  if (/雷/.test(text)) return "thunder";
  if (/雪/.test(first)) return "snow";
  // Rain with sunny spells (#171): 晴時々雨, 雨のち晴 … — the sun and the rain both in the picture.
  if ((/雨/.test(first) && /晴/.test(text)) || (/晴/.test(first) && /雨/.test(text))) return "sunRain";
  if (/雨/.test(first)) return "rain";
  if (/霧/.test(first)) return "fog";
  if (/晴/.test(first) && /曇/.test(text)) return "sunCloud";
  if (/晴|快晴/.test(first)) return "sun";
  if (/曇/.test(first)) return /晴/.test(text) ? "sunCloud" : "cloud";
  if (/雨/.test(text)) return "rain";
  return "cloud";
}

// Colours are named here and read from ICON when drawn, so a change of theme redraws them (#241).
type Ink = keyof typeof ICON;
const SUN: Ink = "sun";
const MOON: Ink = "moon";
const CLOUD: Ink = "cloud";
const RAIN: Ink = "rain";

/**
 * The sky drawn in Lucide's line (https://lucide.dev, ISC; licence in ./icons.tsx), one colour per
 * sky so a row of days reads by colour first: sun yellow, cloud grey, rain blue (#151). Rain with
 * sunny spells alone is two-tone: the sun (or moon) in its colour, the cloud and rain in rain's (#171).
 */
type Part = { color: Ink; d: string };
/** The fillable part of a sky (closed outlines), laid under the line in the face's veil (#242). */
type Shape = { color: Ink; d: string; fill?: string; parts?: Part[] };
const SUN_RAIN = { sun: "M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128", moon: "M18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36", rain: "M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24M11 20v2M7 19v2" };
const SKY: Record<Exclude<Sky, "none">, Shape> = {
  sun: { color: SUN, d: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41", fill: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" },
  sunCloud: { color: SUN, d: "M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z", fill: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" },
  cloud: { color: CLOUD, d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z", fill: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" },
  fog: { color: CLOUD, d: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M16 17H7M17 21H9", fill: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242Z" },
  // Lucide cloud-sun-rain: the sun in its colour, the cloud and the rain in the rain's (the rain decides the day).
  sunRain: { color: RAIN, d: "", fill: "M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24Z", parts: [{ color: SUN, d: SUN_RAIN.sun }, { color: RAIN, d: SUN_RAIN.rain }] },
  rain: { color: RAIN, d: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M16 14v6M8 14v6M12 16v6", fill: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242Z" },
  thunder: { color: RAIN, d: "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973M13 12l-3 5h4l-3 5", fill: "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973Z" },
  snow: { color: CLOUD, d: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01", fill: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242Z" },
};

/** At night a clear sky is the moon, not the sun (#151: 0時・3時 drew a sun). */
const NIGHT: Partial<Record<Sky, Shape>> = {
  // Lucide cloud-moon-rain.
  sunRain: { color: RAIN, d: "", fill: "M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24Z", parts: [{ color: MOON, d: SUN_RAIN.moon }, { color: RAIN, d: SUN_RAIN.rain }] },
  sun: { color: MOON, d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401", fill: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" },
  sunCloud: { color: MOON, d: "M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6zM18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36", fill: "M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6z" },
};

export function WeatherIcon({ text, size = 26, night = false }: { text: string | null | undefined; size?: number; night?: boolean }) {
  const sky = skyOf(text);
  if (sky === "none") return <span className="icon-none">—</span>;
  const moon = night && !!NIGHT[sky];
  const { color, d, fill, parts } = (moon && NIGHT[sky]) || SKY[sky];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={text ?? ""} data-sky={moon ? `${sky}-night` : sky} fill="none" stroke={ICON[color]} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {fill && <path className="icon-veil" d={fill} fill="var(--effect-veil)" stroke="none" />}
      {parts ? parts.map((p) => <path key={p.d} d={p.d} stroke={ICON[p.color]} />) : <path d={d} />}
    </svg>
  );
}

/**
 * A day's weather icon: JMA's 天気概況, or — while it is not out yet — the weather estimated from
 * the day's precipitation and sunshine, drawn fainter and labelled as an estimate.
 */
export function DayWeatherIcon({ row, station, size = 26 }: { row: WeatherRow | null | undefined; station: string | null; size?: number }) {
  const { text, estimated } = dayWeatherOf(row, station);
  const icon = !estimated ? (
    <WeatherIcon text={text} size={size} />
  ) : (
    <span className="weather-estimated" title={`${text}（推定：日照と降水から。気象庁の天気概況はまだ）`} aria-label={`${text}（推定）`}>
      <WeatherIcon text={text} size={size} />
    </span>
  );
  const storm = stormOfRow(row);
  if (!storm) return icon;
  // 強風／暴風 (#175): a small wind mark on the picture's shoulder, by JMA's Kochi criteria.
  const why = stormReason(row?.windMax, row?.gust);
  return (
    <span className="wx-with-storm">
      {icon}
      <StormMark level={storm} why={why} />
    </span>
  );
}

/** The 強風／暴風 mark: Lucide's wind in a small round tag, outlined for 強風 and filled for 暴風. */
export function StormMark({ level, why }: { level: StormLevel; why?: string }) {
  const label = `${STORM[level].label}${why ? `（${why}）` : ""}`;
  return (
    <span className={`storm-mark ${level}`} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2M9.8 4.4A2 2 0 1 1 11 8H2" />
      </svg>
    </span>
  );
}

// Small weather icons drawn from the JMA summary text (晴 / 曇 / 雨 / 雪) or the forecast label.

import { dayWeatherOf } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";
import { ICON } from "../design/tokens";

type Sky = "sun" | "cloud" | "sunCloud" | "rain" | "snow" | "thunder" | "fog" | "none";
export function skyOf(text: string | null | undefined): Sky {
  if (!text) return "none";
  const first = text.split(/後|時々|一時|、/)[0];
  if (/雷/.test(text)) return "thunder";
  if (/雪/.test(first)) return "snow";
  if (/雨/.test(first)) return "rain";
  if (/霧/.test(first)) return "fog";
  if (/晴/.test(first) && /曇/.test(text)) return "sunCloud";
  if (/晴|快晴/.test(first)) return "sun";
  if (/曇/.test(first)) return /晴/.test(text) ? "sunCloud" : "cloud";
  if (/雨/.test(text)) return "rain";
  return "cloud";
}

const { sun: SUN, moon: MOON, cloud: CLOUD, rain: RAIN } = ICON;

/**
 * The sky drawn in Lucide's line (https://lucide.dev, ISC; licence in ./icons.tsx), one colour per
 * sky so a row of days reads by colour first: sun yellow, cloud grey, rain blue (#151).
 */
const SKY: Record<Exclude<Sky, "none">, { color: string; d: string }> = {
  sun: { color: SUN, d: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" },
  sunCloud: { color: SUN, d: "M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" },
  cloud: { color: CLOUD, d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" },
  fog: { color: CLOUD, d: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M16 17H7M17 21H9" },
  rain: { color: RAIN, d: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M16 14v6M8 14v6M12 16v6" },
  thunder: { color: RAIN, d: "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973M13 12l-3 5h4l-3 5" },
  snow: { color: CLOUD, d: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01" },
};

/** At night a clear sky is the moon, not the sun (#151: 0時・3時 drew a sun). */
const NIGHT: Partial<Record<Sky, { color: string; d: string }>> = {
  sun: { color: MOON, d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" },
  sunCloud: { color: MOON, d: "M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6zM18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36" },
};

export function WeatherIcon({ text, size = 26, night = false }: { text: string | null | undefined; size?: number; night?: boolean }) {
  const sky = skyOf(text);
  if (sky === "none") return <span className="icon-none">—</span>;
  const moon = night && !!NIGHT[sky];
  const { color, d } = (moon && NIGHT[sky]) || SKY[sky];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={text ?? ""} data-sky={moon ? `${sky}-night` : sky} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/**
 * A day's weather icon: JMA's 天気概況, or — while it is not out yet — the weather estimated from
 * the day's precipitation and sunshine, drawn fainter and labelled as an estimate.
 */
export function DayWeatherIcon({ row, station, size = 26 }: { row: WeatherRow | null | undefined; station: string | null; size?: number }) {
  const { text, estimated } = dayWeatherOf(row, station);
  if (!estimated) return <WeatherIcon text={text} size={size} />;
  return (
    <span className="weather-estimated" title={`${text}（推定：日照と降水から。気象庁の天気概況はまだ）`} aria-label={`${text}（推定）`}>
      <WeatherIcon text={text} size={size} />
    </span>
  );
}

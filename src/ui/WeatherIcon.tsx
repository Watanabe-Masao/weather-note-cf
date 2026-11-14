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

const { sun: SUN, cloud: CLOUD, rain: RAIN, glint: GLINT } = ICON;

function Sun({ x = 12, y = 12, r = 5 }: { x?: number; y?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return (
      <line
        key={i}
        x1={x + Math.cos(a) * (r + 2)}
        y1={y + Math.sin(a) * (r + 2)}
        x2={x + Math.cos(a) * (r + 4)}
        y2={y + Math.sin(a) * (r + 4)}
        stroke={SUN}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    );
  });
  return (
    <g>
      {rays}
      <circle cx={x} cy={y} r={r} fill={SUN} />
    </g>
  );
}

const Cloud = ({ dx = 0, dy = 0 }: { dx?: number; dy?: number }) => (
  <path
    transform={`translate(${dx} ${dy})`}
    d="M7 18h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 7 18z"
    fill={CLOUD}
  />
);

export function WeatherIcon({ text, size = 26 }: { text: string | null | undefined; size?: number }) {
  const sky = skyOf(text);
  if (sky === "none") return <span className="icon-none">—</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={text ?? ""}>
      {sky === "sun" && <Sun />}
      {sky === "sunCloud" && (
        <>
          <Sun x={9} y={9} r={4} />
          <Cloud dx={1} dy={2} />
        </>
      )}
      {(sky === "cloud" || sky === "fog") && <Cloud dy={-1} />}
      {(sky === "rain" || sky === "thunder") && (
        <>
          <Cloud dy={-4} />
          {[8, 12, 16].map((x) => (
            <line key={x} x1={x} y1={17} x2={x - 1.5} y2={21} stroke={RAIN} strokeWidth={1.6} strokeLinecap="round" />
          ))}
        </>
      )}
      {sky === "snow" && (
        <>
          <Cloud dy={-4} />
          {[8, 12, 16].map((x) => (
            <circle key={x} cx={x} cy={19.5} r={1.3} fill={GLINT} />
          ))}
        </>
      )}
      {sky === "thunder" && <path d="M13 15l-2.5 4h2.5l-1.5 3.5" stroke={SUN} strokeWidth={1.4} fill="none" />}
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

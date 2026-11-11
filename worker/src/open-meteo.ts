// Forecast (8 days, daily + hourly) and sunrise/sunset from Open-Meteo.

import { type Confidence, confidenceOf, ensembleSpreads, type Spread } from "../../shared/confidence";
import type { Station, WeatherRow } from "../../shared/types";

export const weatherCodeText = (code: number | null): string | null =>
  code == null
    ? null
    : code === 0
      ? "快晴"
      : code <= 2
        ? "晴れ時々曇り"
        : code === 3
          ? "曇り"
          : code <= 48
            ? "霧"
            : code <= 57
              ? "霧雨"
              : code <= 67
                ? "雨"
                : code <= 77
                  ? "雪"
                  : code <= 82
                    ? "にわか雨"
                    : code <= 86
                      ? "にわか雪"
                      : "雷雨";

type Series = Record<string, (number | string | null)[] | undefined>;
interface ForecastPayload {
  hourly?: Series & { time?: string[] };
  daily?: Series & { time?: string[]; sunrise?: string[]; sunset?: string[] };
}

const num = (arr: unknown[] | undefined, i: number): number | null => {
  const v = arr?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

function fill(row: WeatherRow, fields: Record<string, string>, src: Series, i: number) {
  for (const [k, name] of Object.entries(fields)) {
    let v = num(src[name], i);
    if (k === "sun" && v != null) v /= 3600;
    row[k] = v;
    row.raw[k] = v == null ? "" : String(Math.round(v * 10) / 10);
    row.quality[k] = v == null ? "missing" : "normal";
  }
}

const HOURLY_FIELDS = {
  temp: "temperature_2m",
  humidity: "relative_humidity_2m",
  rain: "precipitation",
  wind: "wind_speed_10m",
  sun: "sunshine_duration",
  pressure: "pressure_msl",
  probability: "precipitation_probability",
  direction: "wind_direction_10m",
  // Global (shortwave) radiation, W/m², mean of the preceding hour — same window as JMA's hourly 日射量.
  solar: "shortwave_radiation",
};
/** Asked for when the API accepts them; a forecast without them still works (see fetchForecast). */
const OPTIONAL_HOURLY = {
  snow: "snowfall",
  gust: "wind_gusts_10m",
};
const DAILY_FIELDS = {
  temp: "temperature_2m_mean",
  max: "temperature_2m_max",
  min: "temperature_2m_min",
  rain: "precipitation_sum",
  sun: "sunshine_duration",
  probability: "precipitation_probability_max",
};

/**
 * Normalise an Open-Meteo forecast into JMA-shaped rows.
 * Hourly rows use JMA's convention: hour n covers (n-1):00–n:00, and 00:00 is hour 24 of the previous day.
 */
export function normalizeForecast(data: ForecastPayload): { rows: WeatherRow[]; hourlyRows: WeatherRow[] } {
  const hourly = data.hourly ?? {};
  const daily = data.daily ?? {};
  const hourlyRows: WeatherRow[] = (hourly.time ?? []).map((time, i) => {
    const code = num(hourly.weather_code, i);
    let date = time.slice(0, 10);
    let n = +time.slice(11, 13);
    if (n === 0) {
      date = new Date(Date.parse(date + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
      n = 24;
    }
    const row: WeatherRow = {
      date,
      n,
      type: "forecast",
      provider: "Open-Meteo",
      weather: weatherCodeText(code),
      weatherCode: code,
      raw: {},
      quality: {},
    };
    fill(row, HOURLY_FIELDS, hourly, i);
    if (hourly.snowfall || hourly.wind_gusts_10m) fill(row, OPTIONAL_HOURLY, hourly, i);
    return row;
  });

  const rows: WeatherRow[] = (daily.time ?? []).map((date, i) => {
    const code = num(daily.weather_code, i);
    const row: WeatherRow = {
      date,
      n: +date.slice(8),
      type: "forecast",
      provider: "Open-Meteo",
      weatherCode: code,
      dayWeather: weatherCodeText(code),
      raw: {},
      quality: {},
    };
    fill(row, DAILY_FIELDS, daily, i);
    for (const k of ["humidity", "wind", "pressure"]) {
      const values = hourlyRows
        .filter((h) => h.date === date && typeof h[k] === "number")
        .map((h) => h[k] as number);
      const v = values.length === 24 ? values.reduce((a, b) => a + b, 0) / 24 : null;
      row[k] = v;
      row.raw[k] = v == null ? "" : String(Math.round(v * 10) / 10);
      row.quality[k] = v == null ? "missing" : "normal";
    }
    // Totals from the hourly forecast, in JMA's daily units: radiation MJ/㎡, snowfall cm.
    const day = hourlyRows.filter((h) => h.date === date);
    const total = (k: string, scale: number) => {
      const values = day.filter((h) => typeof h[k] === "number").map((h) => h[k] as number);
      return values.length === 24 ? Math.round((values.reduce((a, b) => a + b, 0) * scale) * 100) / 100 : null;
    };
    const extreme = (k: string, pick: (...v: number[]) => number) => {
      const values = day.filter((h) => typeof h[k] === "number").map((h) => h[k] as number);
      return values.length === 24 ? pick(...values) : null;
    };
    for (const [k, v] of [
      ["radiation", total("solar", 3600 / 1e6)],
      ["snow", total("snow", 1)],
      ["humidityMin", extreme("humidity", Math.min)],
      ["gust", extreme("gust", Math.max)],
    ] as const) {
      row[k] = v;
      row.raw[k] = v == null ? "" : String(v);
      row.quality[k] = v == null ? "missing" : "normal";
    }
    row.sunrise = daily.sunrise?.[i] ?? null;
    row.sunset = daily.sunset?.[i] ?? null;
    row.raw.dayWeather = (row.dayWeather as string | null) ?? "";
    return row;
  });
  return { rows, hourlyRows };
}

const coords = (s: Station) => ({
  latitude: String(s.lat[0] + s.lat[1] / 60),
  longitude: String(s.lon[0] + s.lon[1] / 60),
});

export function forecastUrl(station: Station, optional = true): string {
  return (
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      ...coords(station),
      timezone: "Asia/Tokyo",
      forecast_days: "16", // today + 15 days (the most Open-Meteo gives)
      wind_speed_unit: "ms",
      hourly: [...Object.values(HOURLY_FIELDS), ...(optional ? Object.values(OPTIONAL_HOURLY) : []), "weather_code"].join(","),
      daily: [...Object.values(DAILY_FIELDS), "weather_code", "sunrise", "sunset"].join(","),
    })
  );
}

/** The ensemble used for 信頼度: ECMWF IFS (51 runs, 15 days), daily max/min and rain per run. */
export function ensembleUrl(station: Station): string {
  return (
    "https://ensemble-api.open-meteo.com/v1/ensemble?" +
    new URLSearchParams({
      ...coords(station),
      timezone: "Asia/Tokyo",
      models: "ecmwf_ifs025",
      forecast_days: "16",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    })
  );
}

/** 信頼度 per forecast day; an empty map when the ensemble is unavailable (the forecast still works). */
async function fetchConfidence(station: Station): Promise<Map<string, { confidence: Confidence; spread: Spread }>> {
  const out = new Map<string, { confidence: Confidence; spread: Spread }>();
  try {
    const r = await fetch(ensembleUrl(station), { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return out;
    const data = (await r.json()) as { daily?: Record<string, unknown> };
    for (const [date, spread] of ensembleSpreads(data.daily ?? {})) out.set(date, { confidence: confidenceOf(spread), spread });
  } catch {
    // No 信頼度 this time.
  }
  return out;
}

export async function fetchForecast(station: Station) {
  const confidence = fetchConfidence(station);
  let source = forecastUrl(station);
  let r = await fetch(source, { signal: AbortSignal.timeout(25_000) });
  // An unknown variable makes Open-Meteo answer 400: the forecast matters more than the extras.
  if (r.status === 400) {
    source = forecastUrl(station, false);
    r = await fetch(source, { signal: AbortSignal.timeout(25_000) });
  }
  if (!r.ok) throw new Error(`予報の取得に失敗しました（${r.status}）。`);
  const data = (await r.json()) as ForecastPayload & { error?: boolean; reason?: string };
  if (data.error || !data.daily?.time?.length) throw new Error(data.reason ?? "予報データがありません。");
  const forecast = normalizeForecast(data);
  const conf = await confidence;
  for (const row of forecast.rows) {
    const c = conf.get(row.date);
    if (c) Object.assign(row, { confidence: c.confidence, spread: c.spread });
  }
  return { ...forecast, source, provider: "Open-Meteo" };
}

export async function fetchSunTimes(station: Station, day: string, today: string) {
  const archive = day < new Date(Date.parse(today + "T00:00:00Z") - 7 * 86_400_000).toISOString().slice(0, 10);
  const source =
    (archive ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast") +
    "?" +
    new URLSearchParams({
      ...coords(station),
      timezone: "Asia/Tokyo",
      start_date: day,
      end_date: day,
      daily: "sunrise,sunset",
    });
  const r = await fetch(source, { signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error("日の出・日の入りを取得できませんでした。");
  const data = (await r.json()) as { daily?: { sunrise?: string[]; sunset?: string[] } };
  return { date: day, sunrise: data.daily?.sunrise?.[0] ?? null, sunset: data.daily?.sunset?.[0] ?? null, source };
}

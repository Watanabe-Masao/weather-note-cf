// Latest AMeDAS observations (www.jma.go.jp/bosai/amedas), used for today and the two days
// before the daily tables are published.

import { addDays, jstToday } from "../../shared/dates";
import type { Station, WeatherRow } from "../../shared/types";
import { SourceError } from "./errors";

type Pair = [number, number] | undefined;
type Point = Record<string, Pair | unknown>;
export type PointData = Record<string, Point>;

const value = (pair: unknown): number | null =>
  Array.isArray(pair) && pair[1] === 0 && Number.isFinite(pair[0]) ? (pair[0] as number) : null;

const FIELDS: Record<string, string> = {
  temp: "temp",
  humidity: "humidity",
  rain: "precipitation1h",
  wind: "wind",
  sun: "sun1h",
  pressure: "normalPressure",
};

const compact = (day: string) => day.replaceAll("-", "");

function toRow(key: string, source: Point, day: string): WeatherRow {
  const row: WeatherRow = {
    date: day,
    n: +key.slice(8, 10),
    observedAt: key.slice(8, 10) + ":" + key.slice(10, 12),
    type: "actual",
    provider: "JMA-amedas",
    provisional: true,
    raw: {},
    quality: {},
  };
  for (const [field, name] of Object.entries(FIELDS)) {
    const v = value(source[name]);
    row[field] = v;
    row.raw[field] = v == null ? "" : String(v);
    row.quality[field] = v == null ? "missing" : "normal";
  }
  const dir = value(source.windDirection);
  row.direction = dir != null && dir !== 0 ? dir * 22.5 : null;
  return row;
}

/** Hourly rows (values on the hour) for one day, plus the latest 10-minute observation. */
export function parseLivePoint(data: PointData, day: string): { rows: WeatherRow[]; latest: WeatherRow | null } {
  const keys = Object.keys(data)
    .filter((k) => k.startsWith(compact(day)))
    .sort();
  return {
    rows: keys.filter((k) => k.slice(10) === "0000" && +k.slice(8, 10) >= 1).map((k) => toRow(k, data[k], day)),
    latest: keys.length ? toRow(keys.at(-1)!, data[keys.at(-1)!], day) : null,
  };
}

/** Provisional daily values for a finished day, built from 10-minute observations. */
export function aggregateRecentDay(data: PointData, day: string): { daily: WeatherRow; hourly: WeatherRow[] } {
  const next = addDays(day, 1);
  const closingKey = compact(next) + "000000";
  const closing = data[closingKey];
  const hours = parseLivePoint(data, day).rows.slice();
  if (closing) {
    const r = parseLivePoint({ [closingKey]: closing }, next).latest;
    if (r) hours.push({ ...r, n: 24, date: day, observedAt: "24:00" });
  }
  const samples = (name: string) =>
    Object.keys(data)
      .filter((k) => (k.startsWith(compact(day)) && k.slice(8) !== "000000") || k === closingKey)
      .sort()
      .map((k) => value(data[k][name]))
      .filter((v): v is number => v != null);
  const closingValue = (name: string) => (closing ? value(closing[name]) : null);

  const out: WeatherRow = {
    date: day,
    n: +day.slice(8),
    type: "actual",
    provider: "JMA-recent",
    provisional: true,
    dayWeather: null,
    nightWeather: null,
    raw: {},
    quality: {},
    coverage: {},
  };
  const coverage = out.coverage as Record<string, { count: number; expected: number }>;
  const set = (k: string, v: number | null, count: number, expected: number) => {
    out[k] = v == null ? null : Math.round(v * 10) / 10;
    out.raw[k] = out[k] == null ? "" : String(out[k]);
    coverage[k] = { count, expected };
    out.quality[k] = out[k] == null ? "missing" : count < expected ? "partial" : "normal";
  };
  const mean = (vs: number[]) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);

  for (const [k, name] of Object.entries({ temp: "temp", humidity: "humidity", wind: "wind", pressure: "normalPressure" })) {
    const vs = samples(name);
    set(k, mean(vs), vs.length, 144);
  }
  const temps = samples("temp");
  const max = closingValue("maxTemp");
  const min = closingValue("minTemp");
  set("max", max ?? (temps.length ? Math.max(...temps) : null), max != null ? 144 : temps.length, 144);
  set("min", min ?? (temps.length ? Math.min(...temps) : null), min != null ? 144 : temps.length, 144);
  const rain24 = closingValue("precipitation24h");
  const hourRain = hours.filter((r) => typeof r.rain === "number");
  set(
    "rain",
    rain24 ?? (hourRain.length === 24 ? hourRain.reduce((s, r) => s + (r.rain as number), 0) : null),
    rain24 != null ? 24 : hourRain.length,
    24,
  );
  const sun = hours.filter((r) => typeof r.sun === "number");
  set("sun", sun.length === 24 ? sun.reduce((s, r) => s + (r.sun as number), 0) : null, sun.length, 24);
  return { daily: out, hourly: hours };
}

// The AMeDAS station table is metadata: keep it for the life of the Worker instance.
let amedasTable: Record<string, { kjName: string; type: string; lat: [number, number]; lon: [number, number] }> | null =
  null;

async function amedasStation(station: Station) {
  if (!amedasTable) {
    const r = await fetch("https://www.jma.go.jp/bosai/amedas/const/amedastable.json", {
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new SourceError("観測所の一覧を取得できませんでした。");
    amedasTable = await r.json();
  }
  const entries = Object.entries(amedasTable!);
  let found =
    entries.find(([id, s]) => s.kjName === station.name && +id.slice(0, 2) === station.precNo) ??
    entries.find(([, s]) => s.kjName === station.name);
  if (!found) {
    const lat = station.lat[0] + station.lat[1] / 60;
    const lon = station.lon[0] + station.lon[1] / 60;
    const nearest = entries
      .filter(([, s]) => s.type === "A" || s.type === "S")
      .map(([id, s]) => ({ id, s, d: (lat - s.lat[0] - s.lat[1] / 60) ** 2 + (lon - s.lon[0] - s.lon[1] / 60) ** 2 }))
      .sort((a, b) => a.d - b.d)[0];
    if (nearest && nearest.d < 0.02) found = [nearest.id, nearest.s];
  }
  if (!found) throw new SourceError("この地点の最新観測所を対応付けできませんでした。");
  return { id: found[0], name: found[1].kjName, type: found[1].type };
}

/** Observations for today, or a provisional summary for one of the two previous days. */
export async function observations(station: Station, day: string = jstToday()) {
  const { id, name, type } = await amedasStation(station);
  const latestResponse = await fetch("https://www.jma.go.jp/bosai/amedas/data/latest_time.txt", {
    signal: AbortSignal.timeout(20_000),
  });
  if (!latestResponse.ok) throw new SourceError("最新の観測時刻を取得できませんでした。");
  const latestTime = (await latestResponse.text()).trim();
  const today = jstToday();
  const lastHour = day < today ? 23 : latestTime.slice(0, 10) === day ? +latestTime.slice(11, 13) : 0;
  const blocks = Array.from({ length: Math.floor(lastHour / 3) + 1 }, (_, i) => String(i * 3).padStart(2, "0"));
  const results = await Promise.allSettled(
    blocks.map(async (block) => {
      const r = await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${id}/${compact(day)}_${block}.json`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new SourceError("観測データを取得できませんでした。");
      return (await r.json()) as PointData;
    }),
  );
  const joined: PointData = Object.assign(
    {},
    ...results.filter((r): r is PromiseFulfilledResult<PointData> => r.status === "fulfilled").map((r) => r.value),
  );
  if (!Object.keys(joined).length) throw new SourceError("最新観測データを取得できませんでした。");

  let recent: ReturnType<typeof aggregateRecentDay> | null = null;
  if (day < today) {
    const next = addDays(day, 1);
    try {
      const end = await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${id}/${compact(next)}_00.json`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (end.ok) {
        const data = (await end.json()) as PointData;
        const key = compact(next) + "000000";
        if (data[key]) joined[key] = data[key];
      }
    } catch {
      // The closing 00:00 observation is optional.
    }
    recent = aggregateRecentDay(joined, day);
  }
  return {
    ...parseLivePoint(joined, day),
    ...(recent ? { rows: recent.hourly, daily: recent.daily } : {}),
    stationId: id,
    stationName: name,
    stationType: type,
    date: day,
    latestTime,
    provider: "JMA",
    source: "https://www.jma.go.jp/bosai/amedas/",
  };
}

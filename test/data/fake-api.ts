// A counted stand-in for the Worker API, producing plausible rows for any date.

import { addDays, daysBetween, daysOfMonth } from "../../shared/dates";
import { isFixedDay } from "../../shared/fixed";
import type { WeatherRow } from "../../shared/types";

export const TODAY = "2026-11-10";
export const NOW = Date.parse("2026-11-10T03:00:00Z"); // 12:00 in Japan

export function dailyRow(date: string, _today = TODAY, unpublished: string[] = []): WeatherRow {
  const seed = Number(date.replaceAll("-", "")) % 97;
  return {
    date,
    n: +date.slice(8),
    type: "actual",
    provider: "JMA",
    max: 20 + (seed % 7),
    min: 10 + (seed % 5),
    rain: seed % 3,
    sun: unpublished.includes("sun") ? null : 5,
    dayWeather: "晴",
    raw: { max: "20", min: "10", rain: "0", sun: unpublished.includes("sun") ? "" : "5.0" },
    quality: {},
    unpublished,
  };
}

export interface FakeApi {
  fetchJson: <T>(path: string) => Promise<T>;
  calls: string[];
  /** Paths that fail (substring match) until removed. */
  failing: Set<string>;
  /** Highest number of requests in flight at once. */
  maxInFlight: number;
  today: string;
}

export function fakeApi(today = TODAY): FakeApi {
  const api: FakeApi = {
    calls: [],
    failing: new Set(),
    maxInFlight: 0,
    today,
    fetchJson: async <T>(path: string): Promise<T> => {
      api.calls.push(path);
      inFlight++;
      api.maxInFlight = Math.max(api.maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 1));
        for (const f of api.failing) if (path.includes(f)) throw new Error("気象庁への接続に失敗しました（503）。");
        return respond(path, api.today) as T;
      } finally {
        inFlight--;
      }
    },
  };
  let inFlight = 0;
  return api;
}

function respond(path: string, today: string): unknown {
  const url = new URL(path, "https://x.test");
  const q = url.searchParams;
  switch (url.pathname) {
    case "/api/daily": {
      const month = q.get("month")!;
      // Yesterday has its sunshine column still unpublished, like the real table.
      const rows = daysOfMonth(month)
        .filter((d) => d < today)
        .map((d) => dailyRow(d, today, d === addDays(today, -1) ? ["sun"] : []));
      return { station: q.get("station"), month, rows, fixed: rows.every((r) => isFixedDay(r, today)), source: null, fetchedAt: "" };
    }
    case "/api/recent": {
      const date = q.get("date")!;
      return { daily: { ...dailyRow(date, today), provider: "JMA-recent", provisional: true, dayWeather: null }, rows: [] };
    }
    case "/api/current":
      return {
        rows: [1, 2, 3].map((n) => ({ ...dailyRow(today, today), n, type: "actual" })),
        latest: { ...dailyRow(today, today), observedAt: "11:50" },
      };
    case "/api/forecast": {
      const ds = daysBetween(today, addDays(today, 7));
      return {
        rows: ds.map((d) => ({ ...dailyRow(d, today), type: "forecast", provider: "Open-Meteo" })),
        hourlyRows: ds.flatMap((d) =>
          Array.from({ length: 24 }, (_, i) => ({ ...dailyRow(d, today), n: i + 1, type: "forecast", temp: 15 })),
        ),
      };
    }
    case "/api/hourly": {
      const days = daysBetween(q.get("from")!, q.get("to")!).map((date) => ({
        date,
        rows: Array.from({ length: 24 }, (_, i) => ({ ...dailyRow(date, today), n: i + 1, temp: 14 })),
        fixed: date <= addDays(today, -3),
      }));
      return { station: q.get("station"), days, fetchedAt: "" };
    }
  }
  throw new Error("unexpected " + path);
}

// Weather Note API. Static files (the app) are served by Workers static assets;
// only /api/* reaches this code (see wrangler.jsonc).

import { addDays, daysBetween, FIRST_DAY, FORECAST_DAYS, isDay, isMonth, jstToday, lastDayOfMonth, monthOf } from "../../shared/dates";
import { correctionRev } from "../../shared/corrections";
import { inRevalidation, isFixedHourlyDay, isFixedMonth } from "../../shared/fixed";
import type { DailyMonthResponse, HourlyDay, HourlyResponse, Station } from "../../shared/types";
import { observations } from "./amedas";
import { cachedFor, cachedJson, cachedValue, jsonResponse, RECHECK_TTL, storeValue } from "./cache";
import { SourceError } from "./errors";
import { fetchDailyMonth, fetchHourlyDay } from "./jma-tables";
import { CACHE_VERSION, HOURLY_CONCURRENCY, MAX_HOURLY_DAYS, stations } from "./config";
import { fetchForecast, fetchSunTimes } from "./open-meteo";

class BadRequest extends Error {}

/** What the person sees: our own messages as they are; anything else is logged and summarised. */
function publicMessage(e: unknown): string {
  if (e instanceof SourceError) return e.message;
  console.error("weather-note: upstream failure", e);
  return (e as Error)?.name === "TimeoutError" ? "取得に時間がかかりすぎました。時間をおいて再試行してください。" : "取得に失敗しました。時間をおいて再試行してください。";
}

const FORECAST_TTL = 30 * 60; // seconds

const findStation = (id: string | null): Station => {
  const s = stations.find((x) => x.blockNo === id);
  if (!s) throw new BadRequest("観測地点を選んでください。");
  return s;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function handle(req: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const today = jstToday();
  const waitUntil = (p: Promise<unknown>) => ctx.waitUntil(p);

  switch (url.pathname) {
    case "/api/stations":
      return jsonResponse(stations);

    case "/api/daily": {
      const station = findStation(q.get("station"));
      const month = q.get("month");
      if (!isMonth(month) || month < monthOf(FIRST_DAY) || month > monthOf(today))
        throw new BadRequest("月の指定が正しくありません。");
      // The key carries the corrections ledger's revision for this month: a listed correction
      // makes the edge read the month again; other months keep their copy.
      const rev = correctionRev(station.blockNo, `${month}-01`, lastDayOfMonth(month));
      return cachedJson<DailyMonthResponse>(url.origin, `${CACHE_VERSION}/daily/${station.blockNo}/${month}/r${rev}`, waitUntil, async () => {
        const { rows, source } = await fetchDailyMonth(station, month, today);
        const fixed = isFixedMonth(month, rows, today);
        return {
          fixed,
          ttl: inRevalidation(lastDayOfMonth(month), today) ? RECHECK_TTL : undefined,
          body: { station: station.blockNo, month, rows, fixed, source, fetchedAt: new Date().toISOString() },
        };
      });
    }

    case "/api/hourly": {
      const station = findStation(q.get("station"));
      const from = q.get("from");
      const to = q.get("to") ?? from;
      if (!isDay(from) || !isDay(to) || from > to || from < FIRST_DAY || to >= today)
        throw new BadRequest("期間の指定が正しくありません（今日より前の日）。");
      const ds = daysBetween(from, to);
      if (ds.length > MAX_HOURLY_DAYS) throw new BadRequest(`一度に取得できるのは${MAX_HOURLY_DAYS}日までです。`);
      const days = await mapLimit(ds, HOURLY_CONCURRENCY, async (day): Promise<HourlyDay> => {
        const key = `${CACHE_VERSION}/hourly/${station.blockNo}/${day}/r${correctionRev(station.blockNo, day, day)}`;
        const hit = await cachedValue<HourlyDay>(url.origin, key);
        if (hit) return hit;
        try {
          const { rows } = await fetchHourlyDay(station, day);
          const result: HourlyDay = { date: day, rows, fixed: isFixedHourlyDay(day, rows, today) };
          if (result.fixed) storeValue(url.origin, key, result, waitUntil, inRevalidation(day, today) ? RECHECK_TTL : undefined);
          return result;
        } catch (e) {
          return { date: day, rows: [], fixed: false, error: publicMessage(e) };
        }
      });
      const body: HourlyResponse = { station: station.blockNo, days, fetchedAt: new Date().toISOString() };
      return jsonResponse(body);
    }

    case "/api/recent": {
      const station = findStation(q.get("station"));
      const day = q.get("date");
      if (!isDay(day) || day < addDays(today, -2) || day >= today)
        throw new BadRequest("速報値は直近2日分が対象です。");
      return jsonResponse({ ...(await observations(station, day)), fetchedAt: new Date().toISOString() });
    }

    case "/api/current": {
      const station = findStation(q.get("station"));
      return jsonResponse({ ...(await observations(station)), fetchedAt: new Date().toISOString() });
    }

    case "/api/forecast": {
      const station = findStation(q.get("station"));
      // The forecast (and its 51-member ensemble) changes a few times a day: share one fetch per
      // station for 30 minutes, so opening the app does not call Open-Meteo every time.
      return cachedFor(url.origin, `${CACHE_VERSION}/forecast/${station.blockNo}`, FORECAST_TTL, waitUntil, async () => ({
        ...(await fetchForecast(station)),
        fetchedAt: new Date().toISOString(),
      }));
    }

    case "/api/sun": {
      const station = findStation(q.get("station"));
      const day = q.get("date");
      if (!isDay(day) || day < FIRST_DAY || day > addDays(today, FORECAST_DAYS)) throw new BadRequest("日付を確認してください。");
      // Sunrise and sunset are calculated, so past days never change.
      return cachedJson(url.origin, `sun/${station.blockNo}/${day}`, waitUntil, async () => ({
        body: await fetchSunTimes(station, day, today),
        fixed: day < today,
      }));
    }
  }
  return jsonResponse({ error: "Not found" }, 404);
}

export default {
  async fetch(req: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "GET") return jsonResponse({ error: "GET only" }, 405);
    try {
      return await handle(req, ctx);
    } catch (e) {
      if (e instanceof BadRequest) return jsonResponse({ error: e.message }, 400);
      return jsonResponse({ error: publicMessage(e) }, 502);
    }
  },
} satisfies ExportedHandler;

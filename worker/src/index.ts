// Weather Note API. Static files (the app) are served by Workers static assets;
// only /api/* reaches this code (see wrangler.jsonc).

import { rainNow, rainTile } from "./rainNow";
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
import { type AccountsEnv, type Db, ensureSchema, handleAccounts, isAccountPath } from "./accounts";
import { runSchedule } from "./notify";
import { activeTyphoons } from "./typhoon";
import { collectForecasts } from "./forecastArchive";
import { collectWarnings } from "./warningArchive";
import { parseForecasts } from "./forecastParse";
import { forecastHistory } from "./forecastHistory";
import { watchForecastArchive } from "./forecastWatch";
import { copyTelegrams, saveCharts } from "./r2Archive";
import { saveRadar } from "./radarArchive";
import { collectLongRange } from "./longRangeArchive";
import { health, markStart, timed } from "./health";
import { claimHealthWatch, watchHealth } from "./healthWatch";
import { collectTyphoons } from "./typhoonArchive";
import { recentTracks, typhoonTelegrams } from "./typhoonRecent";
import { forecastCharts } from "../../shared/wxchart";
import { runTyphoonNotify } from "./typhoonNotify";
import { logTyphoonJson, watchTyphoonSources } from "./typhoonWatch";

class BadRequest extends Error {}

/** What the person sees: our own messages as they are; anything else is logged and summarised. */
function publicMessage(e: unknown): string {
  if (e instanceof SourceError) return e.message;
  console.error("weather-note: upstream failure", e);
  return (e as Error)?.name === "TimeoutError" ? "取得に時間がかかりすぎました。時間をおいて再試行してください。" : "取得に失敗しました。時間をおいて再試行してください。";
}

const FORECAST_TTL = 30 * 60; // seconds
const TYPHOON_TTL = 30 * 60;
const HISTORY_TTL = 10 * 60;

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

async function handle(req: Request, ctx: ExecutionContext, db?: Db, env: AccountsEnv = {}): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const today = jstToday();
  const waitUntil = (p: Promise<unknown>) => ctx.waitUntil(p);

  // 雨の見込み（確認用）：気象庁のタイルを地点のまわりだけ中継する（worker/src/rainNow.ts）。
  if (url.pathname.startsWith("/api/rain-tile/")) return rainTile(url.pathname, url.origin, waitUntil);

  switch (url.pathname) {
    case "/api/rain-now": {
      // 雨の見込み（確認用）：気象庁の一覧から組んだ地図のこま。一覧は1分ごとに変わるので、端に1分だけ置く。
      const station = findStation(q.get("station"));
      return cachedFor(url.origin, `${CACHE_VERSION}/rain-now/${station.blockNo}`, 60, waitUntil, () => rainNow(station.blockNo));
    }
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

    case "/api/health": {
      // 監視と管理 (health.ts): room left under the plan, what is kept for nothing, and whether it works. A minute at the edge.
      if (!db) return jsonResponse({ v: 1, error: "no database" }, 503);
      return cachedFor(url.origin, `${CACHE_VERSION}/health`, 60, waitUntil, () => health(db, Date.now(), env));
    }
    case "/api/forecast-history": {
      // 予報の履歴 (#250, R6): one day's issues and values as kept, for 「この日の予報の移り変わり」. Shared for
      // 10 minutes (new issues come at 5・11・17時 and are read within minutes).
      const station = findStation(q.get("station"));
      const day = q.get("date");
      if (!isDay(day) || day < FIRST_DAY || day > addDays(today, FORECAST_DAYS)) throw new BadRequest("日付を確認してください。");
      if (!db) return jsonResponse({ v: 1, station: station.blockNo, date: day, supported: false });
      return cachedFor(url.origin, `${CACHE_VERSION}/forecast-history/${station.blockNo}/${day}`, HISTORY_TTL, waitUntil, () =>
        forecastHistory(db, station.blockNo, day),
      );
    }
    case "/api/wxchart-forecast": {
      // 予想天気図 (#249): JMA's latest 24・48時間 charts, as its weather map page lists them, shared for 30 minutes.
      return cachedFor(url.origin, `${CACHE_VERSION}/wxchart-forecast`, TYPHOON_TTL, waitUntil, async () => {
        const r = await fetch("https://www.jma.go.jp/bosai/weather_map/data/list.json");
        if (!r.ok) throw new Error(`weather_map list ${r.status}`);
        return { v: 1, source: "気象庁ホームページ", charts: forecastCharts(await r.json()) };
      });
    }
    case "/api/typhoon-recent": {
      // 当時の発表で埋める: the typhoons of the telegrams kept, from a day (the best track's next), shared for 30 minutes.
      const since = q.get("from") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new BadRequest("from=YYYY-MM-DD");
      if (!db) return jsonResponse({ v: 1, source: "", from: null, to: null, storms: [] });
      return cachedFor(url.origin, `${CACHE_VERSION}/typhoon-recent/${since}`, TYPHOON_TTL, waitUntil, () => recentTracks(db, since));
    }
    case "/api/typhoon-telegrams": {
      // 当時の発表: one typhoon's announcements kept (yyNN), shared for 30 minutes.
      const number = q.get("number") ?? "";
      if (!/^\d{4}$/.test(number)) throw new BadRequest("number=yyNN");
      if (!db) return jsonResponse({ v: 1, source: "", number, announcements: [] });
      return cachedFor(url.origin, `${CACHE_VERSION}/typhoon-telegrams/${number}`, TYPHOON_TTL, waitUntil, () => typhoonTelegrams(db, number));
    }
    case "/api/typhoon": {
      // 近づいている台風: JMA's information as it gives it, shared for 30 minutes (worker/src/typhoon.ts).
      // Each read of JMA (a cache miss) is logged, so a run of failures or a changed form is told (typhoonWatch.ts).
      return cachedFor(url.origin, `${CACHE_VERSION}/typhoon`, TYPHOON_TTL, waitUntil, async () => {
        const r = await activeTyphoons();
        if (db) waitUntil(logTyphoonJson(db, { ok: r.ok, numbers: r.typhoons.map((t) => t.number) }).catch((e) => console.error("weather-note: typhoon json log", e)));
        return r;
      });
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
  async fetch(req: Request, env: AccountsEnv, ctx: ExecutionContext): Promise<Response> {
    // Accounts and reports (D1): their own rules, never the edge cache.
    if (isAccountPath(new URL(req.url).pathname)) return handleAccounts(req, env);
    if (req.method !== "GET") return jsonResponse({ error: "GET only" }, 405);
    try {
      return await handle(req, ctx, env.DB, env);
    } catch (e) {
      if (e instanceof BadRequest) return jsonResponse({ error: e.message }, 400);
      return jsonResponse({ error: publicMessage(e) }, 502);
    }
  },
  /** Every 5 minutes (wrangler.jsonc): the report notifications that are due, JMA's new telegrams (#220), and once an hour the health look. */
  async scheduled(event: ScheduledController, env: AccountsEnv, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) return;
    const db = env.DB;
    // Each stage's time and outcome is kept (health.ts: cron_runs), so the room left and a slow stage can be seen.
    const at = new Date(event.scheduledTime).toISOString();
    const stage = (name: string, fn: () => Promise<unknown>) => () => timed(db, at, name, fn);
    // 定時処理の抜け (health.ts cronGaps): the run kept first, with how late it started.
    ctx.waitUntil(markStart(db, at, Date.now() - event.scheduledTime));
    ctx.waitUntil(stage("notify", () => ensureSchema(db).then(() => runSchedule(db)))());
    // Apart from the notifications: a failure here never stops them (and is logged in its own table).
    // Then the sources are watched, and the administrators told when one stops (typhoonWatch.ts).
    ctx.waitUntil(
      stage("typhoon archive", () => collectTyphoons(db))()
        .then(stage("typhoon watch", () => watchTyphoonSources(db)))
        // 台風の目安: after the new telegrams are in (typhoonNotify.ts).
        .then(stage("typhoon notify", () => ensureSchema(db).then(() => runTyphoonNotify(db))))
        // 予報の履歴 (#250): JMA's forecasts of the offices in use, kept as issued (forecastArchive.ts).
        .then(stage("forecast archive", () => collectForecasts(db)))
        // R5-3: the administrators told when the forecast archive stops (forecastWatch.ts) — before the
        // reading, which is heavier: a watch that must not wait on it, nor be cut by its limits.
        .then(stage("forecast watch", () => watchForecastArchive(db)))
        // 警報・注意報の電文 (高知県, warningArchive.ts): before the reading too — a telegram missed for 7 days cannot be taken again.
        .then(stage("warning archive", () => collectWarnings(db)))
        // Then read what was kept: values with their times, for the history (forecastParse.ts).
        .then(stage("forecast parse", () => parseForecasts(db))),
    );
    // 毎時の見張り (healthWatch.ts), apart from the rest: once an hour (most runs only find it is not due,
    // one statement), /api/health judged and the administrators told when a problem starts or is over.
    ctx.waitUntil(
      claimHealthWatch(db, event.scheduledTime)
        .then((due) => (due ? stage("health watch", () => watchHealth(db, event.scheduledTime, env))() : undefined))
        .catch((e) => console.error("weather-note: health watch", e)),
    );
    // Files kept in R2 (r2Archive.ts), apart from the rest: the rain radar every 30 minutes first (JMA lists
    // only about 3 hours of it, radarArchive.ts), the day's weather charts, and the telegrams copied as files.
    const bucket = env.ARCHIVE;
    if (bucket)
      ctx.waitUntil(
        stage("radar save", () => saveRadar(db, bucket))()
          .then(stage("wxchart save", () => saveCharts(db, bucket)))
          .then(stage("archive copy", () => copyTelegrams(db, bucket)))
          // 長い先の予報（1か月予報・早期天候情報・2週間気温予報）：R2 に gzip で、30分ごと（longRangeArchive.ts）。
          .then(stage("long range", () => collectLongRange(db, bucket))),
      );
  },
} satisfies ExportedHandler<AccountsEnv>;

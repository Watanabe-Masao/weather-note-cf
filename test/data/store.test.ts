import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, daysBetween } from "../../shared/dates";
import { DATA_VERSION, memoryStorage, openStorage, type Storage } from "../../src/data/db";
import { FORECAST_DAYS, viewPlan } from "../../src/data/plan";
import { WeatherStore } from "../../src/data/store";
import { fakeApi, NOW, TODAY } from "./fake-api";

const KOCHI = "47893";

function makeStore(storage: Storage, api = fakeApi(), now = () => NOW) {
  const timers: { fn: () => void; ms: number }[] = [];
  const local = new Map<string, string>();
  const store = new WeatherStore({
    storage,
    fetchJson: api.fetchJson,
    now,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => timers.splice(timers.indexOf(t as (typeof timers)[number]), 1),
    localStore: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => void local.set(k, v) },
  });
  return { store, api, timers, local };
}

const visible = (center: string) => daysBetween(addDays(center, -3), addDays(center, 3));

beforeEach(() => {
  // A fresh, empty IndexedDB for every test.
  globalThis.indexedDB = new IDBFactory();
});

describe("plan", () => {
  it("puts the month ahead in the direction of travel before the week behind", () => {
    const back = viewPlan(["2025-06-15"], -1, TODAY);
    expect(back.get("2025-06-15")).toBe(0);
    expect(back.get("2025-05-20")).toBe(1); // ahead when travelling into the past
    expect(back.get("2025-06-22")).toBe(2); // behind
    const forward = viewPlan(["2025-06-15"], 1, TODAY);
    expect(forward.get("2025-07-10")).toBe(1);
    expect(forward.get("2025-06-08")).toBe(2);
  });

  it("never plans beyond the forecast or before 1977", () => {
    const plan = viewPlan([TODAY], 1, TODAY);
    expect([...plan.keys()].every((d) => d <= addDays(TODAY, FORECAST_DAYS))).toBe(true);
    expect([...viewPlan(["1977-01-02"], -1, TODAY).keys()].every((d) => d >= "1977-01-01")).toBe(true);
  });
});

describe("acceptance criteria (spec 2.7)", () => {
  it("fills the seven visible days when the view first opens", async () => {
    const { store } = makeStore(await openStorage());
    store.setView(KOCHI, ["2025-06-15"]);
    await store.idle();
    for (const d of visible("2025-06-15")) expect(store.getDay(KOCHI, d)).toMatchObject({ state: "ready", kind: "fixed" });
  });

  it("returning to a range already seen makes no request", async () => {
    const { store, api } = makeStore(await openStorage());
    store.setView(KOCHI, ["2025-06-15"]);
    await store.idle();
    store.setView(KOCHI, ["2024-01-15"], -1);
    await store.idle();
    const before = api.calls.length;
    store.setView(KOCHI, ["2025-06-15"], 1);
    await store.idle();
    store.setView(KOCHI, ["2025-06-20"], 1);
    await store.idle();
    expect(api.calls.length).toBe(before);
  });

  it("after a restart, fixed data comes from storage with no request", async () => {
    const storage = await openStorage();
    const first = makeStore(storage);
    first.store.setView(KOCHI, ["2025-06-15"]);
    await first.store.idle();

    const second = makeStore(storage);
    await second.store.start();
    second.store.setView(KOCHI, ["2025-06-15"]);
    await second.store.idle();
    expect(second.api.calls).toEqual([]);
    expect(second.store.getDay(KOCHI, "2025-06-15").state).toBe("ready");
  });

  it("fetches variable data once per session, not on every visit", async () => {
    const { store, api } = makeStore(await openStorage());
    store.setView(KOCHI, [TODAY]);
    await store.idle();
    const firstRound = api.calls.length;
    expect(api.calls.some((c) => c.startsWith("/api/forecast"))).toBe(true);
    expect(api.calls.some((c) => c.includes("month=2026-11"))).toBe(true);

    store.setView(KOCHI, ["2026-09-01"], -1);
    await store.idle();
    const afterPast = api.calls.length;
    store.setView(KOCHI, [TODAY], 1);
    await store.idle();
    expect(api.calls.length).toBe(afterPast); // coming back to today: nothing refetched
    expect(firstRound).toBeGreaterThan(0);
  });

  it("refreshes variable data on the refresh button and when the date changes; fixed data only while being re-checked", async () => {
    let now = NOW;
    const { store, api } = makeStore(await openStorage(), fakeApi(), () => now);
    store.setView(KOCHI, ["2026-08-15"]);
    await store.idle();
    api.calls.length = 0;
    store.refresh();
    await store.idle();
    expect(api.calls.some((c) => c.includes("month=2026-08"))).toBe(false); // fixed, past its re-check period

    store.setView(KOCHI, [TODAY]);
    await store.idle();
    api.calls.length = 0;
    store.refresh();
    await store.idle();
    expect(api.calls.some((c) => c.startsWith("/api/forecast"))).toBe(true);
    // October is fixed but ended less than 30 days ago: checked again once per session (正本管理).
    expect(api.calls.some((c) => c.includes("month=2026-10"))).toBe(true);

    api.calls.length = 0;
    now += 86_400_000;
    api.today = addDays(TODAY, 1);
    expect(await store.checkDate()).toBe(true);
    await store.idle();
    expect(api.calls.some((c) => c.startsWith("/api/forecast"))).toBe(true);
    expect(store.today).toBe("2026-11-11");
  });

  it("holds screen updates during a gesture and delivers them once on release", async () => {
    const { store } = makeStore(await openStorage());
    let updates = 0;
    store.subscribe(() => updates++);
    store.hold(true);
    store.setView(KOCHI, ["2025-06-15"], -1);
    await store.idle();
    await Promise.resolve();
    expect(updates).toBe(0);
    expect(store.getDay(KOCHI, "2025-06-15").state).toBe("ready"); // data arrived, screen untouched
    store.hold(false);
    await Promise.resolve();
    expect(updates).toBe(1);
  });

  it("asks for the direction of travel first", async () => {
    const back = makeStore(await openStorage());
    back.store.setView(KOCHI, ["2025-06-15"], -1);
    await back.store.idle();
    expect(back.api.calls.slice(0, 2)).toEqual([
      `/api/daily?station=${KOCHI}&month=2025-06`,
      `/api/daily?station=${KOCHI}&month=2025-05`,
    ]);

    globalThis.indexedDB = new IDBFactory();
    const forward = makeStore(await openStorage());
    forward.store.setView(KOCHI, ["2025-06-28"], 1);
    await forward.store.idle();
    expect(forward.api.calls.slice(0, 2)).toEqual([
      `/api/daily?station=${KOCHI}&month=2025-06`,
      `/api/daily?station=${KOCHI}&month=2025-07`,
    ]);
  });

  it("keeps at most two JMA requests in flight", async () => {
    const { store, api } = makeStore(memoryStorage());
    store.setView(KOCHI, ["2025-06-15", "2024-06-15"], -1);
    store.prefetch(KOCHI, daysBetween("2023-06-01", "2023-06-30"));
    await store.idle();
    expect(api.calls.length).toBeGreaterThan(4);
    expect(api.maxInFlight).toBeLessThanOrEqual(3); // 2 JMA + 1 forecast at most
  });

  it("does not save a failed month, shows the error, and retries with backoff", async () => {
    const { store, api, timers } = makeStore(await openStorage());
    api.failing.add("month=2025-06");
    store.setView(KOCHI, ["2025-06-15"]);
    await store.idle();
    expect(store.getDay(KOCHI, "2025-06-15")).toMatchObject({ state: "error", row: null });
    expect(timers.map((t) => t.ms)).toContain(5_000);

    api.failing.clear();
    store.retryDay(KOCHI, "2025-06-15");
    await store.idle();
    expect(store.getDay(KOCHI, "2025-06-15").state).toBe("ready");
  });

  it("does not write or redraw when a refresh returns the same values", async () => {
    const { store } = makeStore(await openStorage());
    store.setView(KOCHI, [TODAY]);
    await store.idle();
    let updates = 0;
    store.subscribe(() => updates++);
    store.refresh();
    await store.idle();
    await Promise.resolve();
    expect(updates).toBe(0);
  });

  it("fills the two latest days from AMeDAS when the JMA table has not published them", async () => {
    const { store, api } = makeStore(await openStorage());
    store.setView(KOCHI, [TODAY]);
    await store.idle();
    expect(api.calls).toContain(`/api/recent?station=${KOCHI}&date=2026-11-09`);
    const y = store.getDay(KOCHI, "2026-11-09");
    expect(y.kind).toBe("variable");
    expect(y.row?.raw.sun).toBe("5.0");
  });
});

describe("hourly data", () => {
  it("fetches past days in runs of at most 14 days and keeps fixed days", async () => {
    const { store, api } = makeStore(await openStorage());
    store.wantHours(KOCHI, daysBetween("2025-06-01", "2025-06-20"));
    await store.idle();
    expect(api.calls.filter((c) => c.startsWith("/api/hourly"))).toEqual([
      `/api/hourly?station=${KOCHI}&from=2025-06-01&to=2025-06-14`,
      `/api/hourly?station=${KOCHI}&from=2025-06-15&to=2025-06-20`,
    ]);
    expect(store.getHours(KOCHI, "2025-06-10")).toMatchObject({ state: "ready", kind: "fixed" });

    api.calls.length = 0;
    store.wantHours(KOCHI, daysBetween("2025-06-01", "2025-06-20"));
    await store.idle();
    expect(api.calls).toEqual([]);
  });

  it("combines today's observed hours with forecast hours", async () => {
    const { store } = makeStore(await openStorage());
    store.wantHours(KOCHI, [TODAY]);
    await store.idle();
    const today = store.getHours(KOCHI, TODAY);
    expect(today.rows).toHaveLength(24);
    expect(today.rows.slice(0, 3).every((r) => r.type === "actual")).toBe(true);
    expect(today.rows[10].type).toBe("forecast");
  });
});

describe("requests are declared, not accumulated", () => {
  it("stops asking for hours once the hourly view closes", async () => {
    const { store, api } = makeStore(memoryStorage());
    store.setView(KOCHI, ["2025-06-15"]);
    store.wantHours(KOCHI, daysBetween("2025-06-10", "2025-06-12"));
    store.wantHours(KOCHI, []); // view closed before anything loaded
    await store.idle();
    expect(api.calls.some((c) => c.startsWith("/api/hourly"))).toBe(false);
  });

  it("replaces the previous prefetch instead of adding to it", async () => {
    const { store, api } = makeStore(memoryStorage());
    store.prefetch(KOCHI, daysBetween("2020-01-01", "2020-01-31"));
    store.prefetch(KOCHI, daysBetween("2021-01-01", "2021-01-31"));
    await store.idle();
    expect(api.calls.some((c) => c.includes("month=2020-01"))).toBe(false);
    expect(api.calls.some((c) => c.includes("month=2021-01"))).toBe(true);
  });

  it("keeps the table's and the sheet's hourly requests apart, and fetches them after the visible days", async () => {
    const { store, api } = makeStore(memoryStorage());
    store.setView(KOCHI, ["2025-06-15"]);
    store.wantHours(KOCHI, daysBetween("2025-06-12", "2025-06-18"), 2, "table");
    store.wantHours(KOCHI, [], 0, "sheet"); // closing the sheet must not cancel the table's request
    await store.idle();
    const hourly = api.calls.findIndex((c) => c.startsWith("/api/hourly"));
    expect(hourly).toBeGreaterThan(api.calls.indexOf(`/api/daily?station=${KOCHI}&month=2025-06`));
    expect(store.getHours(KOCHI, "2025-06-15").state).toBe("ready");
  });

  it("forgets hourly requests when the station changes", async () => {
    const { store, api } = makeStore(memoryStorage());
    store.setView(KOCHI, ["2025-06-15"]);
    store.wantHours(KOCHI, ["2025-06-15"]);
    store.setView("47401", ["2025-06-15"]);
    await store.idle();
    expect(api.calls.some((c) => c.startsWith(`/api/hourly?station=${KOCHI}`))).toBe(false);
  });
});

describe("days that can never load", () => {
  it("reports days beyond the forecast or before 1977 as outside, not as loading", async () => {
    const { store } = makeStore(memoryStorage());
    // The forecast reaches today + FORECAST_DAYS (15): that day loads, the next one is outside.
    store.setView(KOCHI, [addDays(TODAY, FORECAST_DAYS)]);
    await store.idle();
    expect(store.getDay(KOCHI, addDays(TODAY, FORECAST_DAYS)).state).toBe("ready");
    expect(store.getDay(KOCHI, addDays(TODAY, FORECAST_DAYS + 1)).state).toBe("outside");
    expect(store.getDay(KOCHI, "1976-12-31").state).toBe("outside");
    expect(store.getHours(KOCHI, addDays(TODAY, FORECAST_DAYS + 2)).state).toBe("outside");
  });
});

describe("storage", () => {
  it("removes forecasts for days that are over", async () => {
    let now = NOW;
    const storage = await openStorage();
    const { store } = makeStore(storage, fakeApi(), () => now);
    store.setView(KOCHI, [TODAY]);
    await store.idle();
    expect((await storage.getDays([`${KOCHI}/${TODAY}`]))[0].source).toBe("forecast");

    now += 86_400_000;
    const next = makeStore(storage, fakeApi(addDays(TODAY, 1)), () => now);
    await next.store.start();
    expect(await storage.getDays([`${KOCHI}/${TODAY}`])).toEqual([]);
  });

  it("reports when saved data disappeared since the last session", async () => {
    const storage = await openStorage();
    const { store, local } = makeStore(storage);
    local.set(`weather-note:last-count:v${DATA_VERSION}`, "120");
    await store.start();
    expect((await store.report()).lostSince).toBe(120);
  });

  it("does not call a data-version change a loss", async () => {
    const storage = await openStorage();
    const { store, local } = makeStore(storage);
    local.set("weather-note:last-count", "120");
    await store.start();
    expect((await store.report()).lostSince).toBeNull();
  });

  it("clears everything and fetches again", async () => {
    const storage = await openStorage();
    const { store, api } = makeStore(storage);
    store.setView(KOCHI, ["2025-06-15"]);
    await store.idle();
    api.calls.length = 0;
    await store.clear();
    await store.idle();
    expect(api.calls.length).toBeGreaterThan(0);
    expect(store.getDay(KOCHI, "2025-06-15").state).toBe("ready");
  });
});

describe("today's hours", () => {
  it("keep the forecast's radiation for observed hours, which have none", async () => {
    const { mergeHours } = await import("../../src/data/store");
    const forecast = [{ date: TODAY, n: 10, type: "forecast", provider: "Open-Meteo", solar: 420, raw: {}, quality: {} }];
    const observed = [{ date: TODAY, n: 10, type: "actual", provider: "JMA-amedas", temp: 18, raw: {}, quality: {} }];
    const [merged] = mergeHours(forecast as never, observed as never);
    expect(merged).toMatchObject({ type: "actual", temp: 18, solar: 420, origin: { solar: "forecast" } });
  });
});

describe("正本管理 in the store", () => {
  it("drops answers to requests made before 保存データを消去", async () => {
    const api = fakeApi();
    const held: (() => void)[] = [];
    const slow: typeof api.fetchJson = async (path) => {
      await new Promise<void>((r) => held.push(r));
      return api.fetchJson(path);
    };
    const { store } = makeStore(await openStorage(), { ...api, fetchJson: slow });
    store.setView(KOCHI, ["2025-06-15"]);
    while (!held.length) await new Promise((r) => setTimeout(r, 1)); // a request is in flight
    store.setView(KOCHI, []); // nothing new is wanted
    await store.clear();
    held.forEach((r) => r()); // the old answers arrive after the clear
    await store.idle();
    expect(store.getDay(KOCHI, "2025-06-15").state).toBe("empty");
  });

  it("fetches a fixed day again when the corrections ledger lists it, and only that period", async () => {
    const storage = await openStorage();
    const first = makeStore(storage);
    first.store.setView(KOCHI, ["2025-06-15"]);
    await first.store.idle();
    expect(first.store.getDay(KOCHI, "2025-06-15").kind).toBe("fixed");

    const api = fakeApi();
    const store = new WeatherStore({
      storage,
      fetchJson: api.fetchJson,
      now: () => NOW,
      corrections: [{ id: 1, from: "2025-06-10", to: "2025-06-12", note: "test" }],
    });
    store.setView(KOCHI, ["2025-06-15"]);
    await store.idle();
    expect(api.calls).toContain(`/api/daily?station=${KOCHI}&month=2025-06`);
    expect(api.calls.some((c) => c.includes("month=2025-05"))).toBe(false); // outside the listed period
    expect(store.getDay(KOCHI, "2025-06-11").row).not.toBeNull();
  });
});

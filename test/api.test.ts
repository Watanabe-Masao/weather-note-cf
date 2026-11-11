import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_CACHE, NO_CACHE } from "../worker/src/cache";
import worker from "../worker/src/index";
import { fixture } from "./fixture";

const calls: string[] = [];
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

// Stand-ins for JMA and Open-Meteo, answering from the fixture files.
function fakeUpstream(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  calls.push(url);
  if (url.includes("/etrn/view/daily_s1.php")) return Promise.resolve(new Response(fixture("daily.html")));
  if (url.includes("/etrn/view/hourly_s1.php")) {
    if (url.includes("day=13&")) return Promise.resolve(new Response("busy", { status: 503 }));
    return Promise.resolve(new Response(fixture("hourly.html")));
  }
  if (url.includes("api.open-meteo.com/v1/forecast")) return Promise.resolve(new Response(fixture("forecast.json")));
  return Promise.resolve(new Response("not stubbed", { status: 500 }));
}

const get = async (path: string) => {
  const res = await worker.fetch(new Request("https://example.test" + path), {}, ctx);
  return { res, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T03:00:00Z")); // 12:00 in Japan
  vi.stubGlobal("fetch", vi.fn(fakeUpstream));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("/api/daily", () => {
  it("returns a fixed past month with a one-year cache", async () => {
    const { res, body } = await get("/api/daily?station=47893&month=2025-11");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(FIXED_CACHE);
    expect(body.fixed).toBe(true);
    expect((body.rows as unknown[]).length).toBe(30);
    expect(calls[0]).toContain("prec_no=74&block_no=47893&year=2025&month=11");
  });

  it("never caches a month that can still change", async () => {
    // The fixture stands in for this month too; today and later days are dropped.
    const { res, body } = await get("/api/daily?station=47893&month=2026-11");
    expect(res.headers.get("cache-control")).toBe(NO_CACHE);
    expect(body.fixed).toBe(false);
    expect((body.rows as { date: string }[]).every((r) => r.date < "2026-11-10")).toBe(true);
  });

  it("rejects bad input", async () => {
    expect((await get("/api/daily?station=00000&month=2025-11")).res.status).toBe(400);
    expect((await get("/api/daily?station=47893&month=2027-01")).res.status).toBe(400);
    expect((await get("/api/daily?station=47893&month=1976-12")).res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("/api/hourly", () => {
  it("fetches several days at once and reports a failed day without failing the rest", async () => {
    const { res, body } = await get("/api/hourly?station=47893&from=2025-11-11&to=2025-11-14");
    expect(res.status).toBe(200);
    const days = body.days as { date: string; rows: unknown[]; fixed: boolean; error?: string }[];
    expect(days.map((d) => d.date)).toEqual(["2025-11-11", "2025-11-12", "2025-11-13", "2025-11-14"]);
    expect(days[2].error).toBeTruthy();
    expect(days[2].fixed).toBe(false);
    expect(days.filter((d) => !d.error).every((d) => d.rows.length === 24 && d.fixed)).toBe(true);
  });

  it("limits the span and excludes today", async () => {
    expect((await get("/api/hourly?station=47893&from=2025-11-01&to=2025-11-15")).res.status).toBe(400);
    expect((await get("/api/hourly?station=47893&from=2026-11-10&to=2026-11-10")).res.status).toBe(400);
  });
});

describe("/api/forecast", () => {
  it("returns eight days and is never cached", async () => {
    const { res, body } = await get("/api/forecast?station=47893");
    expect(res.headers.get("cache-control")).toBe(NO_CACHE);
    expect((body.rows as unknown[]).length).toBe(8);
  });

  it("shares one upstream fetch per station for 30 minutes at the edge", async () => {
    const store = new Map<string, Response>();
    const fake = {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void store.set(r.url, res),
    };
    vi.stubGlobal("caches", { default: fake });
    const pending: Promise<unknown>[] = [];
    const ctx2 = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
    const hit = () => worker.fetch(new Request("https://example.test/api/forecast?station=47893"), {}, ctx2);
    await hit();
    await Promise.all(pending);
    const upstream = calls.length;
    const again = await hit();
    expect(calls.length).toBe(upstream); // served from the edge
    expect(again.headers.get("cache-control")).toBe(NO_CACHE); // the browser still never keeps it
    vi.setSystemTime(new Date("2026-11-10T03:31:00Z")); // next 30-minute slot
    await hit();
    expect(calls.length).toBeGreaterThan(upstream);
  });
});

describe("errors and the re-check period", () => {
  it("answers our own messages as they are and hides anything else", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("internal: socket 10.0.0.1 reset"))));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, body } = await get("/api/forecast?station=47893");
    expect(res.status).toBe(502);
    expect(body.error).toBe("取得に失敗しました。時間をおいて再試行してください。");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("keeps a fixed month at the edge for a day while it is being re-checked, a year after", async () => {
    vi.setSystemTime(new Date("2025-12-05T03:00:00Z")); // November 2025 ended 4 days before
    const recent = await get("/api/daily?station=47893&month=2025-11");
    expect(recent.body.fixed).toBe(true);
    expect(recent.res.headers.get("cache-control")).toBe("public, max-age=86400");
    vi.setSystemTime(new Date("2026-11-10T03:00:00Z"));
    const old = await get("/api/daily?station=47893&month=2025-11");
    expect(old.body.fixed).toBe(true);
    expect(old.res.headers.get("cache-control")).toBe(FIXED_CACHE);
  });
});

describe("/api/sun", () => {
  it("reaches as far as the forecast (today + 15) and no further", async () => {
    expect((await get("/api/sun?station=47893&date=2026-11-25")).res.status).toBe(200);
    expect((await get("/api/sun?station=47893&date=2026-11-26")).res.status).toBe(400);
  });
});

describe("routing", () => {
  it("answers unknown paths and methods with JSON errors", async () => {
    expect((await get("/api/nope")).res.status).toBe(404);
    const post = await worker.fetch(new Request("https://example.test/api/stations", { method: "POST" }), {}, ctx);
    expect(post.status).toBe(405);
  });

  it("lists stations", async () => {
    const { body } = await get("/api/stations");
    expect(Array.isArray(body)).toBe(true);
  });
});

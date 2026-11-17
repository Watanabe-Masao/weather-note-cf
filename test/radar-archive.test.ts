// 雨雲レーダーの保存 (worker/src/radarArchive.ts, shared/radar.ts) on a D1 stand-in and a Map for the bucket:
// the 30-minute 実況 of JMA's list, the 3×3 tiles around Kochi at zoom 8, saved once each, newest first,
// a backlog over later runs, and a failure logged (and told by the hourly look when it lasts).

import { describe, expect, it } from "vitest";
import { judgeHealth } from "../shared/healthJudge";
import { isKeptRadarTime, jstOfRadarTime, radarTiles, tileOf } from "../shared/radar";
import { radarKey, saveRadar } from "../worker/src/radarArchive";
import { d1 } from "./d1";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(80).fill(1)]);

function bucket() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(key: string, value: ArrayBuffer | Uint8Array) {
      files.set(key, new Uint8Array(value as ArrayBuffer));
    },
    async get(key: string) {
      const v = files.get(key);
      return v ? { arrayBuffer: async () => v.buffer as ArrayBuffer } : null;
    },
  };
}

/** JMA's list: 実況 every 5 minutes from `from` (UTC yyyyMMddHHmm) for `n` steps, plus a 予測 that is not kept. */
function list(times: string[]) {
  return JSON.stringify([
    ...times.map((t) => ({ basetime: t, validtime: t, elements: ["hrpns", "hrpns_nd"] })),
    { basetime: times[0], validtime: "20991231235500", elements: ["hrpns"] },
  ]);
}

function fetcher(listBody: string, fail = new Set<string>()) {
  const seen: string[] = [];
  const get = async (url: string) => {
    seen.push(url);
    if (url.endsWith("targetTimes_N1.json")) return { ok: true, status: 200, text: async () => listBody, arrayBuffer: async () => new ArrayBuffer(0) };
    if ([...fail].some((f) => url.includes(f))) return { ok: false, status: 503, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, text: async () => "", arrayBuffer: async () => PNG.buffer.slice(0) as ArrayBuffer };
  };
  return { get, seen };
}

describe("雨雲レーダー：場所と時刻", () => {
  it("finds Kochi's tile at zoom 8 and the 3×3 around it (RD-02)", () => {
    expect(tileOf(33.56, 133.53, 8)).toEqual({ x: 222, y: 102 });
    expect(tileOf(33.56, 133.53, 10)).toEqual({ x: 891, y: 410 });
    expect(radarTiles().map((t) => `${t.x},${t.y}`)).toEqual(["221,101", "222,101", "223,101", "221,102", "222,102", "223,102", "221,103", "222,103", "223,103"]);
  });
  it("keeps the hour and the half hour only, and writes JMA's UTC name in JST", () => {
    expect(isKeptRadarTime("20261117133000")).toBe(true);
    expect(isKeptRadarTime("20261117130000")).toBe(true);
    expect(isKeptRadarTime("20261117132500")).toBe(false);
    expect(jstOfRadarTime("20261117153000")).toBe("2026-11-18T00:30:00+09:00");
    expect(radarKey("20261117153000", 8, 222, 102)).toBe("radar/hrpns/2026-11/20261117153000/8/222/102.png");
  });
});

describe("雨雲レーダー：保存", () => {
  const times = ["20261117131000", "20261117130500", "20261117130000", "20261117125500", "20261117123000"];
  it("saves the newest kept time's 9 tiles first, once, and the earlier one on the next run", async () => {
    const db = d1();
    const b = bucket();
    const f = fetcher(list(times));
    const now = Date.parse("2026-11-17T13:12:00Z");
    expect(await saveRadar(db, b, now, f.get)).toEqual({ saved: 9, waiting: 9, ok: true });
    expect([...b.files.keys()].every((k) => k.startsWith("radar/hrpns/2026-11/20261117130000/8/"))).toBe(true);
    // 予測（basetime ≠ validtime）や 0・30分でない時刻は読まない。
    expect(f.seen.filter((u) => u.endsWith(".png")).every((u) => u.includes("/20261117130000/none/20261117130000/surf/hrpns/8/"))).toBe(true);
    expect(await saveRadar(db, b, now + 300_000, f.get)).toEqual({ saved: 9, waiting: 0, ok: true });
    expect(await saveRadar(db, b, now + 600_000, f.get)).toEqual({ saved: 0, waiting: 0, ok: true });
    expect(b.files.size).toBe(18);
    expect(db.raw.prepare("SELECT DISTINCT valid_at FROM radar_saved ORDER BY valid_at").all()).toEqual([
      { valid_at: "2026-11-17T21:30:00+09:00" },
      { valid_at: "2026-11-17T22:00:00+09:00" },
    ]);
    expect(db.raw.prepare("SELECT ok, saved, waiting FROM radar_fetch_log ORDER BY at").all()).toEqual([
      { ok: 1, saved: 9, waiting: 9 },
      { ok: 1, saved: 9, waiting: 0 },
      { ok: 1, saved: 0, waiting: 0 },
    ]);
  });
  it("logs a failed tile and takes it on a later run", async () => {
    const db = d1();
    const b = bucket();
    const now = Date.parse("2026-11-17T13:12:00Z");
    await saveRadar(db, b, now, fetcher(list(times.slice(0, 3)), new Set(["/8/222/102.png"])).get);
    expect(b.files.size).toBe(8);
    expect(db.raw.prepare("SELECT ok, saved, waiting, error FROM radar_fetch_log").get()).toEqual({ ok: 0, saved: 8, waiting: 1, error: "20261117130000/8/222/102: HTTP 503" });
    expect(await saveRadar(db, b, now + 300_000, fetcher(list(times.slice(0, 3))).get)).toEqual({ saved: 1, waiting: 0, ok: true });
  });
  it("logs a list that cannot be read, and saves nothing", async () => {
    const db = d1();
    const b = bucket();
    const get = async () => ({ ok: false, status: 500, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) });
    expect(await saveRadar(db, b, Date.parse("2026-11-17T13:12:00Z"), get)).toEqual({ saved: 0, waiting: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, error FROM radar_fetch_log").get()).toEqual({ ok: 0, error: "nowc list 500" });
  });
});

describe("雨雲レーダー：毎時の見張り", () => {
  const base = {
    state: { forecastLastOk: null as string | null, typhoonLastOk: null as string | null, openAlerts: [], accountErrorsLastDay: [] },
    room: { d1Size: null, d1WritesMonth: { percent: 1 }, r2: { percentOfFree: 1 }, cron: { runsLastDay: 288, stages: [] } },
    waste: { unparsed: 0, parseFailed: 0, fetchFailuresLastDay: 0 },
  };
  const now = Date.parse("2026-11-17T13:00:00Z");
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const keys = (radarLastOk: string | null) => {
    const j = judgeHealth({ ...base, state: { ...base.state, forecastLastOk: at(0), typhoonLastOk: at(0), radarLastOk } }, now);
    return { problems: j.problems.map((p) => p.key), notes: j.notes.map((n) => n.key) };
  };
  it("notes a stop of an hour, and tells a stop of two (JMA lists about 3 hours)", () => {
    expect(keys(at(0.2))).toEqual({ problems: [], notes: [] });
    expect(keys(at(1.5)).notes).toContain("radarStale");
    expect(keys(at(2.5)).problems).toContain("radarStale");
  });
});

describe("地点の表（shared/stationPlaces.ts）", () => {
  it("is the one table the forecast history and the radar both read (要件 R4「場所」)", async () => {
    const { STATION_PLACES } = await import("../shared/stationPlaces");
    const { HISTORY_PLACES } = await import("../shared/forecastHistory");
    const { RADAR_PLACE } = await import("../shared/radar");
    expect(HISTORY_PLACES["47893"]).toBe(STATION_PLACES["47893"].forecast);
    expect(RADAR_PLACE).toBe(STATION_PLACES["47893"].radar);
    expect(Object.keys(HISTORY_PLACES)).toEqual(Object.keys(STATION_PLACES));
  });
});

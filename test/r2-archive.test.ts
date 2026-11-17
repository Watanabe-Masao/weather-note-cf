// R2 (worker/src/r2Archive.ts) on a D1 stand-in and a Map for the bucket: the telegrams copied as gzip
// and counted only when read back to the same hash, and the day's weather charts saved once each, a
// chart not out yet waiting for a later run.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { type Bucket, copyTelegrams, dueQuickCharts, gunzip, r2Summary, saveCharts, telegramKey } from "../worker/src/r2Archive";
import { ensureTyphoonSchema } from "../worker/src/typhoonArchive";
import { d1 } from "./d1";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function bucket(corrupt = false) {
  const files = new Map<string, Uint8Array>();
  const b: Bucket = {
    async put(key, value) {
      files.set(key, new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)));
    },
    async get(key) {
      const f = files.get(key);
      if (!f) return null;
      const out = corrupt ? new Uint8Array([...f.slice(0, -4), 0, 0, 0, 0]) : f;
      return { arrayBuffer: async () => out.slice().buffer };
    },
  };
  return { b, files };
}

async function setup() {
  const db = d1();
  await ensureForecastSchema(db);
  await ensureTyphoonSchema(db);
  const forecast = (id: string, issued: string, xml: string, hash = sha(xml)) =>
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, 'VPFD51', '390000', 'u', ?, 'f', ?, ?)")
      .run(id, issued, hash, xml);
  const typhoon = (id: string, issued: string, xml: string) =>
    db.raw
      .prepare("INSERT INTO typhoon_telegrams (id, kind, url, number, issued_at, target_at, fetched_at, hash, xml, parsed, parser) VALUES (?, 'VPTW60', 'u', '2632', ?, ?, 'f', ?, ?, NULL, 1)")
      .run(id, issued, issued, sha(xml), xml);
  return { db, forecast, typhoon };
}

describe("R2：電文の写し", () => {
  it("copies each telegram gzipped, counts it only when read back to its own hash, and once", async () => {
    const { db, forecast, typhoon } = await setup();
    forecast("f1", "2026-11-17T11:00:00+09:00", "<Report>高知 11時</Report>");
    forecast("f2", "2026-11-16T17:00:00+09:00", "<Report>高知 17時</Report>");
    typhoon("t1", "2026-11-16T09:45:00+09:00", "<Report>台風32号</Report>");
    const { b, files } = bucket();
    expect(await copyTelegrams(db, b, Date.parse("2026-11-17T12:00:00+09:00"))).toEqual({ copied: 3, failed: 0 });
    const key = telegramKey("forecast", "f1", "2026-11-17T11:00:00+09:00");
    expect(key).toBe("telegrams/forecast/2026-11/f1.xml.gz");
    expect(new TextDecoder().decode(await gunzip(new Uint8Array(files.get(key)!)))).toBe("<Report>高知 11時</Report>");
    expect(db.raw.prepare("SELECT source, id, sha256 FROM archive_copies ORDER BY source, id").all()).toEqual([
      { source: "forecast", id: "f1", sha256: sha("<Report>高知 11時</Report>") },
      { source: "forecast", id: "f2", sha256: sha("<Report>高知 17時</Report>") },
      { source: "typhoon", id: "t1", sha256: sha("<Report>台風32号</Report>") },
    ]);
    expect(await copyTelegrams(db, b)).toEqual({ copied: 0, failed: 0 });
    expect(await r2Summary(db)).toMatchObject({ telegrams: { forecast: { telegrams: 2, copied: 2 }, typhoon: { telegrams: 1, copied: 1 } } });
  });

  it("does not count a copy that reads back otherwise, nor a telegram whose XML does not give its hash", async () => {
    const { db, forecast } = await setup();
    forecast("f1", "2026-11-17T11:00:00+09:00", "<Report>a</Report>");
    forecast("bad", "2026-11-17T05:00:00+09:00", "<Report>b</Report>", "0".repeat(64));
    expect(await copyTelegrams(db, bucket(true).b)).toEqual({ copied: 0, failed: 2 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM archive_copies").get()).toEqual({ n: 0 });
    expect(await copyTelegrams(db, bucket().b)).toEqual({ copied: 1, failed: 1 }); // tried again next run
  });

  it("copies a few a run, newest first", async () => {
    const { db, forecast } = await setup();
    for (let i = 0; i < 5; i++) forecast(`f${i}`, `2026-11-1${i}T11:00:00+09:00`, `<Report>${i}</Report>`);
    expect(await copyTelegrams(db, bucket().b, Date.now(), 2)).toEqual({ copied: 2, failed: 0 });
    expect(db.raw.prepare("SELECT id FROM archive_copies ORDER BY id").all()).toEqual([{ id: "f3" }, { id: "f4" }]);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(200).fill(1)]);
const FT24 = "20261116185331_0_Z__C_010000_20261116120000_MET_CHT_JCIfsas24_Rjp_JCP600x581_JRcolor_Tjmahp_image.png";
const FT48 = "20261116185331_0_Z__C_010000_20261116120000_MET_CHT_JCIfsas48_Rjp_JCP600x581_JRcolor_Tjmahp_image.png";

function jma(missing: string[] = []) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    const body = url.endsWith("list.json") ? new TextEncoder().encode(JSON.stringify({ near: { ft24: [FT24], ft48: [FT48] } })) : PNG;
    const gone = missing.some((m) => url.includes(m));
    return { ok: !gone, status: gone ? 404 : 200, arrayBuffer: async () => body.slice().buffer, text: async () => new TextDecoder().decode(body) };
  };
  return { get, asked };
}

describe("R2：天気図の毎日保存", () => {
  it("knows which 実況 charts should be out: two hours after their time, back two days", () => {
    const due = dueQuickCharts(Date.parse("2026-11-17T12:30:00+09:00"));
    expect(due.slice(0, 3).map((d) => d.valid)).toEqual(["2026-11-17T09:00:00+09:00", "2026-11-17T06:00:00+09:00", "2026-11-17T03:00:00+09:00"]);
    expect(due[0]).toEqual({
      valid: "2026-11-17T09:00:00+09:00",
      url: "https://www.data.jma.go.jp/yoho/data/wxchart/quick/202611/SPAS_COLOR_202611170000.png",
      key: "wxchart/quick/2026-11/SPAS_COLOR_202611170000.png",
    });
    expect(due).toHaveLength(3 + 7 + 7);
  });

  it("saves the 予想天気図 listed and the 実況 due, once each; one not out yet waits", async () => {
    const { db } = await setup();
    const { b, files } = bucket();
    const j = jma(["SPAS_COLOR_202611162100"]); // 11/17 6時 not out yet
    const now = Date.parse("2026-11-17T12:30:00+09:00");
    const r = await saveCharts(db, b, now, j.get, 100);
    expect(r).toEqual({ saved: 2 + 16, waiting: 1, ok: true });
    expect(files.has(`wxchart/forecast/2026-11/${FT24}`)).toBe(true);
    expect(db.raw.prepare("SELECT kind, valid_at, base_at FROM wxchart_saved WHERE kind = 'forecast' ORDER BY valid_at").all()).toEqual([
      { kind: "forecast", valid_at: "2026-11-17T21:00+09:00", base_at: "2026-11-16T21:00+09:00" },
      { kind: "forecast", valid_at: "2026-11-18T21:00+09:00", base_at: "2026-11-16T21:00+09:00" },
    ]);
    // The next run asks only for what is missing.
    const k = jma();
    const r2 = await saveCharts(db, b, now + 5 * 60_000, k.get, 100);
    expect(r2).toEqual({ saved: 1, waiting: 0, ok: true });
    expect(k.asked.filter((u) => !u.endsWith("list.json"))).toEqual(["https://www.data.jma.go.jp/yoho/data/wxchart/quick/202611/SPAS_COLOR_202611162100.png"]);
    expect(db.raw.prepare("SELECT ok, saved, waiting FROM wxchart_fetch_log ORDER BY at").all()).toEqual([
      { ok: 1, saved: 18, waiting: 1 },
      { ok: 1, saved: 1, waiting: 0 },
    ]);
  });

  it("logs a failed list as a failure, and still saves the 実況", async () => {
    const { db } = await setup();
    const r = await saveCharts(db, bucket().b, Date.parse("2026-11-17T12:30:00+09:00"), jma(["list.json"]).get, 3);
    expect(r).toMatchObject({ saved: 3, ok: false });
    expect(r.waiting).toBe(14);
  });
});

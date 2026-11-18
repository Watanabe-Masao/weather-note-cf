// 天気図を予報の移り変わりと連動させる (wxchartSaved.ts)：その発表の時点で出ていた予想天気図と、保存した絵の中継。
import { describe, expect, it } from "vitest";
import { ensureR2Schema } from "../worker/src/r2Archive";
import { forecastChartsAt, wxchartFile } from "../worker/src/wxchartSaved";
import { d1 } from "./d1";

async function setup() {
  const db = d1();
  await ensureR2Schema(db);
  const add = (base: string, hours: number) => {
    const valid = new Date(Date.parse(base) + hours * 3_600_000 + 9 * 3_600_000).toISOString().slice(0, 16) + "+09:00";
    db.raw
      .prepare("INSERT INTO wxchart_saved (key, kind, valid_at, base_at, url, bytes, sha256, fetched_at) VALUES (?, 'forecast', ?, ?, ?, 1, 'x', 'z')")
      .run(`wxchart/forecast/${base.slice(0, 7)}/fsas${hours}_${base.slice(0, 13).replace(/\D/g, "")}.png`, valid, base, "https://example.invalid/x.png");
  };
  for (const base of ["2026-11-16T09:00+09:00", "2026-11-16T21:00+09:00", "2026-11-17T09:00+09:00"]) for (const h of [24, 48]) add(base, h);
  return db;
}

describe("その発表の時点の予想天気図", () => {
  it("takes the latest issue drawn at or before the moment, both 24 and 48 hours", async () => {
    const db = await setup();
    const r = await forecastChartsAt(db, "2026-11-17T05:00:00+09:00");
    expect(r.charts.map((c) => [c.hours, c.base, c.valid])).toEqual([
      [24, "2026-11-16T21:00+09:00", "2026-11-17T21:00+09:00"],
      [48, "2026-11-16T21:00+09:00", "2026-11-18T21:00+09:00"],
    ]);
    expect(r.charts[0].src).toBe("/api/wxchart-file/wxchart/forecast/2026-11/fsas24_2026111621.png");
  });
  it("counts an issue drawn at the very minute (the seconds of the moment do not matter)", async () => {
    const r = await forecastChartsAt(await setup(), "2026-11-17T09:00:00+09:00");
    expect(r.charts[0].base).toBe("2026-11-17T09:00+09:00");
  });
  it("has none before the first one kept, and none without the table", async () => {
    expect((await forecastChartsAt(await setup(), "2026-11-15T17:00:00+09:00")).charts).toEqual([]);
    expect((await forecastChartsAt(d1(), "2026-11-17T05:00:00+09:00")).charts).toEqual([]);
  });
});

describe("保存した天気図の絵", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const bucket = { put: async () => undefined, get: async (k: string) => (k === "wxchart/forecast/2026-11/a.png" ? { arrayBuffer: async () => png.slice().buffer } : null) };
  it("serves a kept picture for a long time", async () => {
    const r = await wxchartFile("/api/wxchart-file/wxchart/forecast/2026-11/a.png", bucket);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toContain("immutable");
  });
  it("serves only wxchart pictures by their kept names", async () => {
    for (const p of ["/api/wxchart-file/telegrams/x.xml.gz", "/api/wxchart-file/wxchart/forecast/../x.png", "/api/wxchart-file/wxchart/forecast/2026-11/a.json"])
      expect((await wxchartFile(p, bucket)).status).toBe(400);
    expect((await wxchartFile("/api/wxchart-file/wxchart/forecast/2026-11/b.png", bucket)).status).toBe(404);
    expect((await wxchartFile("/api/wxchart-file/wxchart/forecast/2026-11/a.png", undefined)).status).toBe(503);
  });
});

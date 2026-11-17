// 予報の履歴 (#250, R2): a month of the record taken by worker/src/forecastImport.ts on a D1 stand-in,
// with a made-up GitHub (the commit, and the month's zip): only the offices in use are read, the
// month is kept with its commit, hash and empty days, taking it again changes nothing, and where our
// own telegram has the issue the record's copy is kept beside it, not preferred, and compared.

import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { importShiromatzMonth, importSummary, unzip } from "../worker/src/forecastImport";
import { parseForecasts } from "../worker/src/forecastParse";
import { d1 } from "./d1";
import { flatten } from "./forecastFlatten";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");

/** A zip of the given files, each deflated (or stored), as the record's are. */
function zip(files: Record<string, string>, store = false): ArrayBuffer {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name);
    const raw = enc.encode(text);
    const data = store ? raw : new Uint8Array(deflateRawSync(raw));
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(8, store ? 0 : 8, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, raw.length, true);
    l.setUint16(26, n.length, true);
    locals.push(new Uint8Array(l.buffer), n, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, store ? 0 : 8, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, Object.keys(files).length, true);
  e.setUint16(10, Object.keys(files).length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...locals, ...central, new Uint8Array(e.buffer)] as BlobPart[]).arrayBuffer() as unknown as ArrayBuffer;
}

function github(months: Record<string, Record<string, string>>) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    const m = /forecast_(\d{6})\.zip/.exec(url)?.[1] ?? "";
    if (url.startsWith("https://api.github.com/")) {
      const body = months[m] ? [{ sha: `sha${m}` }] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const files = months[m];
    if (!files || !url.includes(`/sha${m}/`)) return { ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    const buf = await zip(files);
    return { ok: true, status: 200, text: async () => "", arrayBuffer: async () => buf };
  };
  return { get, asked };
}

async function setup() {
  const db = d1();
  await ensureForecastSchema(db);
  return db;
}

describe("予報の履歴：記録を取り込む", () => {
  it("reads a zip's named files, deflated or stored", async () => {
    const files = { "forecast_202501_390000.csv": "a,b\n1,2\n", "forecast_202501_130000.csv": "x" };
    for (const store of [false, true]) {
      const got = await unzip(await zip(files, store), (n) => n.endsWith("390000.csv"));
      expect([...got]).toEqual([["forecast_202501_390000.csv", "a,b\n1,2\n"]]);
    }
  });

  it("takes a month at its commit, for the offices in use only, and keeps what it took", async () => {
    const db = await setup();
    const csv = fixture("shiromatz-202501-390000.csv");
    const g = github({ "202501": { "forecast_202501_390000.csv": csv, "forecast_202501_130000.csv": fixture("shiromatz-202610-390000.csv") } });
    const r = await importShiromatzMonth(db, "2025-01", Date.parse("2026-11-17T12:00:00+09:00"), g.get);
    expect(r.commit).toBe("sha202501");
    expect(r.offices).toEqual([{ office: "390000", issues: 11, emptyDays: expect.any(Array), overlaps: 0, differ: 0 }]);
    expect(r.offices[0].emptyDays).toHaveLength(29); // the trimmed file has 1/1 and 1/2 only
    expect(g.asked[1]).toBe("https://raw.githubusercontent.com/shiromatz/Japan-Meteorological-Agency-Weather-Forecast/sha202501/forecast/forecast_202501.zip");
    expect(db.raw.prepare("SELECT office, month, commit_sha, rows, issues, overlaps, differ, license FROM forecast_imports").all()).toEqual([
      { office: "390000", month: "2025-01", commit_sha: "sha202501", rows: csv.trim().split("\n").length - 1, issues: 11, overlaps: 0, differ: 0, license: "CC BY-SA 4.0" },
    ]);
    expect(db.raw.prepare("SELECT DISTINCT office, source, preferred FROM forecast_issues").all()).toEqual([{ office: "390000", source: "shiromatz", preferred: 1 }]);
    const values = db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_entries").get();
    expect(values).toEqual({ n: 35 + 45 + 48 + 35 + 39 + 35 + 45 + 48 + 35 + 39 + 35 });
    // Taking it again changes nothing.
    await importShiromatzMonth(db, "2025-01", Date.parse("2026-11-17T13:00:00+09:00"), g.get);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_entries").get()).toEqual(values);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_issues").get()).toEqual({ n: 11 });
    expect((await importSummary(db)).months.map((m) => [m.month, m.issues, m.empty_days.length])).toEqual([["2025-01", 11, 29]]);
  });

  it("keeps the record's copy of an issue our telegram has beside ours, not preferred, and compares the two", async () => {
    const db = await setup();
    const keep = (id: string, kind: string, xml: string) =>
      db.raw
        .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, '390000', 'u', '2026-11-17T11:00:00+09:00', 'f', 'h', ?)")
        .run(id, kind, xml);
    keep("d", "VPFD51", fixture("vpfd51-390000-1100.xml"));
    keep("w", "VPFW50", fixture("vpfw50-390000-1100.xml"));
    await parseForecasts(db);
    const json = JSON.parse(fixture("bosai-390000-1100.json"));
    const g = github({ "202611": { "forecast_202611_390000.csv": flatten(json) } });
    const r = await importShiromatzMonth(db, "2026-11", Date.parse("2026-12-03T12:00:00+09:00"), g.get);
    expect(r.offices[0]).toMatchObject({ issues: 2, overlaps: 2, differ: 0 });
    expect(db.raw.prepare("SELECT source, kind, preferred FROM forecast_issues ORDER BY source, kind").all()).toEqual([
      { source: "jma-xml", kind: "VPFD51", preferred: 1 },
      { source: "jma-xml", kind: "VPFW50", preferred: 1 },
      { source: "shiromatz", kind: "VPFD51", preferred: 0 },
      { source: "shiromatz", kind: "VPFW50", preferred: 0 },
    ]);
    // A record that says otherwise: the difference is kept, nothing is deleted.
    json[1].timeSeries[0].areas[0].reliabilities[6] = "B";
    const g2 = github({ "202611": { "forecast_202611_390000.csv": flatten(json) } });
    const r2 = await importShiromatzMonth(db, "2026-11", Date.parse("2026-12-03T13:00:00+09:00"), g2.get);
    expect(r2.offices[0].differ).toBe(1);
    const detail = JSON.parse((db.raw.prepare("SELECT detail FROM forecast_imports").get() as { detail: string }).detail);
    expect(detail.differences).toEqual([expect.stringMatching(/^VPFW50 2026-11-17T11:00:00\+09:00 390000\|reliability\|.*"C".*→.*"B"/)]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_issues").get()).toEqual({ n: 4 });
  });

  it("marks the record's copy not preferred when our telegram of the issue is read after it", async () => {
    const db = await setup();
    const g = github({ "202611": { "forecast_202611_390000.csv": flatten(JSON.parse(fixture("bosai-390000-1100.json"))) } });
    await importShiromatzMonth(db, "2026-11", Date.parse("2026-12-03T12:00:00+09:00"), g.get);
    expect(db.raw.prepare("SELECT DISTINCT preferred FROM forecast_issues").all()).toEqual([{ preferred: 1 }]);
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES ('w', 'VPFW50', '390000', 'u', '2026-11-17T11:00:00+09:00', 'f', 'h', ?)")
      .run(fixture("vpfw50-390000-1100.xml"));
    await parseForecasts(db);
    expect(db.raw.prepare("SELECT source, kind, preferred FROM forecast_issues ORDER BY source, kind").all()).toEqual([
      { source: "jma-xml", kind: "VPFW50", preferred: 1 },
      { source: "shiromatz", kind: "VPFD51", preferred: 1 },
      { source: "shiromatz", kind: "VPFW50", preferred: 0 },
    ]);
  });

  it("counts as 未取得 only the past days neither the record nor our telegrams have", async () => {
    const db = await setup();
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES ('d', 'VPFD51', '390000', 'u', '2026-11-17T11:00:00+09:00', 'f', 'h', ?)")
      .run(fixture("vpfd51-390000-1100.xml").replace(/2026-11-17T11:00:00\+09:00<\/ReportDateTime>/, "2026-11-18T11:00:00+09:00</ReportDateTime>"));
    await parseForecasts(db);
    const g = github({ "202611": { "forecast_202611_390000.csv": flatten(JSON.parse(fixture("bosai-390000-1100.json"))) } });
    const r = await importShiromatzMonth(db, "2026-11", Date.parse("2026-11-20T12:00:00+09:00"), g.get);
    // 1–19 past; the record has the 17th, our telegram the 18th; the 20th onwards are still to come.
    expect(r.offices[0].emptyDays).toEqual(Array.from({ length: 19 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => d !== "2026-11-17" && d !== "2026-11-18"));
  });

  it("says it when the month's zip has no CSV of the offices in use, instead of taking nothing quietly", async () => {
    const db = await setup();
    const g = github({ "202501": { "forecast_202501_130000.csv": "x" } });
    await expect(importShiromatzMonth(db, "2025-01", Date.now(), g.get)).rejects.toThrow(/CSV が見つかりません（中のファイル 1個、例：forecast_202501_130000.csv）/);
  });

  it("refuses a month outside 2025-01 … 2026-11, and says when the record has no such month yet", async () => {
    const db = await setup();
    const g = github({});
    await expect(importShiromatzMonth(db, "2024-12", Date.now(), g.get)).rejects.toThrow(/2025-01 から 2026-11/);
    await expect(importShiromatzMonth(db, "2026-11", Date.now(), g.get)).rejects.toThrow(/2026-11 の記録はまだありません/);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_imports").get()).toEqual({ n: 0 });
  });
});

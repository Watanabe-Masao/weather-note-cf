// 監視と管理 (worker/src/health.ts) on a D1 stand-in: each scheduled stage's time is kept, account
// failures are counted, and the health read says the room left and what is kept for nothing.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ensureSchema } from "../worker/src/accounts";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { ensureForecastImportSchema } from "../worker/src/forecastImport";
import { health, keepError, timed } from "../worker/src/health";
import { copyTelegrams, ensureR2Schema } from "../worker/src/r2Archive";
import { ensureTyphoonSchema } from "../worker/src/typhoonArchive";
import { d1 } from "./d1";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NOW = Date.parse("2026-11-17T13:00:00+09:00");

async function setup() {
  const db = d1();
  await ensureSchema(db);
  await ensureForecastSchema(db);
  await ensureTyphoonSchema(db);
  await ensureR2Schema(db);
  return db;
}

describe("監視と管理", () => {
  it("keeps each stage's time and outcome, and a stage's failure does not stop the next", async () => {
    const db = await setup();
    const at = new Date(NOW).toISOString();
    await timed(db, at, "a", async () => {});
    await timed(db, at, "b", async () => {
      throw new Error("x");
    });
    expect(db.raw.prepare("SELECT stage, ok FROM cron_runs ORDER BY stage").all()).toEqual([
      { stage: "a", ok: 1 },
      { stage: "b", ok: 0 },
    ]);
    const h = await health(db, NOW + 60_000);
    expect(h.room.cron.runsLastDay).toBe(1);
    expect(h.room.cron.stages.map((s) => [s.stage, s.runs, s.failed])).toEqual([
      ["a", 1, 0],
      ["b", 1, 1],
    ]);
  });

  it("counts account failures by place for a day, and keeps them 30 days", async () => {
    const db = await setup();
    await keepError(db, "/api/admin/users", "Error: D1_ERROR", NOW - 40 * 86_400_000);
    await keepError(db, "/api/admin/users", "Error: D1_ERROR", NOW - 60_000);
    await keepError(db, "/api/reports/sync", "Error: D1_ERROR", NOW - 30_000);
    await keepError(db, "/api/admin/users", "Error: D1_ERROR", NOW);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM app_errors").get()).toEqual({ n: 3 }); // the 40-day-old one is gone
    const h = await health(db, NOW);
    expect(h.state.accountErrorsLastDay.map((e) => [e.place, e.n])).toEqual([
      ["/api/admin/users", 2],
      ["/api/reports/sync", 1],
    ]);
  });

  it("says the room left and what is kept twice: the XML in the database that R2 already has", async () => {
    const db = await setup();
    const xml = "<Report>" + "x".repeat(1000) + "</Report>";
    for (const id of ["a", "b"])
      db.raw
        .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml, parser) VALUES (?, 'VPFD51', '390000', 'u', '2026-11-17T11:00:00+09:00', ?, ?, ?, 0)")
        .run(id, new Date(NOW - 3_600_000).toISOString(), sha(xml), xml);
    const files = new Map<string, Uint8Array>();
    await copyTelegrams(
      db,
      {
        put: async (k, v) => void files.set(k, new Uint8Array(v as Uint8Array)),
        get: async (k) => (files.has(k) ? { arrayBuffer: async () => files.get(k)!.slice().buffer } : null),
      },
      NOW,
      1,
    );
    const h = await health(db, NOW);
    expect(h.waste.xmlInDatabase).toEqual({ bytes: 2 * xml.length, alsoInR2: xml.length });
    expect(h.waste.notCopiedToR2).toBe(1);
    expect(h.waste.unparsed).toBe(2);
    expect(h.state.kochiLatest).toEqual({ VPFD51: "2026-11-17T11:00:00+09:00" });
    expect(h.tables.forecast_telegrams).toEqual({ rows: 2, lastDay: 2 });
    expect(h.room.d1WritesMonth.rowsLastDay).toBeGreaterThanOrEqual(3); // 2 telegrams + 1 copy (+ the logs)
    expect(h.room.r2.bytes).toBeGreaterThan(0);
    expect(h.room.d1Size).toBeNull(); // D1 says its size; the stand-in does not
    expect(h.plan.name).toBe("Workers Paid");
  });

  it("answers on a new database, with nothing in it", async () => {
    const h = await health(d1(), NOW);
    expect(h.waste.notCopiedToR2).toBe(0);
    expect(h.state.openAlerts).toEqual([]);
  });

  it("says the months of the record's import — the last taken and the next — and nothing else of them", async () => {
    const db = await setup();
    expect((await health(db, NOW)).state.forecastImport).toEqual({ lastTaken: null, next: "2025-01" });
    await ensureForecastImportSchema(db);
    for (const [office, month] of [
      ["390000", "2025-01"],
      ["390000", "2025-02"],
      ["130000", "2025-02"],
    ])
      db.raw
        .prepare("INSERT INTO forecast_imports VALUES ('shiromatz', ?, ?, 'c', 'u', 'h', 'f', 1, 1, '[]', 0, 0, '{}', 'CC BY-SA 4.0', 1)")
        .run(office, month);
    const h = await health(db, NOW);
    expect(h.state.forecastImport).toEqual({ lastTaken: "2025-02", next: "2025-03" });
  });
});


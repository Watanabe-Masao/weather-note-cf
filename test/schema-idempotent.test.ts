// 表の作成は何度流しても同じ（独立レビュー 2026-11-19「途中で失敗して最初からやり直しても安全か」）：
// - worker/src の *_SCHEMA の文は、どれも CREATE … IF NOT EXISTS だけ（データを書く文・消す文を混ぜない）
// - ensure*Schema を2回（重ねて・続けて）流しても失敗せず、データの行は増えない（schema_version の1行と版の記録だけ）
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { d1 } from "./d1";

const files = readdirSync("worker/src").filter((f) => f.endsWith(".ts"));
const mods = await Promise.all(files.map(async (f) => [f, (await import(`../worker/src/${f}`)) as Record<string, unknown>] as const));

describe("表の作成は何度流しても同じ", () => {
  it("*_SCHEMA の文はすべて CREATE … IF NOT EXISTS", () => {
    const bad: string[] = [];
    for (const [f, m] of mods)
      for (const [k, v] of Object.entries(m))
        if (/SCHEMA$/.test(k) && Array.isArray(v))
          for (const q of v) if (typeof q === "string" && !/^\s*CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/i.test(q)) bad.push(`${f} ${k}: ${q.slice(0, 60)}`);
    expect(bad).toEqual([]);
  });
  it("ensure*Schema を重ねて・続けて流しても失敗せず、データの行が増えない", async () => {
    const db = d1();
    const ensures = mods.flatMap(([, m]) => Object.entries(m).filter(([k, v]) => /^ensure\w*Schema$/.test(k) && typeof v === "function").map(([, v]) => v as (d: unknown) => Promise<void>));
    expect(ensures.length).toBeGreaterThan(10);
    await Promise.all(ensures.map((f) => f(db)));
    for (const f of ensures) await f(db);
    const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    const rows = Object.fromEntries(tables.map((t) => [t, (db.raw.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n]).filter(([, n]) => n));
    expect(Object.keys(rows).sort()).toEqual(["schema_migrations", "schema_version"]);
    expect(rows.schema_version).toBe(1);
  });
});

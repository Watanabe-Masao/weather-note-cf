// 表の作りの変更に版を付ける（worker/src/migrate.ts）：まだの版だけを順に1回、記録を残す。前から当たっていた変更は当たり済み。
import { describe, expect, it } from "vitest";
import { migrate } from "../worker/src/migrate";
import { ensureHealthSchema } from "../worker/src/health";
import { d1 } from "./d1";

describe("migrate", () => {
  it("まだの版だけを順に当て、2回目は何もしない。版を足すとその版だけ当たる", async () => {
    const db = d1();
    db.raw.exec("CREATE TABLE t (a INTEGER)");
    expect(await migrate(db, "m", [["ALTER TABLE t ADD COLUMN b TEXT"]])).toEqual([1]);
    expect(await migrate(db, "m", [["ALTER TABLE t ADD COLUMN b TEXT"]])).toEqual([]);
    expect(await migrate(db, "m", [["ALTER TABLE t ADD COLUMN b TEXT"], ["ALTER TABLE t ADD COLUMN c TEXT"]])).toEqual([2]);
    expect(db.raw.prepare("SELECT module, version FROM schema_migrations ORDER BY version").all()).toEqual([
      { module: "m", version: 1 },
      { module: "m", version: 2 },
    ]);
  });
  it("版の記録の前に当たっていた変更（列がもうある）は当たり済みとして記録する", async () => {
    const db = d1();
    db.raw.exec("CREATE TABLE t (a INTEGER, b TEXT)");
    expect(await migrate(db, "m", [["ALTER TABLE t ADD COLUMN b TEXT"]])).toEqual([1]);
  });
  it("失敗した版は記録せず、止める（次の要求でやり直す）", async () => {
    const db = d1();
    await expect(migrate(db, "m", [["ALTER TABLE nope ADD COLUMN b TEXT"]])).rejects.toThrow("migrate m v1");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 0 });
  });
  it("health の表は版 1・2 まで当たる（d1_ms・error）", async () => {
    const db = d1();
    await ensureHealthSchema(db);
    expect(db.raw.prepare("SELECT version FROM schema_migrations WHERE module = 'health' ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }]);
  });
});

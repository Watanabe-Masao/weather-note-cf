// 表の作成を1回だけ（#292、2026-11-19）：作成中の promise を要求の間で共有しない。
import { describe, expect, it } from "vitest";
import { doneOnce } from "../worker/src/once";
import { ensureSchema } from "../worker/src/accounts";
import { d1 } from "./d1";

describe("doneOnce", () => {
  it("重なった最初の呼び出しは、それぞれ自分で作る（同じ promise を渡さない）", async () => {
    const done = new WeakSet<object>();
    const key = {};
    let runs = 0;
    const make = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 5));
    };
    const a = doneOnce(done, key, make);
    const b = doneOnce(done, key, make);
    expect(a).not.toBe(b);
    await Promise.all([a, b]);
    expect(runs).toBe(2);
    await doneOnce(done, key, make);
    expect(runs).toBe(2); // 済んだあとは作らない
  });
  it("失敗したら印は付かず、次でやり直す", async () => {
    const done = new WeakSet<object>();
    const key = {};
    let runs = 0;
    await expect(
      doneOnce(done, key, async () => {
        runs++;
        throw new Error("D1 busy");
      }),
    ).rejects.toThrow("D1 busy");
    await doneOnce(done, key, async () => {
      runs++;
    });
    expect(runs).toBe(2);
  });
});

describe("ensureSchema（アカウント）", () => {
  it("重なって作っても schema_version は1行", async () => {
    const db = d1();
    await Promise.all([ensureSchema(db), ensureSchema(db), ensureSchema(db)]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({ n: 1 });
  });
});

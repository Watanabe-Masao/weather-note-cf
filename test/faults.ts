// 障害テストの道具（#299 P0）：D1 の代わり（test/d1.ts）に、書き込みの失敗と、途中で切れる実行を足す。
//   failWrites：条件に合う書き込みを、最初の `times` 回だけ失敗させる（D1 が混んでいる・一時的に止まっている）。
//   cutAfterWrites：書き込みが `n` 回うまくいった後は、読み書きのすべてを失敗させる（実行が途中で切られた）。
// 読み込みは失敗させない（cutAfterWrites のあとを除く）。

import type { Db, Stmt } from "../worker/src/accounts";

const isWrite = (q: string) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(q);

export function faulty<T extends Db>(db: T, opts: { failWrites?: (q: string) => boolean; times?: number; cutAfterWrites?: number } = {}) {
  let failsLeft = opts.times ?? Infinity;
  let writes = 0;
  const failed: string[] = [];
  const cut = () => opts.cutAfterWrites != null && writes >= opts.cutAfterWrites;
  const guard = (q: string, write: boolean) => {
    if (cut()) {
      failed.push(q);
      throw new Error("D1_ERROR: the run was cut short (test)");
    }
    if (write && opts.failWrites?.(q) && failsLeft > 0) {
      failsLeft--;
      failed.push(q);
      throw new Error("D1_ERROR: overloaded (test)");
    }
  };
  const wrap = (q: string, s: Stmt): Stmt & { inner: Stmt } => ({
    inner: s,
    bind: (...v: unknown[]) => wrap(q, s.bind(...v)),
    first: (async () => (guard(q, false), s.first())) as Stmt["first"],
    all: (async () => (guard(q, false), s.all())) as Stmt["all"],
    run: async () => {
      guard(q, isWrite(q));
      const r = await s.run();
      if (isWrite(q)) writes++;
      return r;
    },
  });
  const f: Db = {
    prepare: (q: string) => wrap(q, db.prepare(q)),
    batch: async (list: Stmt[]) => {
      if (cut()) throw new Error("D1_ERROR: the run was cut short (test)");
      const r = await db.batch(list.map((x) => (x as Partial<ReturnType<typeof wrap>>).inner ?? x));
      writes += list.length;
      return r;
    },
  };
  return { db: f, failed, writes: () => writes };
}

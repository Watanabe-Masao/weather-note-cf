// D1, played by Node's SQLite, for tests: prepare / bind / first / all / run, and batch as one
// transaction (as D1 does).
import { DatabaseSync } from "node:sqlite";
import type { Db, Stmt } from "../worker/src/accounts";

export function d1(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  const stmt = (q: string, values: unknown[] = []): Stmt & { exec(): { results: Record<string, unknown>[]; changes: number } } => ({
    bind: (...v: unknown[]) => stmt(q, v),
    exec() {
      const s = raw.prepare(q);
      const args = values as (string | number | null)[];
      if (/^\s*(SELECT|WITH)/i.test(q)) return { results: s.all(...args) as Record<string, unknown>[], changes: 0 };
      const r = s.run(...args);
      return { results: [], changes: Number(r.changes) };
    },
    async first<T>() {
      return ((this.exec().results[0] as T) ?? null) as T | null;
    },
    async all<T>() {
      return { results: this.exec().results as T[] };
    },
    async run() {
      return { meta: { changes: this.exec().changes } };
    },
  });
  return {
    raw,
    prepare: (q) => stmt(q),
    async batch(list) {
      raw.exec("BEGIN");
      try {
        const out = list.map((s) => (s as ReturnType<typeof stmt>).exec());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// 表の作りの変更に版を付ける（2026-11-19、DB 設計の提案への回答③）。
//
// 表そのものは、各ファイルの CREATE TABLE IF NOT EXISTS（何度流しても同じ）で作る。作ったあとの変更（列を足すなど）は、
// ここの migrate で「部分（module）ごとの版」として1回ずつ当て、当てた版を schema_migrations に残す。
// 決まり：版は足すだけ。当て終わった版の中身は書き換えない（直すときは次の版を足す）。消す・作り直す変更は、元に戻せない
// ので個別に確かめてから。
// 版の記録を始める前に当たっていた変更（列がもうある）は、「duplicate column」「already exists」を当たり済みとみなす。
// 重なった要求がそれぞれ当てても同じになる（once.ts と同じ考え方。記録は INSERT OR IGNORE）。

import type { Db } from "./accounts";

export const MIGRATIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS schema_migrations (
  module TEXT NOT NULL,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (module, version)
)`;

const ALREADY = /duplicate column|already exists/i;

/** module の版 1, 2, … を、まだ当てていないものだけ順に当てる。steps[i] が版 i+1 の文。 */
export async function migrate(db: Db, module: string, steps: string[][], now = Date.now()): Promise<number[]> {
  await db.prepare(MIGRATIONS_SCHEMA).run();
  const done = new Set((await db.prepare("SELECT version FROM schema_migrations WHERE module = ?").bind(module).all<{ version: number }>()).results.map((r) => r.version));
  const applied: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    const version = i + 1;
    if (done.has(version)) continue;
    for (const q of steps[i])
      try {
        await db.prepare(q).run();
      } catch (e) {
        if (!ALREADY.test(String(e))) throw new Error(`migrate ${module} v${version}: ${String(e).slice(0, 200)}`, { cause: e });
      }
    await db.prepare("INSERT OR IGNORE INTO schema_migrations (module, version, applied_at) VALUES (?, ?, ?)").bind(module, version, new Date(now).toISOString()).run();
    applied.push(version);
  }
  return applied;
}

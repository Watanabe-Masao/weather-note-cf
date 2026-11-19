// 提供元の一覧に載っていた印（#299 P1「取得の状態の管理」、2026-11-19）。
//
// 欠けた回を「取れなかった」と「提供元が出していない」に分けるための証拠：一覧を読めた回に、どの時刻が載っていたか。
// 雨雲レーダー・解析雨量は一覧の時刻（30分ごと）、予報の電文は見張る予報区の定時の発表の時刻（一覧の updated）。
// 判断は completeness.ts（載っていた → 取れなかった、読めた回に載っていなかった → 出ていない）。30日で消す。

import type { Db } from "./accounts";
import { doneOnce } from "./once";

export const LISTED_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS source_listed (
    source TEXT NOT NULL,
    item TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (source, item)
  )`,
];
const KEEP_DAYS = 30;

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureListedSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    for (const q of LISTED_SCHEMA) await db.prepare(q).run();
  });
}

/** 一覧に載っていた時刻（item は日本時間の ISO）を1度だけ残す。失敗しても保存の段は止めない。 */
export async function noteListed(db: Db, source: string, items: string[], now: number): Promise<void> {
  if (!items.length) return;
  try {
    await ensureListedSchema(db);
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO source_listed (source, item, seen_at) SELECT ?, value, ? FROM json_each(?)").bind(source, new Date(now).toISOString(), JSON.stringify([...new Set(items)])),
      db.prepare("DELETE FROM source_listed WHERE seen_at < ?").bind(new Date(now - KEEP_DAYS * 86_400_000).toISOString()),
    ]);
  } catch (e) {
    console.error("weather-note: note listed", source, e);
  }
}

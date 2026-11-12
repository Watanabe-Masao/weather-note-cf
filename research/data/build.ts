// #45 step 2: the exports kept in raw/ → the DuckDB file (weather-note.duckdb) and Parquet
// (parquet/<dataset>/<table>.parquet). Rebuilt from scratch every time, so a purge in raw/ always
// reaches the analysis tables.

import { mkdirSync, rmSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_FILE, PARQUET, readExports, sha256 } from "./common";
import { TABLES, tablesOf } from "./transform";

rmSync(DB_FILE, { force: true });
rmSync(PARQUET, { recursive: true, force: true });
const db = await DuckDBInstance.create(DB_FILE);
const c = await db.connect();
for (const sql of Object.values(TABLES)) await c.run(sql);

const exports = readExports();
if (!exports.length) console.log("raw/ に取り出したデータがありません（npm run export）。表だけ作りました。");
for (const { ex, text } of exports) {
  const rows = tablesOf(ex, sha256(text));
  for (const [table, list] of Object.entries(rows)) {
    if (!list.length) continue;
    const ph = list[0].map((_, i) => `$${i + 1}`).join(", ");
    const stmt = await c.prepare(`INSERT INTO ${table} VALUES (${ph})`);
    for (const row of list) {
      stmt.clearBindings();
      row.forEach((v, i) => (v == null ? stmt.bindNull(i + 1) : typeof v === "boolean" ? stmt.bindBoolean(i + 1, v) : typeof v === "number" ? stmt.bindDouble(i + 1, v) : stmt.bindVarchar(i + 1, v)));
      await stmt.run();
    }
  }
  const dir = new URL(`${ex.datasetId}/`, PARQUET).pathname;
  mkdirSync(dir, { recursive: true });
  for (const table of ["sensation_reports", "weather_snapshots", "prediction_snapshots"])
    await c.run(`COPY (SELECT * FROM ${table} WHERE dataset_id = '${ex.datasetId}') TO '${dir}${table}.parquet' (FORMAT parquet)`);
  console.log(`${ex.datasetId}：${rows.sensation_reports.length}件、予測 ${rows.prediction_snapshots.length}件`);
}
console.log(`DuckDB：${DB_FILE}`);

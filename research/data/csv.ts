// npm run csv: one dataset (the newest, or WN_DATASET) as a CSV to look at in Excel — answer,
// weather and the prediction made before the answer, one row per report (#55: in place of the
// admin screen's download, so the copy is built from raw/ and a withdrawal reaches it on the next
// build). The file stays on this computer, like everything else here: only aggregates of 5 or
// more people leave it.
import { mkdirSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_FILE } from "./common";

const c = await (await DuckDBInstance.create(DB_FILE)).connect();
const pick = process.env.WN_DATASET;
const latest = (await c.runAndReadAll("SELECT dataset_id FROM datasets ORDER BY exported_at DESC LIMIT 1")).getRows()[0]?.[0] as string | undefined;
const dataset = pick ?? latest;
if (!dataset || !/^[\w-]+$/.test(dataset)) {
  console.error("データセットがありません（npm run export → npm run build）。");
  process.exit(1);
}
// Words people sent can start like a formula (= + - @): Excel would run it. Such a value gets a ' first.
await c.run("CREATE OR REPLACE MACRO safe(v) AS CASE WHEN regexp_matches(v, '^[=+\\-@\\t\\r]') THEN '''' || v ELSE v END");
const dir = new URL("./csv/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const file = `${dir}${dataset}.csv`;
await c.run(`COPY (
  SELECT r.research_id, r.report_id, r.reported_at, r.sensation, r.scale_version, safe(r.exposure) AS exposure, safe(r.wind_felt) AS wind_felt, safe(r.sky) AS sky,
    r.trainable, r.excluded_reason, w.temp, w.humidity, w.wind, w.solar, w.sun_temp, w.shade_temp, w.temp_from, w.status AS input_status,
    w.lag_min, w.baseline, p.model_version, p.learning_state, p.p0, p.p1, p.p2, p.p3, p.p4, p.p5, p.p6, p.expected, p.mu, p.h, p.z
  FROM sensation_reports r
  LEFT JOIN weather_snapshots w USING (dataset_id, report_id)
  LEFT JOIN prediction_snapshots p USING (dataset_id, report_id)
  WHERE r.dataset_id = '${dataset}' ORDER BY r.reported_at, r.research_id, r.report_id
) TO '${file}' (HEADER, DELIMITER ',')`);
console.log(`${file} に書き出しました（手元のパソコンの外に出さないでください）。`);

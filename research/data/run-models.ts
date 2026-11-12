// #45 step 3: run the comfort engine on a dataset, person by person, and keep what it says
// (model_runs, parameter_estimates, evaluation_results) next to the data it was run on.
//
//   npm run run-models [dataset-id]      (default: the newest)
//
// The run records the code commit, the model version and the settings, so its numbers can be
// made again (#47's experiment records point at runs like this one).

import { execSync } from "node:child_process";
import { DuckDBInstance } from "@duckdb/node-api";
import { ensembleFromReports, interval, MODEL_VERSION, paramNames, trackRecord } from "../../src/beta/comfort";
import type { Report } from "../../src/beta/reports";
import { DB_FILE, readExports } from "./common";

const exports = readExports();
// Default: the newest real export (by its time, never the made-up fixture).
const newest = exports.filter((e) => e.ex.datasetId !== "ds-fixture").sort((a, b) => a.ex.exportedAt - b.ex.exportedAt).at(-1) ?? exports.at(-1);
const wanted = process.argv[2] ?? newest?.ex.datasetId;
const found = exports.find((e) => e.ex.datasetId === wanted);
if (!found) {
  console.error(`データセット ${wanted ?? "（なし）"} が raw/ にありません。`);
  process.exit(1);
}
const commit = execSync("git rev-parse --short HEAD").toString().trim();
const runId = `run-${Date.now()}`;
const db = await DuckDBInstance.create(DB_FILE);
const c = await db.connect();
const insert = async (table: string, row: (string | number | null)[]) => {
  const stmt = await c.prepare(`INSERT INTO ${table} VALUES (${row.map((_, i) => `$${i + 1}`).join(", ")})`);
  row.forEach((v, i) => (v == null ? stmt.bindNull(i + 1) : typeof v === "number" ? stmt.bindDouble(i + 1, v) : stmt.bindVarchar(i + 1, v)));
  await stmt.run();
};
await insert("model_runs", [runId, wanted!, commit, MODEL_VERSION, null, new Date().toISOString(), JSON.stringify({ alpha: "chosen as in the app", draws: 200 })]);

const byPerson = new Map<string, Report[]>();
for (const { researchId, report } of found.ex.rows) byPerson.set(researchId, [...(byPerson.get(researchId) ?? []), report]);
for (const [rid, reports] of byPerson) {
  const ens = ensembleFromReports(reports);
  for (const [i, f] of ens.fits.entries()) {
    const names = paramNames(f.model);
    for (const [k, name] of names.entries()) {
      const [lo, hi] = interval(f, (t) => t[k]);
      await insert("parameter_estimates", [runId, rid, f.model.id, name, f.theta[k], lo, hi, ens.weights[i], f.n]);
    }
  }
  const rec = trackRecord(reports);
  for (const [metric, value] of Object.entries({ rps: rec.rps, ref_rps: rec.refRps, skill: rec.skill, log_loss: rec.logLoss, hit: rec.hit, bias: rec.bias, recent_bias: rec.recentBias, alpha: ens.alpha, n_fit: ens.n }))
    await insert("evaluation_results", [runId, rid, metric, value ?? null, rec.n]);
}
console.log(`${runId}：${wanted} の ${byPerson.size}人を ${MODEL_VERSION}（${commit}）で計算しました。`);

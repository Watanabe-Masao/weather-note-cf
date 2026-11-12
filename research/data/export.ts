// #45 step 1: take the research data out of the server, read-only, as the administrator.
//
//   WN_URL=https://weather-note-cf.<…>.workers.dev WN_TOKEN=<export token from the admin screen> npm run export
//
// The token is read-only and lasts 24 hours (#55). Every call is logged on the server
// (export_log). Every earlier copy kept here is then trimmed to this export: a person who took
// consent back, whose account was deleted, or a report that was deleted, leaves all the copies.

import { readExports, writeExport } from "./common";
import { anonymous, type Export, purge, trimTo } from "./transform";

const base = process.env.WN_URL;
const token = process.env.WN_TOKEN;
if (!base || !token) {
  console.error("WN_URL と WN_TOKEN（管理画面の「取り出し用のトークン」）を指定してください。");
  process.exit(1);
}

const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, "");
const datasetId = `ds-${stamp}`;

const rows: Export["rows"] = [];
let withdrawn: Export["withdrawn"] = [];
let exportedAt = Date.now();
let after: string | null = null;
let first = true;
while (first || after) {
  const res = await fetch(`${base}/api/admin/research?dataset=${datasetId}${after ? `&after=${after}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { rows: Export["rows"]; next: string | null; withdrawn?: Export["withdrawn"]; exportedAt: number; error?: string };
  if (!res.ok) {
    console.error(body.error ?? `取り出せませんでした（${res.status}）`);
    process.exit(1);
  }
  rows.push(...body.rows.map((r) => ({ ...r, report: anonymous(r.report) })));
  if (body.withdrawn) withdrawn = body.withdrawn;
  if (first) exportedAt = body.exportedAt;
  first = false;
  after = body.next;
}

const ex = purge({ datasetId, exportedAt, rows, withdrawn }, withdrawn);
// Every earlier copy is trimmed to this one: withdrawn people and deleted reports leave them all.
for (const { ex: old } of readExports()) {
  if (old.datasetId === "ds-fixture") continue;
  const trimmed = trimTo(purge(old, withdrawn), ex);
  if (trimmed !== old) {
    writeExport(trimmed);
    console.log(`${old.datasetId}：${old.rows.length - trimmed.rows.length}件を消しました（撤回・削除）`);
  }
}
writeExport(ex);
console.log(`${datasetId}：${ex.rows.length}件（${new Set(ex.rows.map((r) => r.researchId)).size}人）を raw/ に保存しました。次は npm run build`);

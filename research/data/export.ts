// #45 step 1: take the research data out of the server, read-only, as the administrator.
//
//   WN_URL=https://weather-note-cf.<…>.workers.dev WN_SESSION=<the wn_session cookie of an
//   administrator's login> npm run export
//
// Every call is logged on the server (export_log). The withdrawals that come with it are applied
// to this export and to every earlier one kept here: a person who took consent back, or whose
// account was deleted, leaves all the copies.

import { readExports, writeExport } from "./common";
import { type Export, purge } from "./transform";

const base = process.env.WN_URL;
const session = process.env.WN_SESSION;
if (!base || !session) {
  console.error("WN_URL と WN_SESSION（管理者のログインの Cookie wn_session の値）を指定してください。");
  process.exit(1);
}

const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, "");
const datasetId = `ds-${stamp}`;

const rows: Export["rows"] = [];
let withdrawn: Export["withdrawn"] = [];
let exportedAt = Date.now();
let offset: number | null = 0;
while (offset != null) {
  const res = await fetch(`${base}/api/admin/research?offset=${offset}&dataset=${datasetId}`, { headers: { Cookie: `wn_session=${session}` } });
  const body = (await res.json()) as { rows: Export["rows"]; next: number | null; withdrawn?: Export["withdrawn"]; exportedAt: number; error?: string };
  if (!res.ok) {
    console.error(body.error ?? `取り出せませんでした（${res.status}）`);
    process.exit(1);
  }
  rows.push(...body.rows);
  if (body.withdrawn) withdrawn = body.withdrawn;
  if (offset === 0) exportedAt = body.exportedAt;
  offset = body.next;
}

// Earlier copies first: drop whoever has withdrawn since.
for (const { ex } of readExports()) {
  const after = purge(ex, withdrawn);
  if (after !== ex) {
    writeExport(after);
    console.log(`${ex.datasetId}：取り下げのあった ${after.purged!.length - (ex.purged?.length ?? 0)}人分を消しました`);
  }
}
const ex = purge({ datasetId, exportedAt, rows, withdrawn }, withdrawn);
writeExport(ex);
console.log(`${datasetId}：${ex.rows.length}件（${new Set(ex.rows.map((r) => r.researchId)).size}人）を raw/ に保存しました。次は npm run build`);

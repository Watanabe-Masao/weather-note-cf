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
const earlier = readExports().filter(({ ex: old }) => old.datasetId !== "ds-fixture");

// An export far smaller than the last one (a wrong WN_URL, an empty test server…) would wipe the
// earlier copies when they are trimmed to it: stop and ask (review 2026-11-12).
const last = earlier.map((e) => e.ex).sort((a, b) => a.exportedAt - b.exportedAt).at(-1);
if (last && last.rows.length >= 10 && ex.rows.length < last.rows.length / 2 && process.env.WN_FORCE !== "1") {
  console.error(`今回は ${ex.rows.length}件で、前回（${last.datasetId}）の ${last.rows.length}件より大きく少ないため、過去の写しを削らずに止めました。取り出し先（WN_URL）を確かめてください。本当に減ったときは WN_FORCE=1 を付けて実行します。`);
  process.exit(1);
}

// The new copy first, then every earlier copy trimmed to it (withdrawn people and deleted reports
// leave them all), and made anonymous again (copies from before #55 kept the account ID).
writeExport(ex);
for (const { ex: old } of earlier) {
  const trimmed = trimTo(purge(old, withdrawn), ex);
  const clean = { ...trimmed, rows: trimmed.rows.map((r) => ({ ...r, report: anonymous(r.report) })) };
  const hadOwner = old.rows.some((r) => "owner" in r.report);
  if (trimmed !== old || hadOwner) {
    writeExport(clean);
    console.log(`${old.datasetId}：${old.rows.length - trimmed.rows.length}件を消しました（撤回・削除）${hadOwner ? "。アカウントの ID を取り除きました" : ""}`);
  }
}
console.log(`${datasetId}：${ex.rows.length}件（${new Set(ex.rows.map((r) => r.researchId)).size}人）を raw/ に保存しました。次は npm run build`);

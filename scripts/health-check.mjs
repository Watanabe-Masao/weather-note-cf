// 監視と管理 (2026-11-17): reads the app's /api/health (worker/src/health.ts) and judges it — what is
// wrong (problems: an issue is opened), what is getting near a limit or kept for nothing (notes) — and
// writes the summary for the job page. Run hourly by .github/workflows/health.yml. Node 22, no packages.
// The URL comes from the secret HEALTH_URL (the app's address is not written in the public repository).

//
// 過去の記録の取り込み (#250): /api/health says the month to take next (state.forecastImport.next); the
// record (shiromatz) is asked whether its zip is on main yet. When it is, an issue labelled
// "import-ready" says so; once the month is taken (next moves on), that issue is closed. Not a problem,
// so apart from the "health" issue; when the record cannot be asked, it is a note and no issue changes.
// The workflow runs `node scripts/health-check.mjs --import-issue '<open issues as JSON>'` for the
// actions (one a line: "open<TAB>month<TAB>title" or "close<TAB>number<TAB>comment").

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
// 監視の判断 (shared/healthJudge.ts): the same judgment as the Worker's hourly look (worker/src/healthWatch.ts),
// in one place. Node runs the .ts as it is (only types to strip).
import { checkImport as checkRecord, importTitle, judgeHealth, RECORD_REPO, recordZipUrl } from "../shared/healthJudge.ts";
import { runbookTag } from "../shared/runbook.ts";

export { importTitle, RECORD_REPO, recordZipUrl };
/** Whether the record has the month to take next (shared/healthJudge.ts), asked as GitHub Actions. */
export const checkImport = (position, get = fetch) => checkRecord(position, get, "weather-note health (GitHub Actions)");

/**
 * What to do with the "import-ready" issues: open one when the next month is in the record and none is
 * open for it; close those for a month that is no longer next (taken). Nothing when /api/health could
 * not be read or the record could not be asked (`imp` null, or `available` null with a reason).
 */
export function importIssueActions(imp, open) {
  if (!imp || (imp.next && imp.available === null)) return [];
  const actions = [];
  for (const i of open) {
    const month = /：(\d{4}-\d{2})$/.exec(i.title)?.[1];
    if (month && month !== imp.next) actions.push({ act: "close", number: i.number, comment: `${month} の取り込みが済みました（次は ${imp.next ?? "なし"}）。` });
  }
  if (imp.next && imp.available === true && !open.some((i) => i.title === importTitle(imp.next)))
    actions.push({
      act: "open",
      month: imp.next,
      title: importTitle(imp.next),
      body: [
        `外部の記録（${RECORD_REPO}）の main に、${imp.next} の予報（forecast/forecast_${imp.next.replace("-", "")}.zip）が入りました。`,
        "",
        "管理画面の「予報の履歴：過去の記録の取り込み」から取り込んでください（自動では取り込みません）。",
        `取り込みが済んで次の月に進むと、この issue は監視（health.yml）が閉じます。`,
      ].join("\n"),
    });
  return actions;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv[2] === "--import-issue") {
  const { importReady } = JSON.parse(readFileSync("health-result.json", "utf8"));
  const actions = importIssueActions(importReady, JSON.parse(process.argv[3] || "[]"));
  for (const a of actions) {
    if (a.act === "open") writeFileSync("import-ready.md", a.body + "\n");
    console.log(a.act === "open" ? ["open", a.month, a.title].join("\t") : ["close", a.number, a.comment].join("\t"));
  }
} else if (isMain) await main();

async function main() {
  const url = process.env.HEALTH_URL;
  const now = Date.now();
  const problems = [];
  const notes = [];
  let h = null;

  if (!url) problems.push("HEALTH_URL が設定されていません（リポジトリの Secrets）。");
  else {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "weather-note health (GitHub Actions)" } });
      if (!r.ok) problems.push(`アプリの /api/health が HTTP ${r.status} を返しました。`);
      else h = await r.json();
    } catch (e) {
      problems.push(`アプリに届きません（${e.message}）。`);
    }
  }

  const mb = (b) => `${(b / 1e6).toFixed(1)}MB`;

  // 過去の記録の取り込み: not a problem; a note only when the record could not be asked (judgeHealth).
  const importReady = h?.state?.forecastImport ? await checkImport(h.state.forecastImport) : null;
  const judged = judgeHealth(h, now, importReady);
  // 手引きの手順を添える（docs/runbook.md、shared/runbook.ts）
  problems.push(...judged.problems.map((f) => f.text + runbookTag(f.key)));
  notes.push(...judged.notes.map((f) => f.text + runbookTag(f.key)));

  const lines = [`# Weather Note の状態（${new Date(now).toISOString()}）`, ""];
  lines.push(problems.length ? `## 異常 ${problems.length}件` : "## 異常なし", ...problems.map((p) => `- ${p}`), "");
  if (notes.length) lines.push("## 気づいたこと", ...notes.map((p) => `- ${p}`), "");
  if (h) {
    const r = h.room, w = h.waste;
    lines.push(
      "## 実際の使用量（今月、Cloudflare の集計）",
      ...(h.usage?.error
        ? [`- 読めません：${h.usage.error}`]
        : [
            h.usage.workers?.error ? `- Workers：読めません（${h.usage.workers.error}）` : `- リクエスト ${h.usage.workers.requests.toLocaleString()}回（${h.usage.workers.requestsPercent}%／1,000万）・計算時間の目安 ${Math.round(h.usage.workers.cpuMsEstimate / 1000).toLocaleString()}秒（${h.usage.workers.cpuPercentEstimate}%／3万秒）・長い回（99%） ${Math.round(h.usage.workers.cpuP99Us / 1000)}ms（1回の上限の ${h.usage.workers.cpuP99PercentOfRun}%）・エラー ${h.usage.workers.errors}回`,
            h.usage.d1?.error ? `- D1：読めません（${h.usage.d1.error}）` : `- データベース：書き込み ${h.usage.d1.rowsWritten.toLocaleString()}行（${h.usage.d1.rowsWrittenPercent}%／5,000万）・読み取り ${h.usage.d1.rowsRead.toLocaleString()}行（${h.usage.d1.rowsReadPercent}%）・大きさ ${h.usage.d1.sizeBytes == null ? "—" : mb(h.usage.d1.sizeBytes)}`,
            h.usage.r2?.error ? `- R2：読めません（${h.usage.r2.error}）` : `- R2：保存 ${mb(h.usage.r2.bytes)}（${h.usage.r2.bytesPercentOfFree}%／10GB）・${h.usage.r2.objects}個・書き込み ${h.usage.r2.classA}回（${h.usage.r2.classAPercentOfFree}%）・読み出し ${h.usage.r2.classB}回`,
          ]),
      "",
      "## 余裕（上限に対して）",
      "| 項目 | 今 | 上限との割合 |",
      "| --- | --- | --- |",
      `| データベースの大きさ | ${r.d1Size ? mb(r.d1Size.bytes) : "—"} | ${r.d1Size ? r.d1Size.percent + "%（10GB）" : "—"} |`,
      `| 書き込み（月の見込み） | ${r.d1WritesMonth.estimate.toLocaleString()}行（1日 ${r.d1WritesMonth.rowsLastDay.toLocaleString()}行が増えた） | ${r.d1WritesMonth.percent}%（5,000万行） |`,
      `| R2 | ${mb(r.r2.bytes)}（天気図 1日 ${r.r2.chartsLastDay}枚） | ${r.r2.percentOfFree}%（無料枠10GB） |`,
      `| 定時処理 | 24時間で ${r.cron.runsLastDay}回・いちばん長い段 ${Math.round(r.cron.longestStageMs / 1000)}秒（待ち時間を含む）${r.cron.startLateMaxMs != null ? `・始まりの遅れ 最大 ${Math.round(r.cron.startLateMaxMs / 1000)}秒` : ""} | 計算時間は上の「実際の使用量」 |`,
      "",
      "## 無駄（持ちすぎ・やり残し）",
      `- データベースの電文の原文：${mb(w.xmlInDatabase.bytes)}（うち R2 にも写し済み ${mb(w.xmlInDatabase.alsoInR2)}：二重持ち）`,
      `- まだ R2 に写していない電文：${w.notCopiedToR2}通`,
      `- まだ読んでいない電文：${w.unparsed}通・読めなかった電文：${w.parseFailed}通`,
      `- 表示されない記録の写し（自前の電文と重なる分）：${w.recordCopiesNotShown.issues}発表・${w.recordCopiesNotShown.entries ?? 0}値`,
      "",
      "## 定時処理（24時間）",
      "| 段 | 回数 | 失敗 | 平均 | 最長 |",
      "| --- | --- | --- | --- | --- |",
      ...r.cron.stages.map((s) => `| ${s.stage} | ${s.runs} | ${s.failed} | ${s.avg_ms}ms | ${s.max_ms}ms |`),
      "",
      // 警報・注意報の電文 (warningArchive.ts): shown only, not judged (no problem or note is made of it yet).
      "## 警報・注意報の電文（高知県）",
      !h.state.warnings
        ? "- /api/health に警報・注意報の数がありません（アプリが古いかもしれません）。"
        : `- 保存 ${h.state.warnings.telegrams}通・最新 ${Object.entries(h.state.warnings.latest).map(([k, v]) => `${k} ${v}`).join("・") || "なし"}・R2 に写していない ${h.state.warnings.notCopiedToR2}通・最後に取れた ${h.state.warnings.lastOk ?? "記録なし"}・取得の失敗（24時間） ${h.state.warnings.fetchFailuresLastDay}回`,
      "",
      "## 過去の記録の取り込み",
      !importReady
        ? "- /api/health に取り込みの月がありません（アプリが古いかもしれません）。"
        : importReady.next
        ? `- 取り込み済みの最後の月：${importReady.lastTaken ?? "なし"}・次の月：${importReady.next}（記録に${importReady.available === true ? "あります" : importReady.available === false ? "まだありません" : "あるか確かめられませんでした"}）`
        : `- 取り込み済みの最後の月：${importReady.lastTaken ?? "なし"}・次に取り込む月はありません`,
    );
  }
  const md = lines.join("\n") + "\n";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  writeFileSync("health-report.md", md);
  writeFileSync("health-result.json", JSON.stringify({ problems, notes, importReady }, null, 1));
  console.log(md);
  // The numbers themselves, for the daily check (nothing of a person is in them).
  if (h) console.log("HEALTH_JSON " + JSON.stringify(h));
}

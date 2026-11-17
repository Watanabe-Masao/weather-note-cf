// 監視と管理 (2026-11-17): reads the app's /api/health (worker/src/health.ts) and judges it — what is
// wrong (problems: an issue is opened), what is getting near a limit or kept for nothing (notes) — and
// writes the summary for the job page. Run hourly by .github/workflows/health.yml. Node 22, no packages.
// The URL comes from the secret HEALTH_URL (the app's address is not written in the public repository).

import { appendFileSync, writeFileSync } from "node:fs";

const url = process.env.HEALTH_URL;
const now = Date.now();
const H = 3_600_000;
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

const ago = (iso) => (iso ? (now - Date.parse(iso)) / H : Infinity);
const hours = (x) => (x === Infinity ? "記録なし" : `${x.toFixed(1)}時間前`);
const mb = (b) => `${(b / 1e6).toFixed(1)}MB`;

if (h) {
  const s = h.state, room = h.room, waste = h.waste;
  // 状態
  if (ago(s.forecastLastOk) > 0.5) problems.push(`予報の電文を最後に取れたのは ${hours(ago(s.forecastLastOk))}（5分ごとのはず）。`);
  if (ago(s.typhoonLastOk) > 0.5) problems.push(`台風の電文を最後に取れたのは ${hours(ago(s.typhoonLastOk))}。`);
  if (s.chartsLastOk !== undefined && ago(s.chartsLastOk) > 1) notes.push(`天気図の保存が最後にうまくいったのは ${hours(ago(s.chartsLastOk))}。`);
  for (const a of s.openAlerts) problems.push(`アプリの警告が開いたまま：${a.key}（${a.since} から）。`);
  const errs = s.accountErrorsLastDay.reduce((n, e) => n + e.n, 0);
  if (errs >= 3) problems.push(`アカウントの処理の失敗が24時間で ${errs} 回（${s.accountErrorsLastDay.map((e) => `${e.place} ${e.n}`).join("・")}）。`);
  else if (errs) notes.push(`アカウントの処理の失敗が24時間で ${errs} 回。`);
  for (const st of room.cron.stages) if (st.failed >= 3) problems.push(`定時処理「${st.stage}」が24時間で ${st.failed} 回失敗。`);
  if (room.cron.runsLastDay < 250) notes.push(`定時処理が24時間で ${room.cron.runsLastDay} 回（288回のはず）。`);
  // 余裕
  if (room.d1Size && room.d1Size.percent >= 50) notes.push(`データベースの大きさが上限の ${room.d1Size.percent}%。`);
  if (room.d1WritesMonth.percent >= 50) notes.push(`データベースの書き込み（月の見込み）が込みの量の ${room.d1WritesMonth.percent}%。`);
  if (room.r2.percentOfFree >= 70) notes.push(`R2 が無料枠の ${room.r2.percentOfFree}%。`);
  if (room.cron.percentOfCpu >= 30) notes.push(`定時処理の最長が ${room.cron.maxMs}ms（上限30秒の ${room.cron.percentOfCpu}%）。`);
  // 無駄
  if (waste.unparsed > 50) problems.push(`読めていない電文が ${waste.unparsed} 通たまっています。`);
  if (waste.parseFailed > 0) notes.push(`読めなかった電文が ${waste.parseFailed} 通（解析器の見直しが要るかも）。`);
  if (waste.fetchFailuresLastDay > 12) notes.push(`予報の取得の失敗が24時間で ${waste.fetchFailuresLastDay} 回。`);
}

const lines = [`# Weather Note の状態（${new Date(now).toISOString()}）`, ""];
lines.push(problems.length ? `## 異常 ${problems.length}件` : "## 異常なし", ...problems.map((p) => `- ${p}`), "");
if (notes.length) lines.push("## 気づいたこと", ...notes.map((p) => `- ${p}`), "");
if (h) {
  const r = h.room, w = h.waste;
  lines.push(
    "## 余裕（上限に対して）",
    "| 項目 | 今 | 上限との割合 |",
    "| --- | --- | --- |",
    `| データベースの大きさ | ${r.d1Size ? mb(r.d1Size.bytes) : "—"} | ${r.d1Size ? r.d1Size.percent + "%（10GB）" : "—"} |`,
    `| 書き込み（月の見込み） | ${r.d1WritesMonth.estimate.toLocaleString()}行（1日 ${r.d1WritesMonth.rowsLastDay.toLocaleString()}行が増えた） | ${r.d1WritesMonth.percent}%（5,000万行） |`,
    `| R2 | ${mb(r.r2.bytes)}（天気図 1日 ${r.r2.chartsLastDay}枚） | ${r.r2.percentOfFree}%（無料枠10GB） |`,
    `| 定時処理の最長 | ${r.cron.maxMs}ms（24時間で ${r.cron.runsLastDay}回） | ${r.cron.percentOfCpu}%（30秒） |`,
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
  );
}
const md = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
writeFileSync("health-report.md", md);
writeFileSync("health-result.json", JSON.stringify({ problems, notes }, null, 1));
console.log(md);
// The numbers themselves, for the daily check (nothing of a person is in them).
if (h) console.log("HEALTH_JSON " + JSON.stringify(h));

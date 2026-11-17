// WN-03（WN-01・02 の続き）:
//  1. 高知地方気象台's monthly tables (2025-01 〜): the issues counted as distinct 発表日時 (the layout since
//     2026-06 prints the time on every row), and the 高知市 column read character by character.
//  2. agora (NII): its robots.txt, the list for 高知市 (area code 3920100) and how the list pages, one
//     telegram's page (report_each), and whether a JMA telegram of 2025 is still served by JMA.
// Run by the "research-warnings" workflow; output goes to the log and the run's artifact.
//   npx --yes tsx@4.19.2 research/warnings/w03.ts --out research/warnings/out3
// 出典：気象庁（高知地方気象台「警報・注意報発表状況」、防災情報XML）、国立情報学研究所。

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? (process.argv[i + 1] ?? d) : d;
};
const out = arg("out", "research/warnings/out3");
mkdirSync(join(out, "raw"), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines: string[] = [];
const log = (...ss: string[]) => {
  for (const s of ss.length ? ss : [""]) {
    lines.push(s);
    console.log(s);
  }
};
type Got = { status: number; bytes: Buffer; text: string; type: string; error?: string };
async function get(url: string, pause = 1000): Promise<Got> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" },
      signal: AbortSignal.timeout(60_000),
    });
    const bytes = Buffer.from(await r.arrayBuffer());
    await sleep(pause);
    return { status: r.status, bytes, text: bytes.toString("utf8"), type: r.headers.get("content-type") ?? "" };
  } catch (e) {
    await sleep(pause);
    return { status: 0, bytes: Buffer.alloc(0), text: "", type: "", error: String(e) };
  }
}
const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
const linksOf = (html: string) => [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&")))];
const count = <T>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

// ---- 1. the monthly tables ----------------------------------------------------------------------
log("# WN-03（自動の記録）", "", `実行：${new Date().toISOString()}（UTC）`, "", "## 1. 月ごとの発表状況（PDF）", "");
type Ch = { x: number; y: number; w: number; c: string; page: number };
const MARK = /[●◯○◎▼▽◇■◆解浸土]/;
const months: string[] = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 9) months.push(`${y}_${String(m).padStart(2, "0")}`);
const summary: Record<string, unknown>[] = [];
log("| 月 | 発表の回数（発表日時の数） | 行 | 高知市に印のある行 | 高知市で ● の行（種類×回） | 高知市が警報以上の行 |", "|---|---|---|---|---|---|");
for (const ym of months) {
  const r = await get(`https://www.data.jma.go.jp/kochi/kochinokishou/chukeihou/${ym}.pdf`, 1200);
  if (r.status !== 200) {
    log(`| ${ym} | HTTP ${r.status} | | | | |`);
    continue;
  }
  const file = join(out, "raw", `${ym}.pdf`);
  writeFileSync(file, r.bytes);
  execFileSync("pdftotext", ["-bbox", file, `${file}.html`]);
  const html = readFileSync(`${file}.html`, "utf8");
  // Words split into characters, each at an even share of its word's width.
  const chars: Ch[] = [];
  const words: { x: number; y: number; x2: number; t: string; page: number }[] = [];
  let page = 0;
  for (const m of html.matchAll(/<page\b|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)) {
    if (m[0].startsWith("<page")) {
      page++;
      continue;
    }
    const [x, y, x2, t] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""];
    words.push({ x, y, x2, t, page });
    const cs = [...t];
    const w = (x2 - x) / Math.max(1, cs.length);
    cs.forEach((c, i) => chars.push({ x: x + w * i, y, w, c, page }));
  }
  // Issues: distinct 「M月D日 HH時MM分」 (a date word and a time word on one line).
  const issues = new Set<string>();
  for (const t of words.filter((w) => /^\d{1,2}時\d{2}分$/.test(w.t))) {
    const d = words.filter((w) => w.page === t.page && /^\d{1,2}月\d{1,2}日$/.test(w.t) && Math.abs(w.y - t.y) < 3 && w.x < t.x).sort((a, b) => b.x - a.x)[0];
    issues.add(`${d?.t ?? "?"} ${t.t}`);
  }
  let rows = 0;
  const marked: string[] = [];
  const issued: string[] = [];
  const warned: string[] = [];
  for (let p = 1; p <= page; p++) {
    const cs = chars.filter((c) => c.page === p);
    // The 高知市 column: a 高 with 知 under it and 市 under that, leftmost of such.
    const head = cs
      .filter((c) => c.c === "高")
      .filter((c) => cs.some((d) => d.c === "知" && Math.abs(d.x - c.x) < 3 && d.y > c.y && d.y - c.y < 25))
      .sort((a, b) => a.x - b.x)[0];
    const names = words
      .filter((w) => w.page === p && /(注意報|警報)$/.test(w.t))
      .sort((a, b) => a.y - b.y);
    rows += names.length;
    if (!head) continue;
    const cx = head.x + head.w / 2;
    names.forEach((n, i) => {
      const yEnd = names[i + 1]?.y ?? n.y + 40;
      // A mark in the column, on the name's line or (in the new layout) on the lines below it before the next name.
      const mark = cs.find((c) => MARK.test(c.c) && c.y > n.y - 3 && c.y < Math.max(n.y + 3, yEnd - 3) && Math.abs(c.x + c.w / 2 - cx) < 4);
      if (!mark) return;
      marked.push(`${n.t}${mark.c}`);
      if (mark.c === "●") issued.push(n.t);
      if (/警報$/.test(n.t) && !/解/.test(mark.c)) warned.push(`${n.t}${mark.c}`);
    });
  }
  const row = { month: ym, bytes: r.bytes.length, pages: page, issues: issues.size, rows, cityRows: marked.length, cityIssued: count(issued), cityWarned: count(warned) };
  summary.push(row);
  log(
    `| ${ym} | ${row.issues} | ${rows} | ${marked.length} | ${row.cityIssued.map(([k, n]) => `${k}×${n}`).join("、") || "なし"} | ${row.cityWarned.map(([k, n]) => `${k}×${n}`).join("、") || "なし"} |`,
  );
}
writeFileSync(join(out, "pdf-summary.json"), JSON.stringify(summary, null, 1));
log("");

// ---- 2. agora -----------------------------------------------------------------------------------
log("## 2. agora（国立情報学研究所）", "");
const AG = "https://agora.ex.nii.ac.jp";
const show = async (path: string, n = 40, re?: RegExp) => {
  const r = await get(AG + path, 3000);
  writeFileSync(join(out, "raw", path.replace(/[^\w.-]/g, "_").slice(0, 120)), r.bytes);
  log(`### ${path}：HTTP ${r.status}、${kb(r.bytes.length)}`, "```", ...textOf(r.text).split("\n").slice(0, n).map((l) => l.slice(0, 220)), "```");
  const ls = linksOf(r.text).filter((l) => !/twitter|creativecommons|^#|\.css$/.test(l));
  log(`- リンク（抜粋）：${(re ? ls.filter((l) => re.test(l)) : ls).slice(0, 40).join(" ")}`, "");
  return r;
};
await show("/robots.txt", 40);
const list = await show("/cgi-bin/cps/warning_list.pl?acode=3920100", 40, /warning_list|page|start|offset|report_each/);
// The list's own paging links, and the oldest entries reached by the last page link.
const pageLinks = linksOf(list.text).filter((l) => /warning_list\.pl/.test(l) && /(page|start|offset|from|p)=/.test(l));
log(`- ページのリンク：${pageLinks.slice(0, 10).join(" ")}`);
const last = pageLinks[pageLinks.length - 1];
let oldIds: string[] = [];
if (last) {
  const r = await show(last.startsWith("/") ? last : `/cgi-bin/cps/${last}`, 30, /report_each/);
  oldIds = linksOf(r.text).filter((l) => /report_each/.test(l)).map((l) => /id=([^&]+)/.exec(l)?.[1] ?? "");
}
// A 2025 entry: the 高知県 list, searched by a period if the page offers it (else the paging of the 県 list).
const ken = await show("/cgi-bin/cps/warning_list.pl?acode=390000", 5, /warning_list/);
const kenPages = linksOf(ken.text).filter((l) => /warning_list\.pl/.test(l) && /(page|start|offset|from|p)=/.test(l));
log(`- 高知県のページのリンク：${kenPages.slice(0, 12).join(" ")}`, "");
for (const l of kenPages.slice(-1)) {
  const r = await show(l.startsWith("/") ? l : `/cgi-bin/cps/${l}`, 30, /report_each/);
  oldIds.push(...linksOf(r.text).filter((x) => /report_each/.test(x)).map((x) => /id=([^&]+)/.exec(x)?.[1] ?? ""));
}
const jmaIds = [...new Set(oldIds.filter((x) => /^\d{14}_\d_V/.test(x)))].sort();
log(`- report_each の電文 ID：${jmaIds.length}件（古い順に ${jmaIds.slice(0, 3).join("、")} …）`, "");
if (jmaIds[0]) await show(`/cgi-bin/cps/report_each.pl?id=${jmaIds[0]}`, 40, /xml|download|raw/i);
await show("/cgi-bin/cps/report_each.pl?id=20261117044919_0_VPWW53_390000", 25, /xml|download|raw/i);
// Whether JMA still serves those old telegrams.
log("### 古い電文を気象庁から読めるか", "");
for (const id of [...jmaIds.slice(0, 2), ...jmaIds.slice(-1)]) {
  const r = await get(`https://www.data.jma.go.jp/developer/xml/data/${id}.xml`, 1000);
  log(`- ${id}.xml：HTTP ${r.status}、${kb(r.bytes.length)}`);
}
log("");
writeFileSync(join(out, "w03-report.md"), lines.join("\n") + "\n");

// WH-01 (#299 P0): can the warnings and typhoon telegrams kept be checked against another record of what
// was issued? Looks only (robots.txt first); sizes, times and parsed counts to the log. The PDF pages are
// read here and not kept; one page is printed as a small image (base64) only to check the reading by eye.
// Run once by a push to research/warning-typhoon-history. 出典：気象庁ホームページ（高知地方気象台を含む）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
async function req(url, method = "GET") {
  n++;
  try {
    const r = await fetch(url, { method, headers: UA, signal: AbortSignal.timeout(60000) });
    const b = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
    await sleep(1200);
    return { status: r.status, type: r.headers.get("content-type") ?? "", lm: r.headers.get("last-modified") ?? "", len: r.headers.get("content-length") ?? "", b, text: b.toString("utf8") };
  } catch (e) {
    await sleep(1200);
    return { status: 0, type: String(e), lm: "", len: "", b: Buffer.alloc(0), text: "" };
  }
}
const tmp = mkdtempSync(join(tmpdir(), "wh01-"));
console.log("# WH-01", new Date().toISOString());

// 0. robots.txt of the hosts read below (www.jma.go.jp: 404, #274)
const robots = {};
for (const h of ["www.data.jma.go.jp", "www.jma.go.jp"]) {
  const r = await req(`https://${h}/robots.txt`);
  robots[h] = r.status === 200 ? [...r.text.matchAll(/^Disallow:\s*(\S*)/gim)].map((m) => m[1]).filter(Boolean) : [];
  console.log(`robots ${h}: HTTP ${r.status} ${r.type}; Disallow: ${robots[h].join(" ") || "(none)"}`);
  if (r.status === 200) console.log(r.text.slice(0, 800));
}
const allowed = (u) => {
  const x = new URL(u);
  return !(robots[x.host] ?? []).some((d) => x.pathname.startsWith(d));
};

// 1. 高知地方気象台「警報・注意報発表状況」
const PDF = (ym) => `https://www.data.jma.go.jp/kochi/kochinokishou/chukeihou/${ym}.pdf`;
const months = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 11) months.push(`${y}_${String(m).padStart(2, "0")}`);
console.log("\n## PDF の掲載（HEAD）");
const have = [];
for (const ym of months) {
  if (!allowed(PDF(ym))) { console.log(`${ym}: robots.txt で禁止、読まない`); continue; }
  const r = await req(PDF(ym), "HEAD");
  console.log(`${ym}: HTTP ${r.status} last-modified=${r.lm} length=${r.len}`);
  if (r.status === 200) have.push(ym);
}
console.log("\n## 新しい様式（2026-06〜）の読み取り");
for (const ym of have.filter((x) => x >= "2026_05")) {
  const r = await req(PDF(ym));
  const f = join(tmp, `${ym}.pdf`);
  writeFileSync(f, r.b);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [f]).toString())?.[1] ?? 0);
  const lay = execFileSync("pdftotext", ["-layout", f, "-"]).toString();
  const lines = lay.split("\n");
  // Issues: 「M月D日 HH時MM分」 pairs on a line; rows: a 注意報/警報 name on a line.
  const issues = new Set();
  const rows = [];
  let cur = "";
  for (const l of lines) {
    const dt = /(\d{1,2}月\d{1,2}日)\s+(\d{1,2}時\d{2}分)/.exec(l);
    if (dt) cur = `${dt[1]} ${dt[2]}`;
    if (dt) issues.add(cur);
    const name = /((?:レベル\d)?[^\s●○◯◎▼▽◇◆■□解]{1,8}(?:注意報|警報))/.exec(l);
    if (name && !/：/.test(l)) rows.push({ at: cur, name: name[1], marks: l.slice(l.indexOf(name[1]) + name[1].length).replace(/\s+/g, "") });
  }
  const kinds = new Map();
  for (const x of rows) kinds.set(x.name, (kinds.get(x.name) ?? 0) + 1);
  const marks = new Map();
  for (const x of rows) for (const c of x.marks) marks.set(c, (marks.get(c) ?? 0) + 1);
  console.log(`### ${ym}: ${r.b.length} bytes, ${pages} pages, issues ${issues.size}, rows ${rows.length}`);
  console.log(`  kinds: ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}×${c}`).join("、")}`);
  console.log(`  marks: ${[...marks].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}×${c}`).join(" ")}`);
  console.log(`  legend: ${lines.filter((l) => /：/.test(l)).map((l) => l.trim().replace(/\s+/g, " ")).slice(0, 8).join(" ／ ")}`);
  if (ym === have.filter((x) => x >= "2026_06").at(-1)) {
    console.log("  -- layout の先頭 60行 --");
    for (const l of lines.filter((x) => x.trim()).slice(0, 60)) console.log(`  | ${l.replace(/\s+$/, "").slice(0, 220)}`);
    console.log("  -- 読み取った行の先頭 25 --");
    for (const x of rows.slice(0, 25)) console.log(`  ${x.at} ${x.name} [${x.marks}]`);
    execFileSync("pdftoppm", ["-f", "1", "-l", "1", "-r", "60", "-gray", "-png", f, join(tmp, "p")]);
    const png = readFileSync(join(tmp, "p-1.png"));
    console.log(`=====PAGE1-PNG ${ym} ${png.length}=====`);
    console.log(png.toString("base64"));
    console.log("=====PAGE1-END=====");
  }
}

// 2. 台風：配信一覧とは別の記録
console.log("\n## 台風");
for (const u of [
  "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json",
  "https://www.data.jma.go.jp/yoho/typhoon/position_table/index.html",
  "https://www.data.jma.go.jp/yoho/typhoon/position_table/table2026.html",
  "https://www.data.jma.go.jp/yoho/typhoon/route_map/index.html",
  "https://www.jma.go.jp/jma/jma-eng/jma-center/rsmc-hp-pub-eg/besttrack.html",
  "https://www.jma.go.jp/jma/jma-eng/jma-center/rsmc-hp-pub-eg/trackarchives.html",
]) {
  if (!allowed(u)) { console.log(`${u}: robots.txt で禁止、読まない`); continue; }
  const r = await req(u);
  const text = r.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  console.log(`### ${u}: HTTP ${r.status} ${r.type} ${r.b.length} bytes last-modified=${r.lm}`);
  console.log(`  ${text.slice(0, 900)}`);
  const links = [...new Set([...r.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((l) => /table|20(2[4-6])|bst|track|zip|txt|csv/i.test(l));
  console.log(`  links: ${links.slice(0, 30).join(" ")}`);
}
console.log(`# end (${n} requests)`);

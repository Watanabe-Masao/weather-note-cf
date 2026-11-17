// WN-02（WN-01 の続き）: what WN-01 left open.
//  1. The samples chosen in WN-01, read again and written into the log (gzip + base64), since the run's
//     artifact cannot be downloaded from where the report is written; also shows whether a telegram
//     is still served days later.
//  2. 高知地方気象台's monthly tables: the text of a few months (the old layout and the one since
//     2026-06), to read the 発表日時 and the 高知市 column correctly; how far back the tables go.
//  3. agora (NII): the warning list of 高知県, one warning's page, its XML database (/cps/jmaxml/), and
//     whether a JMA telegram it lists from long ago is still served by JMA.
// Run by the "research-warnings" workflow; output goes to the log and the run's artifact.
//   npx --yes tsx@4.19.2 research/warnings/w02.ts --out research/warnings/out2
// 出典：気象庁（防災情報XML、高知地方気象台「警報・注意報発表状況」）、国立情報学研究所。

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? (process.argv[i + 1] ?? d) : d;
};
const out = arg("out", "research/warnings/out2");
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
const linksOf = (html: string) => [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? ""))];

// ---- 1. samples ---------------------------------------------------------------------------------
const BASE = "https://www.data.jma.go.jp/developer/xml/data/";
const SAMPLES = [
  "20261117044919_0_VPWW53_390000.xml",
  "20261117044919_0_VPWW54_390000.xml",
  "20261117010549_0_VPWW53_390000.xml",
  "20261115134151_0_VPWW53_390000.xml",
  "20261116191823_0_VPWW53_390000.xml",
  "20261117010534_0_VPWW58_390000.xml",
  "20261116191810_0_VPWW58_390000.xml",
  "20261117044910_0_VPWW61_390000.xml",
  "20261110192917_0_VPWW59_390000.xml",
  "20261117013536_0_VPFD60_390000.xml",
  "20261117013536_0_VPFD61_390000.xml",
  "20261117014218_0_VPFW60_390000.xml",
  "20261117044257_0_VPHW50_390000.xml",
  "20261115042949_0_VPWW55_270000.xml",
];
log("# WN-02（自動の記録）", "", `実行：${new Date().toISOString()}（UTC）`, "", "## 1. 見本の電文（読み直し）", "");
const blobs: string[] = [];
for (const f of SAMPLES) {
  const r = await get(BASE + f, 500);
  log(`- ${f}：HTTP ${r.status}、${kb(r.bytes.length)}`);
  if (r.status === 200) blobs.push(`${f} ${gzipSync(r.bytes).toString("base64")}`);
}
log("");

// ---- 2. 高知地方気象台's monthly tables ------------------------------------------------------------
log("## 2. 月ごとの発表状況（PDF）の文字", "");
const PDF = (ym: string) => `https://www.data.jma.go.jp/kochi/kochinokishou/chukeihou/${ym}.pdf`;
for (const ym of ["2025_07", "2026_04", "2026_05", "2026_06", "2026_08"]) {
  const r = await get(PDF(ym), 1200);
  if (r.status !== 200) {
    log(`### ${ym}：HTTP ${r.status}`, "");
    continue;
  }
  const file = join(out, "raw", `${ym}.pdf`);
  writeFileSync(file, r.bytes);
  const txt = execFileSync("pdftotext", ["-layout", file, "-"]).toString("utf8");
  const rows = txt.split("\n").filter((l) => l.trim());
  log(`### ${ym}（${rows.length}行）`, "```");
  for (const l of rows.slice(0, ym === "2025_07" ? 45 : 70)) log(l.replace(/\s+$/, "").slice(0, 260));
  log("```", "");
  const raw = execFileSync("pdftotext", ["-raw", file, "-"]).toString("utf8");
  log(`- -raw の先頭：`, "```", ...raw.split("\n").filter((l) => l.trim()).slice(0, 40).map((l) => l.slice(0, 200)), "```", "");
}
log("### どこまで遡れるか（各年の1月）", "");
for (const y of [2012, 2014, 2016, 2018, 2020, 2022, 2024]) {
  const r = await get(PDF(`${y}_01`), 1200);
  log(`- ${y}_01：HTTP ${r.status}（${r.type}、${kb(r.bytes.length)}）`);
}
for (const u of ["https://www.data.jma.go.jp/kochi/kochinokishou/chukeihou/", "https://www.data.jma.go.jp/kochi/kochinokishou/chukeihou/index.html", "https://www.jma-net.go.jp/kochi/kochinokishou/chukeihou.html"]) {
  const r = await get(u, 1200);
  log(`- ${u}：HTTP ${r.status}、${kb(r.bytes.length)}`);
  if (r.status === 200) {
    const t = textOf(r.text);
    log("```", ...t.split("\n").slice(0, 40).map((l) => l.slice(0, 200)), "```");
    log(`  - リンク：${linksOf(r.text).filter((l) => /pdf|chukeihou/i.test(l)).slice(0, 30).join(" ")}`);
  }
}
log("");

// ---- 3. agora ------------------------------------------------------------------------------------
log("## 3. agora（国立情報学研究所）", "");
const AG = "https://agora.ex.nii.ac.jp";
const show = async (path: string, n = 60) => {
  const r = await get(AG + path, 2500);
  writeFileSync(join(out, "raw", path.replace(/[^\w.-]/g, "_").slice(0, 120)), r.bytes);
  log(`### ${path}：HTTP ${r.status}、${kb(r.bytes.length)}`, "```", ...textOf(r.text).split("\n").slice(0, n).map((l) => l.slice(0, 220)), "```");
  log(`- リンク（抜粋）：${linksOf(r.text).filter((l) => !/twitter|creativecommons|^#/.test(l)).slice(0, 60).join(" ")}`, "");
  return r;
};
await show("/cgi-bin/cps/warning_list.pl?acode=390000", 80);
await show("/cgi-bin/cps/warning_each.pl?id=20261117100500-14-390000", 50);
const jx = await show("/cps/jmaxml/", 60);
await show("/cps/weather/warning/area/", 30);
// A telegram the XML database lists from long ago: its own page, and whether JMA still serves the original.
const sub = linksOf(jx.text).filter((l) => /jmaxml/.test(l) && !/^https?:\/\/(?!agora)/.test(l)).slice(0, 8);
log(`- jmaxml の下のリンク：${sub.join(" ")}`, "");
const jmaLinks: string[] = [];
for (const l of sub.slice(0, 3)) {
  const path = l.startsWith("http") ? l.replace(AG, "") : l.startsWith("/") ? l : `/cps/jmaxml/${l}`;
  const r = await show(path, 30);
  jmaLinks.push(...linksOf(r.text).filter((x) => /data\.jma\.go\.jp\/.*\.xml/.test(x)));
}
log(`- 気象庁の電文へのリンク：${jmaLinks.length}件`, "");
for (const u of [...new Set(jmaLinks)].sort().slice(0, 3)) {
  const r = await get(u, 1000);
  log(`- ${u}：HTTP ${r.status}、${kb(r.bytes.length)}`);
}
log("");

writeFileSync(join(out, "w02-report.md"), lines.join("\n") + "\n");
// The samples last, between markers, so they can be cut out of the log.
console.log("=====SAMPLES-BEGIN=====");
for (const b of blobs) console.log(b);
console.log("=====SAMPLES-END=====");

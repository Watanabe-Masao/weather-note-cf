// WN-02（WN-01 の続き）: what WN-01 left open.
//  1. The samples chosen in WN-01, read again and written into the log (gzip + base64), since the run's
//     artifact cannot be downloaded from where the report is written; also shows whether a telegram
//     is still served days later.
//  (2・3, the monthly tables and agora, ran once on 2026-11-17 and are taken out: see below.)
// Run by the "research-warnings" workflow; output goes to the log and the run's artifact.
//   npx --yes tsx@4.19.2 research/warnings/w02.ts --out research/warnings/out2
// 出典：気象庁（防災情報XML）。

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
// Whether each sample is still listed in the long feeds: a sample read after it left them shows whether
// JMA serves a telegram after the feed (the question left open by WN-01).
const listed = new Set<string>();
for (const f of ["extra_l", "regular_l"]) {
  const r = await get(`https://www.data.jma.go.jp/developer/xml/feed/${f}.xml`, 800);
  const names = [...r.text.matchAll(/href="[^"]*\/([^"/]+\.xml)"/g)].map((m) => m[1] ?? "");
  const ups = [...r.text.matchAll(/<updated>([^<]+)<\/updated>/g)].map((m) => m[1] ?? "").sort();
  for (const n of names) listed.add(n);
  log(`- ${f}.xml：HTTP ${r.status}、${names.length}件、いちばん古い updated ${ups[0] ?? "?"}（UTC）`);
}
log("");
const blobs: string[] = [];
for (const f of SAMPLES) {
  const r = await get(BASE + f, 500);
  log(`- ${f}：${listed.has(f) ? "一覧に載っている" : "**一覧に載っていない**"}、HTTP ${r.status}、${kb(r.bytes.length)}`);
  if (r.status === 200) blobs.push(`${f} ${gzipSync(r.bytes).toString("base64")}`);
}
log("");

// (The 高知地方気象台 PDFs and agora parts that were here ran once, 2026-11-17, run 44029943550. agora's
// /cgi-bin/ is Disallowed by its robots.txt, so they are taken out and are not run again — docs/thread-rules.md.)

writeFileSync(join(out, "w02-report.md"), lines.join("\n") + "\n");
// The samples last, between markers, so they can be cut out of the log.
console.log("=====SAMPLES-BEGIN=====");
for (const b of blobs) console.log(b);
console.log("=====SAMPLES-END=====");

// TY-02 (#220): where JMA's past typhoon announcements can be read, before deciding how to keep them
// (2026-11-16: 先に調べてから作る). Looks, without keeping anything in the repository:
//  1. JMA's XML feed (防災情報XML, PULL型): what the long feed holds now, and any typhoon telegram in it.
//  2. The archive of JMA's XML at the National Institute of Informatics (agora, 全般台風情報
//     データベース, CC BY 4.0): which telegrams it lists for a typhoon, at what times, and whether
//     the telegram itself can be read.
// For each, the report says what was found, what could not be read, and the times, so they can be
// set beside the announcements already seen (the JSON copies of 2026, TY-01 突き合わせ).
// Run by the "research-typhoon-archive" workflow (manual only); its output is the run's artifact.
//   npx --yes tsx@4.19.2 research/typhoon/ty02.ts --typhoons 202607,202625 --out research/typhoon/out2
// 出典：気象庁（防災情報XML）、国立情報学研究所「全般台風情報データベース」（CC BY 4.0）。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const typhoons = arg("typhoons", "202607,202625").split(",");
const out = arg("out", "research/typhoon/out2");
mkdirSync(join(out, "raw"), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines: string[] = [];
const log = (...ss: string[]) => {
  for (const s of ss.length ? ss : [""]) {
    lines.push(s);
    console.log(s);
  }
};

async function get(url: string): Promise<{ status: number; text: string; type: string }> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" }, signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    await sleep(1500); // gently: one request at a time
    return { status: r.status, text, type: r.headers.get("content-type") ?? "" };
  } catch (e) {
    return { status: 0, text: String(e), type: "" };
  }
}
const save = (name: string, text: string) => writeFileSync(join(out, "raw", name.replace(/[^\w.-]/g, "_")), text);

// ---- 1. JMA's XML feed -----------------------------------------------------------------------------
log("# TY-02 過去の台風の発表をどこから読めるか", "");
log("## 1. 気象庁 防災情報XML（PULL型）のフィード", "");
for (const feed of ["https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml", "https://www.data.jma.go.jp/developer/xml/feed/extra.xml"]) {
  const r = await get(feed);
  const entries = [...r.text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const titles = entries.map((e) => /<title>([^<]*)<\/title>/.exec(e)?.[1] ?? "");
  const kinds = new Map<string, number>();
  for (const t of titles) kinds.set(t, (kinds.get(t) ?? 0) + 1);
  const ty = entries.filter((e) => /台風/.test(e));
  const first = /<updated>([^<]*)<\/updated>/.exec(entries[entries.length - 1] ?? "")?.[1];
  const last = /<updated>([^<]*)<\/updated>/.exec(entries[0] ?? "")?.[1];
  log(`- ${feed}：HTTP ${r.status}、${entries.length}件（${first ?? "?"} 〜 ${last ?? "?"}）、台風を含むもの ${ty.length}件`);
  log(`  - 種類：${[...kinds].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join("／")}`);
  save(feed.split("/").pop()!, r.text);
  for (const e of ty.slice(0, 3)) {
    const link = /<link[^>]*href="([^"]+)"/.exec(e)?.[1];
    if (!link) continue;
    const x = await get(link);
    log(`  - ${/<title>([^<]*)<\/title>/.exec(e)?.[1]}：${link}（HTTP ${x.status}、${x.text.length}字）`);
    save(link.split("/").pop()!, x.text);
  }
}

// ---- 2. The archive (agora, 全般台風情報データベース) ----------------------------------------------
log("", "## 2. 国立情報学研究所 全般台風情報データベース（気象庁防災情報XML、CC BY 4.0）", "");
const BASE = "https://agora.ex.nii.ac.jp";
for (const id of typhoons) {
  const page = await get(`${BASE}/cps/weather/typhoon/${id}.html.ja`);
  save(`agora-${id}.html`, page.text);
  const reports = [...page.text.matchAll(/report_each\.pl\?id=(\d{14})_(\d+)_([A-Z]{4}\d{2})_(\d+)/g)].map((m) => ({ id: `${m[1]}_${m[2]}_${m[3]}_${m[4]}`, at: m[1], code: m[3] }));
  const uniq = [...new Map(reports.map((r) => [r.id, r])).values()];
  const byCode = new Map<string, string[]>();
  for (const r of uniq) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.at]);
  log(`### ${id.slice(0, 4)}年 台風${+id.slice(4)}号：HTTP ${page.status}、発表 ${uniq.length}件`);
  for (const [code, ats] of byCode) {
    const sorted = ats.sort();
    log(`- ${code}：${ats.length}件（${sorted[0]} 〜 ${sorted[sorted.length - 1]}）`);
  }
  // One telegram of each kind: what its page shows, and any link to the XML itself.
  for (const [code, ats] of byCode) {
    const r = uniq.find((x) => x.code === code && x.at === ats.sort()[Math.floor(ats.length / 2)])!;
    const each = await get(`${BASE}/cgi-bin/cps/report_each.pl?id=${r.id}`);
    save(`agora-${r.id}.html`, each.text);
    const xmlLinks = [...new Set([...each.text.matchAll(/href="([^"]*(?:xml|XML)[^"]*)"/g)].map((m) => m[1]))].slice(0, 6);
    const hasCircle = /予報円|暴風警戒域|強風域/.test(each.text);
    log(`  - ${code} の一例 ${r.id}：HTTP ${each.status}、強風域・予報円などの語 ${hasCircle ? "あり" : "なし"}、XML らしいリンク ${xmlLinks.length ? xmlLinks.join(" ") : "なし"}`);
    for (const l of xmlLinks.slice(0, 2)) {
      const url = l.startsWith("http") ? l : `${BASE}${l.startsWith("/") ? "" : "/"}${l}`;
      const x = await get(url);
      log(`    - ${url}：HTTP ${x.status}、${x.type}、${x.text.length}字、先頭 ${JSON.stringify(x.text.slice(0, 80))}`);
      save(`xml-${r.id}-${url.split("/").pop()}`, x.text);
    }
  }
  log();
}
log("出典：気象庁（防災情報XML）、国立情報学研究所「全般台風情報データベース」（CC BY 4.0）。");
writeFileSync(join(out, "ty02-report.md"), lines.join("\n") + "\n");

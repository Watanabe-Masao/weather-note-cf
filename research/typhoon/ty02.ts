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
// agora's 2026 pages reached 台風6号 (2026-11-16): 7号・25号 were not there (404).
const typhoons = arg("typhoons", "202606,202602").split(",");
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

/**
 * What a telegram holds, briefly: its head (title, report time, target time, info kind), each
 * MeteorologicalInfo's DateTime and type, and the element paths under it with how many there are and
 * one value each — enough to see where the centre, pressure, wind, 強風域・暴風域, 予報円 and
 * 暴風警戒域 are, without keeping the telegram.
 */
function outline(xml: string) {
  const tag = (n: string) => new RegExp(`<${n}[^>]*>([^<]*)</${n}>`).exec(xml)?.[1] ?? "";
  log(`    - 見出し：${tag("Title")}／発表 ${tag("ReportDateTime")}／対象 ${tag("TargetDateTime")}／種類 ${tag("InfoKind")} ${tag("InfoType")}／台風 ${tag("Number") || tag("Name")}`);
  const infos = [...xml.matchAll(/<MeteorologicalInfo\b[^>]*>([\s\S]*?)<\/MeteorologicalInfo>/g)];
  log(`    - MeteorologicalInfo：${infos.length}個`);
  for (const [i, m] of infos.entries()) {
    const body = m[1];
    const dt = /<DateTime[^>]*type="([^"]*)"[^>]*>([^<]*)</.exec(body) ?? /<DateTime[^>]*>([^<]*)</.exec(body);
    const kind = [...body.matchAll(/<Type>([^<]*)<\/Type>/g)].map((x) => x[1]);
    log(`      - [${i}] ${dt ? dt.slice(1).join(" ") : "?"}：${[...new Set(kind)].join("・")}`);
    if (i > 1) continue; // the paths of the first two (実況 and one forecast) are enough
    const counts = new Map<string, { n: number; v: string }>();
    const stack: string[] = [];
    for (const t of body.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>([^<]*)/g)) {
      const [, close, name, attrs, self, text] = t;
      if (close) {
        stack.pop();
        continue;
      }
      stack.push(name.replace(/^jmx_eb:/, "eb:"));
      const path = stack.join("/");
      const c = counts.get(path) ?? { n: 0, v: "" };
      c.n++;
      if (!c.v && (text.trim() || attrs.trim())) c.v = `${attrs.trim().slice(0, 60)} ${text.trim().slice(0, 40)}`.trim();
      counts.set(path, c);
      if (self) stack.pop();
    }
    for (const [path, c] of [...counts].slice(0, 80)) log(`        - ${path} ×${c.n}${c.v ? `：${c.v}` : ""}`);
  }
}

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
    if (/VPTW6/.test(link)) outline(x.text);
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

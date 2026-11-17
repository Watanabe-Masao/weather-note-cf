// WN-01（警報・注意報の履歴を保存するかを決めるための下調べ）: what JMA's warning telegrams for
// 高知 are, how they are delivered, how many there are and how big, what they hold, and where the
// past ones can be read — before deciding whether (and how) to keep them. Looks, keeps nothing in
// the app:
//  1. JMA's XML feeds (防災情報XML, PULL型): all six (定時・随時・その他 × 高頻度・長期) — how far back
//     each reaches, which kinds it carries, and how many of them are 高知's.
//  2. The warning-related telegrams of 高知 in the long feeds: each one read (size, gzip size, head,
//     the warning items and their statuses, the area codes) and a few kept as samples.
//  3. Whether JMA's own pages say more (the developer page), and whether a telegram can be read
//     after it left the feed.
//  4. 高知地方気象台's monthly table of the warnings issued (警報・注意報発表状況, PDF), 2025-01 on:
//     how many issues a month, and how many touched 高知市.
//  5. The archive at the National Institute of Informatics (agora, 特別警報・警報・注意報データベース):
//     what it says it holds and on what terms.
// Run by the "research-warnings" workflow (push to research/warnings only); output is the run's artifact.
//   npx --yes tsx@4.19.2 research/warnings/w01.ts --out research/warnings/out
// 出典：気象庁（防災情報XML、高知地方気象台「警報・注意報発表状況」）、国立情報学研究所。

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? (process.argv[i + 1] ?? d) : d;
};
const out = arg("out", "research/warnings/out");
const MAX_TELEGRAMS = Number(arg("max", "400"));
for (const d of ["raw", "samples", "pdf"]) mkdirSync(join(out, d), { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines: string[] = [];
const log = (...ss: string[]) => {
  for (const s of ss.length ? ss : [""]) {
    lines.push(s);
    console.log(s);
  }
};

type Got = { status: number; bytes: Buffer; text: string; type: string; error?: string };
async function get(url: string, pause = 800): Promise<Got> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" },
      signal: AbortSignal.timeout(60_000),
    });
    const bytes = Buffer.from(await r.arrayBuffer());
    await sleep(pause); // gently: one request at a time
    return { status: r.status, bytes, text: bytes.toString("utf8"), type: r.headers.get("content-type") ?? "" };
  } catch (e) {
    await sleep(pause);
    return { status: 0, bytes: Buffer.alloc(0), text: "", type: "", error: String(e) };
  }
}
const safe = (name: string) => name.replace(/[^\w.-]/g, "_");
const tag = (xml: string, n: string) => new RegExp(`<${n}\\b[^>]*>([^<]*)</${n}>`).exec(xml)?.[1]?.trim() ?? "";
const jst = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ") : iso;
};
const jstDay = (iso: string) => jst(iso).slice(0, 10);
const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
const count = <T>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

// ---- 1. the feeds ---------------------------------------------------------------------------------
const FEEDS = ["regular", "regular_l", "extra", "extra_l", "other", "other_l"].map(
  (f) => `https://www.data.jma.go.jp/developer/xml/feed/${f}.xml`,
);
/** Kinds that are warnings, or lead to / stand beside them (the old and the new, 2026-05-28 on). */
const WARN_KIND = /^(VPWW|VPWS|VPWP|VPFD6|VPFW6|VXWW|VPOA|VPBS|VPHW|VPFJ|VPCJ|VPZJ|VPNO|VXKO|VXSU|VMCJ|VPRN)/;
type Entry = { feed: string; title: string; updated: string; author: string; url: string; kind: string; office: string; content: string };
function entriesOf(feed: string, xml: string): Entry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1] ?? "";
    const url = /<link[^>]*href="([^"]+)"/.exec(e)?.[1] ?? "";
    const file = url.split("/").pop() ?? "";
    return {
      feed,
      title: tag(e, "title"),
      updated: tag(e, "updated"),
      author: tag(e, "name"),
      url,
      kind: /_(V[A-Z]{3}\d{2})_/.exec(file)?.[1] ?? "?",
      office: /_(\d{6})\.xml$/.exec(file)?.[1] ?? "",
      content: tag(e, "content"),
    };
  });
}
const isKochi = (e: Entry) => /高知/.test(e.author) || e.office === "390000";

log("# WN-01 警報・注意報の下調べ（自動の記録）", "", `実行：${new Date().toISOString()}（UTC）`, "", "## 1. 配信一覧（フィード）", "");
const all: Entry[] = [];
for (const feed of FEEDS) {
  const name = feed.split("/").pop() ?? feed;
  const r = await get(feed);
  writeFileSync(join(out, "raw", name), r.bytes);
  const es = entriesOf(name, r.text);
  all.push(...es);
  const ups = es.map((e) => e.updated).sort();
  const span = ups.length ? (Date.parse(ups[ups.length - 1]!) - Date.parse(ups[0]!)) / 3_600_000 : 0;
  log(
    `### ${name}`,
    `- HTTP ${r.status}${r.error ? `（${r.error}）` : ""}、${kb(r.bytes.length)}、${es.length}件、${ups.length ? `${jst(ups[0]!)} 〜 ${jst(ups[ups.length - 1]!)}（JST、${span.toFixed(1)}時間分）` : "—"}`,
    `- feed の updated：${jst(tag(r.text.replace(/<entry>[\s\S]*<\/entry>/, ""), "updated"))}`,
  );
  const kinds = count(es.map((e) => `${e.kind} ${e.title}`));
  const kochi = count(es.filter(isKochi).map((e) => `${e.kind} ${e.title}`));
  log(`- 種類（全国、多い順・上位40）：${kinds.slice(0, 40).map(([k, n]) => `${k}×${n}`).join("、")}`);
  log(`- 高知（高知地方気象台など）：${kochi.length ? kochi.map(([k, n]) => `${k}×${n}`).join("、") : "なし"}`);
  const warnKinds = kinds.filter(([k]) => WARN_KIND.test(k));
  log(`- 警報まわりの種類（全国）：${warnKinds.length ? warnKinds.map(([k, n]) => `${k}×${n}`).join("、") : "なし"}`, "");
}

// The kinds of every warning-related entry, with their authors (to see which office issues each).
log("### 警報まわりの種類ごとの発表官署（長期フィード）", "");
const longWarn = all.filter((e) => e.feed.endsWith("_l.xml") && WARN_KIND.test(e.kind));
for (const [k, n] of count(longWarn.map((e) => e.kind))) {
  const es = longWarn.filter((e) => e.kind === k);
  const titles = count(es.map((e) => e.title)).map(([t, c]) => `${t}×${c}`).join("、");
  const authors = count(es.map((e) => e.author)).slice(0, 6).map(([a, c]) => `${a}×${c}`).join("、");
  log(`- ${k}（${n}件）：${titles}／${authors}${count(es.map((e) => e.author)).length > 6 ? " …" : ""}`);
}
log("");

// ---- 2. the 高知 telegrams -------------------------------------------------------------------------
type Item = { kinds: { name: string; code: string; status: string; condition: string }[]; areas: { name: string; code: string }[] };
type Telegram = {
  url: string;
  kind: string;
  feed: string;
  feedTitle: string;
  author: string;
  status: number;
  bytes: number;
  gzip: number;
  controlTitle: string;
  controlStatus: string;
  headTitle: string;
  reportDateTime: string;
  targetDateTime: string;
  targetDuration: string;
  validDateTime: string;
  infoType: string;
  infoKind: string;
  infoKindVersion: string;
  serial: string;
  eventId: string;
  headline: string;
  warnings: { type: string; items: number; areaCodes: number; statuses: string[] }[];
  kochiCity: { type: string; kinds: string }[];
  timeSeries: number;
};

/** The element paths of a telegram, with how many there are and one value each. */
function outline(xml: string, max = 140): string[] {
  const counts = new Map<string, { n: number; v: string }>();
  const stack: string[] = [];
  for (const t of xml.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>([^<]*)/g)) {
    const [, close, name = "", attrs = "", self, text = ""] = t;
    if (name.startsWith("?")) continue;
    if (close) {
      stack.pop();
      continue;
    }
    stack.push(name.replace(/^jmx_eb:/, "eb:").replace(/^jmx_\w+:/, ""));
    const path = stack.join("/");
    const c = counts.get(path) ?? { n: 0, v: "" };
    c.n++;
    if (!c.v && (text.trim() || attrs.trim())) c.v = `${attrs.trim().replace(/xmlns(:\w+)?="[^"]*"/g, "").trim().slice(0, 70)} ${text.trim().slice(0, 30)}`.trim();
    counts.set(path, c);
    if (self) stack.pop();
  }
  return [...counts].slice(0, max).map(([p, c]) => `    - ${p} ×${c.n}${c.v ? `：${c.v}` : ""}`);
}

function readTelegram(e: Entry, r: Got): Telegram {
  const xml = r.text;
  const control = /<Control>([\s\S]*?)<\/Control>/.exec(xml)?.[1] ?? "";
  const head = /<Head\b[^>]*>([\s\S]*?)<\/Head>/.exec(xml)?.[1] ?? "";
  const body = /<Body\b[^>]*>([\s\S]*?)<\/Body>/.exec(xml)?.[1] ?? "";
  const headline = /<Headline>([\s\S]*?)<\/Headline>/.exec(head)?.[1] ?? "";
  const warnings: Telegram["warnings"] = [];
  const kochiCity: Telegram["kochiCity"] = [];
  for (const w of body.matchAll(/<Warning\b[^>]*type="([^"]*)"[^>]*>([\s\S]*?)<\/Warning>/g)) {
    const [, type = "", inner = ""] = w;
    const items: Item[] = [...inner.matchAll(/<Item>([\s\S]*?)<\/Item>/g)].map((m) => {
      const it = m[1] ?? "";
      return {
        kinds: [...it.matchAll(/<Kind>([\s\S]*?)<\/Kind>/g)].map((k) => ({
          name: tag(k[1] ?? "", "Name"),
          code: tag(k[1] ?? "", "Code"),
          status: tag(k[1] ?? "", "Status"),
          condition: tag(k[1] ?? "", "Condition"),
        })),
        areas: [...it.matchAll(/<Area>([\s\S]*?)<\/Area>/g)].map((a) => ({ name: tag(a[1] ?? "", "Name"), code: tag(a[1] ?? "", "Code") })),
      };
    });
    warnings.push({
      type,
      items: items.length,
      areaCodes: new Set(items.flatMap((i) => i.areas.map((a) => a.code))).size,
      statuses: count(items.flatMap((i) => i.kinds.map((k) => k.status))).map(([s, n]) => `${s || "（空）"}×${n}`),
    });
    for (const i of items)
      if (i.areas.some((a) => a.code === "3920100" || a.name === "高知市"))
        kochiCity.push({ type, kinds: i.kinds.map((k) => `${k.name || "（なし）"}:${k.status}${k.condition ? `(${k.condition})` : ""}`).join("、") });
  }
  return {
    url: e.url,
    kind: e.kind,
    feed: e.feed,
    feedTitle: e.title,
    author: e.author,
    status: r.status,
    bytes: r.bytes.length,
    gzip: gzipSync(r.bytes).length,
    controlTitle: tag(control, "Title"),
    controlStatus: tag(control, "Status"),
    headTitle: tag(head, "Title"),
    reportDateTime: tag(head, "ReportDateTime"),
    targetDateTime: tag(head, "TargetDateTime"),
    targetDuration: tag(head, "TargetDuration"),
    validDateTime: tag(head, "ValidDateTime"),
    infoType: tag(head, "InfoType"),
    infoKind: tag(head, "InfoKind"),
    infoKindVersion: tag(head, "InfoKindVersion"),
    serial: tag(head, "Serial"),
    eventId: tag(head, "EventID"),
    headline: tag(headline, "Text").slice(0, 60),
    warnings,
    kochiCity,
    timeSeries: (body.match(/<TimeSeriesInfo\b/g) ?? []).length,
  };
}

log("## 2. 高知の警報まわりの電文（長期フィードから）", "");
const seen = new Set<string>();
const wanted = all
  .filter((e) => e.feed.endsWith("_l.xml") && WARN_KIND.test(e.kind) && isKochi(e))
  .filter((e) => (seen.has(e.url) ? false : (seen.add(e.url), true)))
  .sort((a, b) => a.updated.localeCompare(b.updated));
// One of each warning-related kind not issued by 高知 but covering it or the whole country (四国の地方気象情報,
// 全国の集約通報 …), only to see its size and shape.
const extraKinds = new Map<string, Entry>();
for (const e of all.filter((x) => x.feed.endsWith("_l.xml") && WARN_KIND.test(x.kind) && !isKochi(x)))
  if (!wanted.some((w) => w.kind === e.kind) && !extraKinds.has(e.kind) && (/高松|気象庁本庁|大阪管区/.test(e.author) || /VPWS|VPZJ/.test(e.kind))) extraKinds.set(e.kind, e);
log(`- 高知の分：${wanted.length}件（読むのは古い順に最大 ${MAX_TELEGRAMS}件）。ほかの官署の分を種類ごとに1件：${[...extraKinds.keys()].join("、") || "なし"}`, "");

const telegrams: Telegram[] = [];
const xmlOf = new Map<string, string>();
for (const e of [...wanted.slice(0, MAX_TELEGRAMS), ...extraKinds.values()]) {
  const r = await get(e.url, 400);
  if (r.status !== 200) {
    log(`- 読めなかった：${e.kind} ${e.url.split("/").pop()}（HTTP ${r.status}${r.error ? ` ${r.error}` : ""}）`);
    continue;
  }
  const t = readTelegram(e, r);
  telegrams.push(t);
  xmlOf.set(e.url, r.text);
}
writeFileSync(join(out, "telegrams.jsonl"), telegrams.map((t) => JSON.stringify(t)).join("\n") + "\n");

log("### 種類ごとの件数・大きさ・時刻（高知の分）", "");
const kochiT = telegrams.filter((t) => /高知/.test(t.author));
for (const [k] of count(kochiT.map((t) => t.kind))) {
  const ts = kochiT.filter((t) => t.kind === k);
  const sz = ts.map((t) => t.bytes).sort((a, b) => a - b);
  const gz = ts.map((t) => t.gzip).sort((a, b) => a - b);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const days = count(ts.map((t) => jstDay(t.reportDateTime || ""))).sort((a, b) => a[0].localeCompare(b[0]));
  log(
    `#### ${k} ${ts[0]?.controlTitle}（${ts.length}件）`,
    `- 大きさ：最小 ${kb(sz[0] ?? 0)}／中央 ${kb(sz[Math.floor(sz.length / 2)] ?? 0)}／最大 ${kb(sz[sz.length - 1] ?? 0)}／合計 ${kb(sum(sz))}（gzip 合計 ${kb(sum(gz))}、中央 ${kb(gz[Math.floor(gz.length / 2)] ?? 0)}）`,
    `- 発表の日（JST）ごとの件数：${days.map(([d, n]) => `${d.slice(5)}×${n}`).join("、")}`,
    `- InfoType：${count(ts.map((t) => t.infoType)).map(([s, n]) => `${s}×${n}`).join("、")}／Control/Status：${count(ts.map((t) => t.controlStatus)).map(([s, n]) => `${s}×${n}`).join("、")}`,
    `- Head/Title：${count(ts.map((t) => t.headTitle)).slice(0, 8).map(([s, n]) => `${s}×${n}`).join("、")}`,
    `- InfoKind／版：${count(ts.map((t) => `${t.infoKind} ${t.infoKindVersion}`)).map(([s, n]) => `${s}×${n}`).join("、")}`,
    `- 時刻の例（最新）：発表 ${ts[ts.length - 1]?.reportDateTime}／対象 ${ts[ts.length - 1]?.targetDateTime || "—"}／対象期間 ${ts[ts.length - 1]?.targetDuration || "—"}／有効 ${ts[ts.length - 1]?.validDateTime || "—"}／EventID ${ts[ts.length - 1]?.eventId || "—"}／Serial ${ts[ts.length - 1]?.serial || "—"}`,
    `- 時系列（TimeSeriesInfo）：${count(ts.map((t) => t.timeSeries)).map(([s, n]) => `${s}個×${n}`).join("、")}`,
  );
  const wtypes = count(ts.flatMap((t) => t.warnings.map((w) => `${w.type}（項目${w.items}・区域${w.areaCodes}）`)));
  log(`- Warning の type（項目数・区域数）：${wtypes.slice(0, 12).map(([s, n]) => `${s}×${n}`).join("、") || "なし"}`);
  const st = count(ts.flatMap((t) => t.warnings.flatMap((w) => w.statuses.map((s) => s.replace(/×\d+$/, "")))));
  log(`- 出てきた Status：${st.map(([s, n]) => `${s}（${n}通）`).join("、") || "なし"}`);
  const city = ts.filter((t) => t.kochiCity.length);
  log(`- 高知市（3920100）の項目がある電文：${city.length}件`);
  for (const t of city.slice(-4)) log(`  - ${jst(t.reportDateTime)}：${t.kochiCity.map((c) => `[${c.type}] ${c.kinds}`).join("／").slice(0, 300)}`);
  log("");
}
log("### ほかの官署・全国の分（大きさと形だけ）", "");
for (const t of telegrams.filter((x) => !/高知/.test(x.author)))
  log(`- ${t.kind} ${t.controlTitle}（${t.author}）：${kb(t.bytes)}（gzip ${kb(t.gzip)}）、発表 ${t.reportDateTime}、Warning ${t.warnings.length}個`);
log("");

// The shape of each kind (the first one of each), and samples: the newest of each kind, plus ones that
// show 発表・解除・訂正・取消 where there are any.
log("### 種類ごとの中身の形（各種類の最新の1通）", "");
const samples = new Map<string, string>();
for (const [k] of count(telegrams.map((t) => t.kind))) {
  const ts = telegrams.filter((t) => t.kind === k);
  const last = ts[ts.length - 1]!;
  log(`#### ${k}（${last.url.split("/").pop()}）`, ...outline(xmlOf.get(last.url) ?? ""), "");
  if (last.bytes < 400_000) samples.set(last.url, `newest of ${k}`);
}
const pick = (why: string, f: (t: Telegram) => boolean, n = 1) => {
  for (const t of telegrams.filter(f).slice(-n)) if (!samples.has(t.url) && t.bytes < 400_000) samples.set(t.url, why);
};
pick("解除を含む（VPWW53）", (t) => t.kind === "VPWW53" && t.warnings.some((w) => w.statuses.some((s) => s.startsWith("解除"))), 2);
pick("発表を含む（VPWW53）", (t) => t.kind === "VPWW53" && t.warnings.some((w) => w.statuses.some((s) => s.startsWith("発表"))), 2);
pick("解除を含む（R06）", (t) => /^VPWW(5[5-9]|6\d)$/.test(t.kind) && t.warnings.some((w) => w.statuses.some((s) => s.startsWith("解除"))), 2);
pick("発表を含む（R06）", (t) => /^VPWW(5[5-9]|6\d)$/.test(t.kind) && t.warnings.some((w) => w.statuses.some((s) => s.startsWith("発表"))), 2);
pick("訂正・取消", (t) => /訂正|取消/.test(t.infoType));
for (const [url, why] of samples) {
  const name = url.split("/").pop() ?? "x.xml";
  writeFileSync(join(out, "samples", safe(name)), xmlOf.get(url) ?? "");
  log(`- 見本：${name}（${why}）`);
}
log("");

// ---- 3. after the feed --------------------------------------------------------------------------
log("## 3. フィードから外れた電文・説明のページ", "");
const oldest = all.filter((e) => e.feed === "extra_l.xml").sort((a, b) => a.updated.localeCompare(b.updated))[0];
if (oldest) {
  const r = await get(oldest.url);
  log(`- 長期フィードのいちばん古い電文（${jst(oldest.updated)}）：HTTP ${r.status}、${kb(r.bytes.length)}`);
}
// A file name with the same pattern a month back, which is not in any feed: read or not.
for (const u of [
  "https://www.data.jma.go.jp/developer/xml/data/",
  "https://www.data.jma.go.jp/developer/index.html",
  "https://www.data.jma.go.jp/developer/xml/feed/",
]) {
  const r = await get(u);
  writeFileSync(join(out, "raw", safe(u.replace(/^https:\/\//, ""))), r.bytes);
  const text = r.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  log(`- ${u}：HTTP ${r.status}、${kb(r.bytes.length)}`);
  for (const m of text.matchAll(/[^。]{0,80}(フィード|保存|期間|掲載|利用|規約|更新)[^。]{0,80}。/g)) log(`  - 「${m[0].trim().slice(0, 200)}」`);
}
log("");

// ---- 4. 高知地方気象台's monthly tables -------------------------------------------------------------
log("## 4. 高知地方気象台「警報・注意報発表状況」（月ごとの PDF）", "");
const months: string[] = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 11) months.push(`${y}_${String(m).padStart(2, "0")}`);
let pdftotext = true;
try {
  execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
} catch {
  pdftotext = false;
  log("- pdftotext が無いので中身は読まない");
}
type Word = { x: number; y: number; x2: number; text: string; page: number };
const MARK = /^[●◯○◎▼▽◇解]$/;
const monthRows: { month: string; status: number; bytes: number; pages: number; issues: number; rows: number; cityRows: number; city: [string, number][]; cityIssued: [string, number][] }[] = [];
for (const ym of months) {
  const url = `https://www.data.jma.go.jp/kochi/kochinokishou/chukeihou/${ym}.pdf`;
  const r = await get(url, 1200);
  if (r.status !== 200 || !r.type.includes("pdf")) {
    log(`- ${ym}：HTTP ${r.status}（${r.type || r.error || "?"}）`);
    monthRows.push({ month: ym, status: r.status, bytes: 0, pages: 0, issues: 0, rows: 0, cityRows: 0, city: [], cityIssued: [] });
    continue;
  }
  const file = join(out, "pdf", `${ym}.pdf`);
  writeFileSync(file, r.bytes);
  if (!pdftotext) continue;
  execFileSync("pdftotext", ["-bbox", file, `${file}.html`]);
  execFileSync("pdftotext", ["-layout", file, `${file}.txt`]);
  const html = readFileSync(`${file}.html`, "utf8");
  const words: Word[] = [];
  let page = 0;
  for (const m of html.matchAll(/<page\b|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)) {
    if (m[0].startsWith("<page")) {
      page++;
      continue;
    }
    words.push({ x: Number(m[1]), y: Number(m[2]), x2: Number(m[3]), text: m[4] ?? "", page });
  }
  // Issues: the times in the 発表日時 column ("22時11分"), each printed once per issue.
  const times = words.filter((w) => /^\d{1,2}時\d{2}分$/.test(w.text));
  // The 高知市 column: the "高" of the header with "知" just below it and "市" below that, leftmost.
  let issues = 0;
  let rows = 0;
  const city: string[] = [];
  const cityIssued: string[] = [];
  for (let p = 1; p <= page; p++) {
    const ws = words.filter((w) => w.page === p);
    issues += ws.filter((w) => /^\d{1,2}時\d{2}分$/.test(w.text)).length;
    const head = ws
      .filter((w) => w.text === "高" && ws.some((v) => v.text === "知" && Math.abs(v.x - w.x) < 2 && v.y > w.y && v.y - w.y < 20))
      .sort((a, b) => a.x - b.x)[0];
    const names = ws.filter((w) => /(注意報|警報)$/.test(w.text));
    rows += names.length;
    if (!head) continue;
    const cx = (head.x + head.x2) / 2;
    for (const n of names) {
      const mark = ws.find((w) => MARK.test(w.text) && Math.abs(w.y - n.y) < 3 && Math.abs((w.x + w.x2) / 2 - cx) < 4);
      if (mark) {
        city.push(`${n.text}${mark.text}`);
        if (mark.text === "●") cityIssued.push(n.text);
      }
    }
  }
  const row = {
    month: ym,
    status: r.status,
    bytes: r.bytes.length,
    pages: page,
    issues: issues || times.length,
    rows,
    cityRows: city.length,
    city: count(city),
    cityIssued: count(cityIssued),
  };
  monthRows.push(row);
  log(
    `- ${ym}：${kb(row.bytes)}、${row.pages}ページ、発表時刻 ${row.issues}回、行 ${row.rows}、高知市に印のある行 ${row.cityRows}（発表● ${cityIssued.length}：${row.cityIssued.map(([k, n]) => `${k}×${n}`).join("、") || "なし"}）`,
  );
}
writeFileSync(join(out, "pdf-summary.json"), JSON.stringify(monthRows, null, 1));
log("");

// ---- 5. agora (NII) -----------------------------------------------------------------------------
log("## 5. 国立情報学研究所（agora）の特別警報・警報・注意報データベース", "");
for (const u of [
  "https://agora.ex.nii.ac.jp/cps/weather/warning/",
  "https://agora.ex.nii.ac.jp/cps/weather/",
  "https://agora.ex.nii.ac.jp/cps/weather/warning/stat/",
]) {
  const r = await get(u, 2000);
  writeFileSync(join(out, "raw", safe(u.replace(/^https:\/\//, ""))), r.bytes);
  log(`- ${u}：HTTP ${r.status}、${kb(r.bytes.length)}`);
  const text = r.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const m of text.matchAll(/[^。]{0,100}(CC BY|クリエイティブ|ライセンス|利用条件|利用規約|出典|ダウンロード|API|CSV|JSON)[^。]{0,100}/g))
    log(`  - 「${m[0].trim().slice(0, 220)}」`);
  const links = [...new Set([...r.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? ""))].filter((l) => /xml|area|高知|39|download|csv|json|license|about/i.test(l));
  log(`  - 関係しそうなリンク：${links.slice(0, 40).join(" ")}`);
}
log("");

writeFileSync(join(out, "w01-report.md"), lines.join("\n") + "\n");

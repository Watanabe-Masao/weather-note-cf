// KC-02 (#279 の 3): the long-range telegrams' offices and VPCK70's contents, the 天気分布予報's list and
// tiles as its time-series page reads them, and the 今後の雨 forecast tiles (+1・+3・+6・+15 h). A few
// reads only; sizes, names and times to the log, nothing saved. Run once by a push. 出典：気象庁。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
async function get(url) {
  n++;
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const b = Buffer.from(await r.arrayBuffer());
    await sleep(1500);
    return { status: r.status, type: r.headers.get("content-type") ?? "", b, text: b.toString("utf8") };
  } catch (e) {
    await sleep(1500);
    return { status: 0, type: String(e), b: Buffer.alloc(0), text: "" };
  }
}
const pngInfo = (b) => (b.toString("ascii", 1, 4) === "PNG" ? ` PNG ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : "");
const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
console.log("# KC-02", new Date().toISOString());

// 1. long-range telegrams in regular_l
const feed = await get("https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml");
console.log(`regular_l: HTTP ${feed.status} ${feed.b.length} bytes`);
const es = [...feed.text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
  const e = m[1];
  const url = /href="([^"]+)"/.exec(e)?.[1] ?? "";
  return { url, file: url.split("/").pop(), title: /<title>([^<]*)/.exec(e)?.[1] ?? "", updated: /<updated>([^<]*)/.exec(e)?.[1] ?? "", author: /<name>([^<]*)/.exec(e)?.[1] ?? "", kind: /_(V[A-Z]{3}\d\d)_/.exec(url)?.[1] ?? "" };
});
for (const k of ["VPCK50", "VPAW51", "VPCK70", "VPZK70", "VPZK50"]) {
  const ks = es.filter((e) => e.kind === k);
  console.log(`${k}: ${ks.length} entries`);
  for (const e of ks) console.log(`  ${e.file}  ${e.title}  ${e.author}  ${e.updated}`);
}
const peek = async (e) => {
  const r = await get(e.url);
  const areas = [...new Set([...r.text.matchAll(/<Area>\s*<Name>([^<]*)<\/Name>\s*<Code>([^<]*)/g)].map((m) => `${m[1]}(${m[2]})`))];
  const stations = [...new Set([...r.text.matchAll(/<Station>\s*<Name>([^<]*)<\/Name>\s*<Code[^>]*>([^<]*)/g)].map((m) => `${m[1]}(${m[2]})`))];
  console.log(`telegram ${e.file}: HTTP ${r.status} ${r.b.length} bytes; Head/Title ${/<Head[^>]*>[\s\S]*?<Title>([^<]*)/.exec(r.text)?.[1]}; target ${/<TargetDateTime>([^<]*)/.exec(r.text)?.[1]} ${/<TargetDuration>([^<]*)/.exec(r.text)?.[1] ?? ""}`);
  console.log(`  areas ${areas.length}: ${areas.slice(0, 40).join("、")}`);
  console.log(`  stations ${stations.length}: ${stations.filter((s) => /高知|四国|松山|高松|徳島|室戸|清水|宿毛/.test(s)).join("、") || "(四国の名前なし)"}; first ${stations.slice(0, 6).join("、")}`);
  console.log(`  四国/高知 in text: ${(r.text.match(/四国/g) ?? []).length} / ${(r.text.match(/高知/g) ?? []).length}`);
};
const ck70 = es.filter((e) => e.kind === "VPCK70").sort((a, b) => a.updated.localeCompare(b.updated));
if (ck70.at(-1)) await peek(ck70.at(-1));
const shikoku70 = ck70.filter((e) => /_370000\.xml$|_390000\.xml$/.test(e.file)).at(-1);
if (shikoku70 && shikoku70 !== ck70.at(-1)) await peek(shikoku70);
const aw = es.filter((e) => e.kind === "VPAW51").at(-1);
if (aw) await peek(aw);

// 2. 天気分布予報: what the time-series page's own script reads
const page = await get("https://www.jma.go.jp/bosai/wdist/timeseries.html");
console.log(`timeseries.html: HTTP ${page.status}`);
const bundle = [...page.text.matchAll(/src="([^"]*timeseries[^"]*\.js)"/g)].map((m) => m[1])[0];
let cands = [];
if (bundle) {
  const u = new URL(bundle, "https://www.jma.go.jp/bosai/wdist/").href;
  const j = await get(u);
  console.log(`bundle ${u}: HTTP ${j.status} ${j.b.length} bytes`);
  const strs = [...new Set([...j.text.matchAll(/["'`]([^"'`\s]{0,80}(?:\/data\/|\.json|targetTimes|jmatile)[^"'`\s]{0,80})["'`]/g)].map((m) => m[1]))];
  console.log(`  strings (${strs.length}): ${strs.slice(0, 40).join(" | ")}`);
  cands = strs.filter((s) => /\.json$/.test(s) && !/[{}$]/.test(s));
}
for (const c of cands.slice(0, 3)) {
  const u = new URL(c, "https://www.jma.go.jp/bosai/wdist/").href;
  const r = await get(u);
  console.log(`  ${u}: HTTP ${r.status} ${r.type} ${r.b.length} bytes; ${r.text.slice(0, 400).replace(/\s+/g, " ")}`);
}

// 3. 今後の雨 forecast tiles
const B = "https://www.jma.go.jp/bosai/jmatile/data/rasrf";
const tt = await get(`${B}/targetTimes.json`);
const rows = JSON.parse(tt.text || "[]");
const fc = rows.filter((r) => r.member === "none" && r.validtime > r.basetime);
const fbts = [...new Set(fc.map((r) => r.basetime))].sort();
console.log(`rasrf targetTimes: ${rows.length} rows; forecast basetimes: ${fbts.join(",")}`);
const bt = fbts.at(-1);
const these = fc.filter((r) => r.basetime === bt).sort((a, b) => a.validtime.localeCompare(b.validtime));
const lead = (r) => (Date.parse(iso(r.validtime)) - Date.parse(iso(r.basetime))) / 3600000;
console.log(`basetime ${bt}: ${these.length} forecasts, leads (h) ${these.map(lead).join(",")}`);
console.log(`  elements by lead: ${these.map((r) => `${lead(r)}:${(r.elements ?? []).join("&")}`).join(" ")}`);
for (const h of [1, 3, 6, 15]) {
  const r = these.find((x) => lead(x) === h);
  if (!r) { console.log(`+${h}h: none listed`); continue; }
  const t = await get(`${B}/${r.basetime}/${r.member}/${r.validtime}/surf/rasrf/8/222/102.png`);
  console.log(`+${h}h [${r.basetime}/${r.member}/${r.validtime}/rasrf z8 222,102]: HTTP ${t.status} ${t.type} ${t.b.length} bytes${pngInfo(t.b)}`);
}
console.log(`# end (${n} requests)`);

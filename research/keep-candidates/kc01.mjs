// KC-01: what JMA (and 環境省) data could be kept that cannot be had later — a few reads only, sizes, kinds
// and times to the log; nothing is saved. Run once by a push to research/keep-candidates.
// 出典：気象庁ホームページ・防災情報XML、環境省熱中症予防情報サイト。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
async function get(url) {
  n++;
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const b = Buffer.from(await r.arrayBuffer());
    await sleep(1500);
    return { status: r.status, type: r.headers.get("content-type") ?? "", b, text: b.toString("utf8"), cache: r.headers.get("cache-control") ?? "" };
  } catch (e) {
    await sleep(1500);
    return { status: 0, type: String(e), b: Buffer.alloc(0), text: "", cache: "" };
  }
}
const line = (label, r) => console.log(`${label}: HTTP ${r.status} ${r.type} ${r.b.length} bytes${r.cache ? ` cache=${r.cache}` : ""}`);
const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
const stamp = (t) => new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
console.log("# KC-01", new Date().toISOString());

// 1. 今後の雨・解析雨量 (rasrf)
const B = "https://www.jma.go.jp/bosai/jmatile/data/rasrf";
const tt = await get(`${B}/targetTimes.json`);
line("rasrf targetTimes", tt);
let rows = [];
try { rows = JSON.parse(tt.text); } catch {}
const bts = [...new Set(rows.map((r) => r.basetime))].sort();
console.log(`rows ${rows.length}; basetimes ${bts.length}: ${bts[0]} … ${bts.at(-1)}`);
console.log(`members: ${[...new Set(rows.map((r) => r.member))].join(",")}; elements: ${[...new Set(rows.map((r) => (r.elements ?? []).join("&")))].join(" | ")}`);
for (const bt of [bts[0], bts.at(-1)]) {
  const rs = rows.filter((r) => r.basetime === bt);
  const vs = rs.map((r) => r.validtime).sort();
  const lead = vs.map((v) => (Date.parse(iso(v)) - Date.parse(iso(bt))) / 60000);
  console.log(`basetime ${bt}: ${rs.length} rows, lead (min) ${lead.join(",")}; elements ${[...new Set(rs.map((r) => (r.elements ?? []).join("&")))].join(" | ")}`);
}
console.log(`sample rows: ${JSON.stringify(rows.slice(0, 3))}`);
const tile = async (label, r, el) => {
  const u = `${B}/${r.basetime}/${r.member ?? "none"}/${r.validtime}/surf/${el}/8/222/102.png`;
  const t = await get(u);
  console.log(`${label} [${r.basetime}/${r.member}/${r.validtime}/${el}]: HTTP ${t.status} ${t.type} ${t.b.length} bytes${t.b.toString("ascii", 1, 4) === "PNG" ? ` PNG ${t.b.readUInt32BE(16)}x${t.b.readUInt32BE(20)}` : ""}`);
};
const newest = rows.filter((r) => r.basetime === bts.at(-1));
const ana = newest.find((r) => r.validtime === r.basetime) ?? newest[0];
const fc6 = newest.find((r) => Date.parse(iso(r.validtime)) - Date.parse(iso(r.basetime)) === 6 * 3600000) ?? newest.at(-1);
const oldest = rows.find((r) => r.basetime === bts[0] && r.validtime === r.basetime) ?? rows.find((r) => r.basetime === bts[0]);
if (ana) for (const el of ana.elements ?? []) await tile("newest analysis", ana, el);
if (fc6) await tile("newest +6h", fc6, (fc6.elements ?? [])[0]);
if (oldest) await tile("oldest listed", oldest, (oldest.elements ?? [])[0]);
if (ana) {
  const back = stamp(Date.parse(iso(ana.basetime)) - 24 * 3600000);
  await tile("24h back (not listed)", { basetime: back, validtime: back, member: ana.member }, (ana.elements ?? [])[0]);
}

// 2・3. the feeds: long-range and 随時 kinds, for 高知 and 四国 (高松)
const KINDS = /^(VPAW|VPCK|VPZK|VPCI|VPFI|VPZI|VPFT|VPCT|VPOA|VPBS|VXWW|VPHW|VPFJ|VPCJ|VPZJ|VPNO|VXKO)/;
const keep = [];
for (const f of ["regular_l", "extra_l"]) {
  const r = await get(`https://www.data.jma.go.jp/developer/xml/feed/${f}.xml`);
  line(f, r);
  const es = [...r.text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const url = /href="([^"]+)"/.exec(e)?.[1] ?? "";
    return { url, title: /<title>([^<]*)/.exec(e)?.[1] ?? "", updated: /<updated>([^<]*)/.exec(e)?.[1] ?? "", author: /<name>([^<]*)/.exec(e)?.[1] ?? "", kind: /_(V[A-Z]{3}\d\d)_/.exec(url)?.[1] ?? "", office: /_(\d{6})\.xml$/.exec(url)?.[1] ?? "" };
  });
  const ups = es.map((e) => e.updated).sort();
  console.log(`${f}: ${es.length} entries, ${ups[0]} … ${ups.at(-1)}`);
  const g = new Map();
  for (const e of es.filter((e) => KINDS.test(e.kind))) {
    const k = `${e.kind} ${e.title}`;
    const v = g.get(k) ?? { n: 0, authors: new Map(), kochi: [] };
    v.n++;
    v.authors.set(e.author, (v.authors.get(e.author) ?? 0) + 1);
    if (/高知|高松/.test(e.author) || e.office === "390000" || e.office === "370000") v.kochi.push(e);
    g.set(k, v);
  }
  for (const [k, v] of [...g].sort()) {
    const days = new Set(v.kochi.map((e) => e.updated.slice(0, 10)));
    console.log(`  ${k}: ${v.n} (${[...v.authors].slice(0, 5).map(([a, c]) => `${a}×${c}`).join("、")}${v.authors.size > 5 ? " …" : ""}); 高知・高松/四国: ${v.kochi.length} on ${days.size} days; times ${v.kochi.slice(-3).map((e) => e.updated).join(" ")}`);
    const last = v.kochi.at(-1);
    if (last && !keep.some((x) => x.kind === last.kind)) keep.push(last);
  }
}
for (const e of keep.slice(0, 8)) {
  const r = await get(e.url);
  const title = /<Control>[\s\S]*?<Title>([^<]*)/.exec(r.text)?.[1] ?? "";
  const head = /<Head[^>]*>[\s\S]*?<Title>([^<]*)/.exec(r.text)?.[1] ?? "";
  const target = /<TargetDateTime>([^<]*)/.exec(r.text)?.[1] ?? "";
  const dur = /<TargetDuration>([^<]*)/.exec(r.text)?.[1] ?? "";
  const areas = [...new Set([...r.text.matchAll(/<Area>\s*<Name>([^<]*)/g)].map((m) => m[1]))].slice(0, 8);
  const stations = [...new Set([...r.text.matchAll(/<Station>\s*<Name>([^<]*)/g)].map((m) => m[1]))].slice(0, 8);
  console.log(`telegram ${e.url.split("/").pop()}: HTTP ${r.status} ${r.b.length} bytes; Control/Title ${title}; Head/Title ${head}; target ${target} ${dur}; areas ${areas.join("、")}; stations ${stations.join("、")}`);
}

// 4a. 天気分布予報 (wdist)
for (const u of ["https://www.jma.go.jp/bosai/wdist/data/targetTimes.json", "https://www.jma.go.jp/bosai/wdist/timeseries.html"]) {
  const r = await get(u);
  line(u, r);
  if (u.endsWith(".json")) console.log(`  ${r.text.slice(0, 300)}`);
  else {
    const js = [...r.text.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    console.log(`  js: ${js.join(" ")}`);
    for (const j of js.filter((x) => !/common|lib|vendor/i.test(x)).slice(0, 2)) {
      const ju = j.startsWith("http") ? j : new URL(j, u).href;
      const jr = await get(ju);
      line(`  ${ju}`, jr);
      console.log(`    paths: ${[...new Set([...jr.text.matchAll(/["'`]([^"'`]*(?:data|json)[^"'`]{0,60})["'`]/g)].map((m) => m[1]))].slice(0, 25).join(" | ")}`);
    }
  }
}

// 2b. 2週間気温予報の確率予測資料 (CSV)
{
  const u = "https://www.data.jma.go.jp/risk/probability/guidance/csv_k2w.php";
  const r = await get(u);
  line(u, r);
  const links = [...new Set([...r.text.matchAll(/href="([^"]+\.(?:csv|zip))"/g)].map((m) => m[1]))];
  console.log(`  links (${links.length}): ${links.slice(0, 12).join(" ")}`);
  const kochi = links.find((l) => /74182|47893|shikoku|_74/i.test(l));
  console.log(`  高知らしいもの: ${kochi ?? "なし"}`);
  if (kochi) {
    const c = await get(new URL(kochi, u).href);
    line(`  ${kochi}`, c);
    console.log(`  head: ${c.text.split("\n").slice(0, 3).join(" / ").slice(0, 300)}`);
  }
}

// 4b. 環境省 熱中症予防情報サイト: robots.txt first; the data service page only if allowed.
{
  const r = await get("https://www.wbgt.env.go.jp/robots.txt");
  line("wbgt robots.txt", r);
  console.log(r.status === 200 ? r.text.slice(0, 1500) : "  (none)");
  const dis = r.status === 200 ? [...r.text.matchAll(/^Disallow:\s*(\S*)/gim)].map((m) => m[1]).filter(Boolean) : [];
  const allowed = (p) => !dis.some((d) => p.startsWith(d));
  for (const p of ["/data_service.php", "/record_data.php"]) {
    if (!allowed(p)) { console.log(`  ${p}: robots.txt で禁止、読まない`); continue; }
    const q = await get(`https://www.wbgt.env.go.jp${p}`);
    line(`  ${p}`, q);
    const text = q.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const m of text.matchAll(/[^。]{0,90}(規約|同意|申込|申し込み|期間|過去|保存|ダウンロード|CSV|利用)[^。]{0,90}。/g)) console.log(`    「${m[0].trim().slice(0, 200)}」`);
    console.log(`    links: ${[...new Set([...q.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((l) => /csv|dl|data|kiyaku|rule|term/i.test(l)).slice(0, 20).join(" ")}`);
  }
}
console.log(`# end (${n} requests)`);

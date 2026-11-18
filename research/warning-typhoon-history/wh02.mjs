// WH-02: the typhoon records apart from the feed — the 台風位置表 (CSV) and the RSMC best track of 2026:
// what times they hold (how often), to see whether "the analyses that should have come" can be known.
// Reads a few files; nothing is kept. robots.txt of both hosts is 404 (WH-01). 出典：気象庁ホームページ。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
    const b = Buffer.from(await r.arrayBuffer());
    await sleep(1200);
    return { status: r.status, type: r.headers.get("content-type") ?? "", lm: r.headers.get("last-modified") ?? "", b };
  } catch (e) {
    await sleep(1200);
    return { status: 0, type: String(e), lm: "", b: Buffer.alloc(0) };
  }
}
console.log("# WH-02", new Date().toISOString());
const T = "https://www.data.jma.go.jp/yoho/typhoon/position_table/table2026.html";
const t = await get(T);
const html = t.b.toString("utf8");
const links = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];
console.log(`table2026: HTTP ${t.status} ${t.b.length} bytes lm=${t.lm}`);
console.log(`links: ${links.join(" ")}`);
const csv = links.find((l) => /\.csv$/i.test(l) && /2026|table|position/i.test(l)) ?? links.find((l) => /\.csv$/i.test(l));
if (csv) {
  const u = new URL(csv, T).href;
  const r = await get(u);
  let text = new TextDecoder("shift_jis").decode(r.b);
  if (!/[台年]/.test(text)) text = r.b.toString("utf8");
  const rows = text.split(/\r?\n/).filter(Boolean);
  console.log(`csv ${u}: HTTP ${r.status} ${r.b.length} bytes lm=${r.lm} rows ${rows.length}`);
  for (const l of rows.slice(0, 6)) console.log(`  | ${l.slice(0, 200)}`);
  // Times per typhoon and the steps between them (hours).
  const head = rows[0].split(",");
  const iy = head.findIndex((h) => /年/.test(h)), im = head.findIndex((h) => /^月/.test(h)), id = head.findIndex((h) => /^日/.test(h)), ih = head.findIndex((h) => /時/.test(h)), it = head.findIndex((h) => /台風番号|番号/.test(h));
  console.log(`  columns: ${head.join(",")} (year ${iy} month ${im} day ${id} hour ${ih} no ${it})`);
  const by = new Map();
  for (const l of rows.slice(1)) {
    const c = l.split(",");
    const key = c[it];
    const ms = Date.UTC(+c[iy], +c[im] - 1, +c[id], +c[ih]);
    if (!Number.isFinite(ms)) continue;
    (by.get(key) ?? by.set(key, []).get(key)).push(ms);
  }
  for (const [k, ts] of [...by].slice(-4)) {
    const steps = new Map();
    ts.sort((a, b) => a - b).slice(1).forEach((x, i) => { const h = (x - ts[i]) / 3600000; steps.set(h, (steps.get(h) ?? 0) + 1); });
    console.log(`  ${k}: ${ts.length} times, ${new Date(ts[0]).toISOString()} … ${new Date(ts.at(-1)).toISOString()}, steps (h×count) ${[...steps].map(([h, c]) => `${h}×${c}`).join(" ")}`);
  }
}
const bst = await get("https://www.jma.go.jp/jma/jma-eng/jma-center/rsmc-hp-pub-eg/Besttracks/bst2026.txt");
const lines = bst.b.toString("utf8").split(/\r?\n/).filter(Boolean);
console.log(`bst2026.txt: HTTP ${bst.status} ${bst.b.length} bytes lm=${bst.lm} lines ${lines.length}`);
const heads = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith("66666"));
console.log(`  storms ${heads.length}; last headers: ${heads.slice(-3).map(([l]) => l.slice(0, 80)).join(" / ")}`);
const [, li] = heads.at(-1) ?? [];
if (li !== undefined) {
  const recs = lines.slice(li + 1).filter((l) => !l.startsWith("66666")).map((l) => l.slice(0, 8));
  const ms = recs.map((s) => Date.UTC(2000 + +s.slice(0, 2), +s.slice(2, 4) - 1, +s.slice(4, 6), +s.slice(6, 8)));
  const steps = new Map();
  ms.slice(1).forEach((x, i) => { const h = (x - ms[i]) / 3600000; steps.set(h, (steps.get(h) ?? 0) + 1); });
  console.log(`  last storm: ${recs.length} records ${recs[0]} … ${recs.at(-1)}; steps (h×count) ${[...steps].map(([h, c]) => `${h}×${c}`).join(" ")}`);
  for (const l of lines.slice(li, li + 3)) console.log(`  | ${l}`);
}
console.log("# end");

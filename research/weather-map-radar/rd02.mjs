// RD-02: the radar list (targetTimes_N1.json) once, and a few tiles around 高知市 — only their sizes,
// form and times are logged; nothing is saved. Run once by a push to research/weather-map-radar.
// 出典：気象庁ホームページ（ナウキャスト）。
const B = "https://www.jma.go.jp/bosai/jmatile/data/nowc";
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const b = Buffer.from(await r.arrayBuffer());
    await sleep(1500);
    return { status: r.status, type: r.headers.get("content-type") ?? "", bytes: b, mod: r.headers.get("last-modified") ?? "", cache: r.headers.get("cache-control") ?? "" };
  } catch (e) {
    await sleep(1500);
    return { status: 0, type: String(e), bytes: Buffer.alloc(0), mod: "", cache: "" };
  }
}
const png = (b) =>
  b.length > 26 && b.toString("ascii", 1, 4) === "PNG"
    ? `PNG ${b.readUInt32BE(16)}×${b.readUInt32BE(20)} bit${b[24]} color${b[25]}`
    : `not PNG (${b.subarray(0, 8).toString("hex")})`;

console.log("# RD-02", new Date().toISOString());
const list = await get(`${B}/targetTimes_N1.json`);
console.log(`list: HTTP ${list.status} ${list.type} ${list.bytes.length} bytes cache=${list.cache}`);
const rows = JSON.parse(list.bytes.toString("utf8") || "[]");
const bt = [...new Set(rows.map((r) => r.basetime))].sort();
const vt = [...new Set(rows.map((r) => r.validtime))].sort();
console.log(`entries ${rows.length}; basetime ${bt.length} (${bt[0]} … ${bt.at(-1)}); validtime ${vt[0]} … ${vt.at(-1)}`);
console.log(`elements: ${[...new Set(rows.map((r) => (r.elements ?? []).join("&")))].join(" | ")}`);
console.log(`first rows: ${JSON.stringify(rows.slice(0, 2))}`);
const steps = bt.slice(1).map((t, i) => (Date.parse(t.replace(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/, "$1-$2-$3T$4:$5:$6Z")) - Date.parse(bt[i].replace(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/, "$1-$2-$3T$4:$5:$6Z"))) / 60000);
console.log(`basetime steps (min): ${[...new Set(steps)].join(",")}`);

const newest = rows.filter((r) => r.basetime === bt.at(-1) && r.validtime === r.basetime)[0] ?? rows.find((r) => r.basetime === bt.at(-1));
const oldest = rows.find((r) => r.basetime === bt[0]);
const tile = (r, z, x, y) => `${B}/${r.basetime}/none/${r.validtime}/surf/hrpns/${z}/${x}/${y}.png`;
const show = async (label, url) => {
  const t = await get(url);
  console.log(`${label}: HTTP ${t.status} ${t.type} ${t.bytes.length} bytes ${t.status === 200 ? png(t.bytes) : ""} last-modified=${t.mod}`);
};
// 高知市 (33.56N, 133.53E): z6 55,25 / z8 222,102 / z10 891,410.
for (const [z, x, y] of [[6, 55, 25], [10, 891, 410]]) await show(`newest z${z} ${x},${y}`, tile(newest, z, x, y));
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) await show(`newest z8 ${222 + dx},${102 + dy}`, tile(newest, 8, 222 + dx, 102 + dy));
await show(`oldest-in-list z8 222,102 (${oldest.basetime})`, tile(oldest, 8, 222, 102));
// Six hours back (not in the list): the same pattern.
const back = new Date(Date.parse(bt.at(-1).replace(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/, "$1-$2-$3T$4:$5:$6Z")) - 6 * 3600000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
await show(`6h back (not listed) z8 222,102 (${back})`, `${B}/${back}/none/${back}/surf/hrpns/8/222/102.png`);
console.log("# end (13 requests: 1 list + 12 tiles)");

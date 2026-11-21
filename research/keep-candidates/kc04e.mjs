// KC-04 pass 5: そらまめくんの API の説明（/data/apiManual/linkInfo.json と、そこから読む説明の HTML）。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { const r = await fetch(u, { headers: UA }); const t = await r.text(); await sleep(1200); return { s: r.status, t }; };
console.log("# KC-04e");
const li = await get("https://soramame.env.go.jp/data/apiManual/linkInfo.json");
console.log(`linkInfo: HTTP ${li.s} ${li.t.length}B\n${li.t.slice(0, 2500)}`);
let urls = [];
try { urls = [...new Set([...li.t.matchAll(/"url"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))]; } catch {}
for (const u of urls.slice(0, 6)) {
  const full = u.startsWith("http") ? u : `https://soramame.env.go.jp${u.startsWith("/") ? "" : "/"}${u}`;
  const p = await get(full);
  console.log(`\n## ${full}: HTTP ${p.s} ${p.t.length}B\n${p.t.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").slice(0, 3000)}`);
}
console.log("\n# end");

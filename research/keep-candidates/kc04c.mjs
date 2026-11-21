// KC-04 pass 3: そらまめくん API の説明（apiManual.json）と測定局の一覧（station.json）の中身の形だけ。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); const t = await r.text(); await sleep(1200); return { s: r.status, t }; } catch (e) { return { s: 0, t: String(e) }; } }
console.log("# KC-04c", new Date().toISOString());
for (const p of ["apiManual.json", "download.json", "guide.json", "link.json"]) {
  const r = await get(`https://soramame.env.go.jp/data/dashboard/${p}`);
  console.log(`\n## ${p}: HTTP ${r.s} ${r.t.length}B\n${r.t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3500)}`);
}
const st = await get("https://soramame.env.go.jp/data/dashboard/station.json");
console.log(`\n## station.json: HTTP ${st.s} ${st.t.length}B head ${st.t.slice(0, 300)}`);
try {
  const j = JSON.parse(st.t);
  const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) ?? [];
  const kochi = arr.filter((x) => JSON.stringify(x).includes("高知"));
  console.log(`stations ${arr.length}, with 高知 ${kochi.length}`);
  for (const k of kochi.slice(0, 15)) console.log(JSON.stringify(k).slice(0, 300));
} catch (e) { console.log("parse: " + e); }
console.log("\n# end");
